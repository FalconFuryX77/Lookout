// Job sources. Each returns normalized postings; the store handles enrichment + dedupe.
// `every` is the poll interval in seconds, chosen to match how fast the source changes
// and what its terms allow.
import { linkedin } from './linkedin.mjs';
import { getText, getJson, htmlToText, feedEntries, xmlTag, xmlText, xmlLink, toIso, precisionOf, decodeEntities } from './util.mjs';

const DAY = 864e5;
const recent = (iso, days) => !iso || Date.now() - Date.parse(iso) <= days * DAY;

// ---------- Hacker News: monthly "Who is hiring?" thread (founders often post emails) ----------
async function hnWhoIsHiring(ctx) {
  const st = ctx.cursor;
  if (!st.storyId || Date.now() - (st.storyCheckedAt || 0) > 6 * 36e5) {
    const { data } = await getJson('https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10', { conditional: false });
    const story = data.hits.find(h => /who is hiring/i.test(h.title));
    if (story && String(story.objectID) !== String(st.storyId)) { st.storyId = story.objectID; st.since = Math.floor(Date.now() / 1000) - 35 * 86400; }
    st.storyCheckedAt = Date.now();
  }
  if (!st.storyId) return [];
  const out = []; let page = 0, maxSeen = st.since || 0;
  while (page < 10) {
    const { data } = await getJson(`https://hn.algolia.com/api/v1/search_by_date?tags=comment,story_${st.storyId}&numericFilters=created_at_i>${st.since || 0}&hitsPerPage=500&page=${page}`, { conditional: false });
    for (const h of data.hits) {
      maxSeen = Math.max(maxSeen, h.created_at_i);
      if (String(h.parent_id) !== String(st.storyId) || !h.comment_text) continue; // top-level only
      const p = parseHnPost(h); if (p) out.push(p);
    }
    if (++page >= data.nbPages) break;
  }
  st.since = maxSeen;
  return out;
}
function parseHnPost(h) {
  const html = h.comment_text; const text = htmlToText(html);
  const first = text.split('\n')[0];
  const parts = first.split(/\s+\|\s+|\s+\|\s*|\s*\|\s+/).map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const company = parts[0].replace(/\s*\(.*?\)\s*/g, ' ').replace(/https?:\/\/\S+/, '').trim().slice(0, 80);
  const roleRe = /(engineer|developer|scientist|designer|intern|manager|lead|analyst|founding|swe|sre|devops|researcher|architect|marketer|sales|recruit|product|ml|ai|data|full[- ]?stack|frontend|backend|ops|hiring)/i;
  const locRe = /(remote|onsite|on-site|hybrid|\b[A-Z][a-z]+,\s?[A-Z]{2}\b|san francisco|new york|nyc|london|berlin|bangalore|bengaluru|india|toronto|europe|usa|\bUS\b|\bSF\b|\bEU\b|\bUK\b)/i;
  const role = parts.slice(1).find(p => roleRe.test(p) && p.length < 160) || 'Multiple roles';
  const location = parts.slice(1).filter(p => locRe.test(p) && p !== role).join('; ');
  const links = [...html.matchAll(/href="([^"]+)"/g)].map(m => decodeEntities(m[1])).filter(u => !/news\.ycombinator\.com/.test(u));
  const site = links.find(u => !/(greenhouse|lever|ashby|workable|forms|calendly|linkedin)/i.test(u));
  return {
    title: role, company, location, description: text, url: `https://news.ycombinator.com/item?id=${h.objectID}`,
    applyUrl: links.find(u => /(greenhouse|lever|ashby|workable|careers|jobs|apply)/i.test(u)) || '',
    companyUrl: site || '', postedAt: toIso(h.created_at_i), precision: 'minute',
    sourceJobId: `hn:${h.objectID}`,
  };
}

// ---------- Hacker News job stories (YC companies posting directly) ----------
async function hnJobStories(ctx) {
  const { data: ids } = await getJson('https://hacker-news.firebaseio.com/v0/jobstories.json', { conditional: false });
  const seen = new Set(ctx.cursor.ids || []); const out = [];
  for (const id of ids.slice(0, 60)) {
    if (seen.has(id)) continue;
    try {
      const { data: it } = await getJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { conditional: false });
      if (!it?.title) continue;
      const m = it.title.match(/^(.+?)\s*(\((?:YC\s*)?[SWFX]\d{2}\))?\s+(?:is\s+)?(?:hiring|looking for|seeks|wants)\s+(?:an?\s+)?(.+)$/i);
      const batch = it.title.match(/\(YC\s*([SWFX]\d{2})\)/i)?.[1];
      out.push({
        title: m ? m[3].replace(/^(?:a|an)\s+/i, '') : it.title, company: m ? m[1].trim() : (it.by || 'YC startup'),
        url: it.url || `https://news.ycombinator.com/item?id=${id}`, description: htmlToText(it.text || it.title),
        postedAt: toIso(it.time), precision: 'minute', companyMeta: batch ? { yc: batch, funded: true } : null, sourceJobId: `hnjob:${id}`,
        location: /remote/i.test(it.title) ? 'Remote' : '',
      });
    } catch { }
  }
  ctx.cursor.ids = ids.slice(0, 200);
  return out;
}

// ---------- GitHub curated lists (Simplify format) ----------
function simplifyAdapter(url, label, days = 30) {
  return async () => {
    const { data, changed } = await getJson(url, { timeout: 60000 });
    if (!changed) return [];
    return data.filter(r => r.active !== false && r.is_visible !== false && r.url && recent(toIso(r.date_posted), days)).map(r => ({
      title: r.title, company: r.company_name, url: r.url, companyUrl: r.company_url && !/simplify\.jobs/.test(r.company_url) ? r.company_url : '',
      locations: r.locations || [], typeHint: label === 'intern' ? 'Internship' : 'New grad full-time', level: label === 'intern' ? 'Intern' : 'Entry',
      description: [r.category && `Category: ${r.category}`, r.terms?.length && `Terms: ${r.terms.join(', ')}`, r.sponsorship && `Sponsorship: ${r.sponsorship}`, r.degrees?.length && `Degrees: ${r.degrees.join(', ')}`].filter(Boolean).join('\n'),
      postedAt: toIso(r.date_posted), precision: 'minute', sourceJobId: `${label}:${r.id}`,
    }));
  };
}

/** Adapter for auto-discovered GitHub lists: accepts Simplify-style or Sarthzk-style rows. */
export function genericListAdapter(url, id) {
  return async () => {
    const { data, changed } = await getJson(url, { timeout: 60000 });
    if (!changed) return [];
    const rows = Array.isArray(data) ? data : data.listings || data.jobs || [];
    return rows.filter(r => r && r.url && r.title && (r.company_name || r.company) && r.active !== false && r.is_visible !== false && r.status !== 'closed').map(r => {
      const posted = r.date_posted || r.date_found || r.first_seen || r.posted;
      const iso = toIso(typeof posted === 'string' && /^\d+$/.test(posted) ? Number(posted) : posted);
      const sponsorship = r.sponsorship || (r.citizenship_required ? 'U.S. Citizenship is Required' : r.no_sponsorship === true ? 'Does Not Offer Sponsorship' : '');
      const category = r.category || (Array.isArray(r.tracks) ? r.tracks.join(', ') : '');
      return { title: r.title, company: r.company_name || r.company, url: r.url, locations: r.locations || [r.location].filter(Boolean),
        salary: typeof r.pay === 'string' ? r.pay : r.pay?.min ? `$${r.pay.min}–${r.pay.max || r.pay.min} ${r.pay.period || ''}`.trim() : '',
        description: [category && `Category: ${category}`, r.terms?.length && `Terms: ${r.terms.join(', ')}`, sponsorship && `Sponsorship: ${sponsorship}`, r.degrees?.length && `Degrees: ${r.degrees.join(', ')}`, r.advanced_degree && 'Degrees: Master\'s, PhD'].filter(Boolean).join('\n'),
        postedAt: iso, precision: typeof posted === 'number' || /T\d/.test(String(posted)) ? 'minute' : 'date', sourceJobId: `${id}:${r.id || r.url}` };
    }).filter(p => p.postedAt && recent(p.postedAt, 30)); // undated rows from a community list can't be trusted as fresh
  };
}

async function sarthzkIndia() {
  const { data, changed } = await getJson('https://raw.githubusercontent.com/Sarthzk/internship-tracker/main/data/listings.json', { timeout: 30000 });
  if (!changed) return [];
  const rows = Array.isArray(data) ? data : data.listings || data.jobs || [];
  return rows.filter(r => r.url && r.status !== 'closed' && !r.closed_at && recent(r.first_seen || r.date_posted, 45)).map(r => ({
    title: r.title, company: r.company, url: r.url, locations: r.locations || [], remote: r.is_remote, level: 'Intern', type: 'Internship',
    description: r.category ? `Category: ${r.category}` : '', postedAt: toIso(r.first_seen || r.date_posted), precision: precisionOf(r.first_seen || r.date_posted),
    sourceJobId: `sarthzk:${r.id}`,
  }));
}

async function internscan(region) {
  const { data, changed } = await getJson(`https://internscan.vercel.app/${region ? region + '/' : ''}api/active.json`, { timeout: 30000 });
  if (!changed) return [];
  return (data.jobs || []).filter(r => r.url && recent(r.first_seen || r.posted, 30)).map(r => ({
    title: r.title, company: r.company, url: r.url, locations: r.locations || [r.city_tag].filter(Boolean),
    country: region === 'in' ? 'India' : undefined, type: 'Internship', level: 'Intern',
    description: [r.category && `Category: ${r.category}`, r.region].filter(Boolean).join('\n'),
    postedAt: toIso(r.first_seen || r.posted), precision: precisionOf(r.first_seen || r.posted),
  }));
}

// ---------- Remote / startup job boards with public APIs ----------
async function remoteOk() {
  const { data } = await getJson('https://remoteok.com/api', { timeout: 20000 });
  return data.filter(j => j.id && j.position).map(j => ({
    title: j.position, company: j.company, url: j.url || `https://remoteok.com/remote-jobs/${j.id}`, applyUrl: j.apply_url || '',
    location: j.location || 'Remote', remote: true, description: htmlToText(j.description || ''), skills: (j.tags || []).map(t => ({ name: t, group: 'Listed' })),
    salary: j.salary_min ? `$${Math.round(j.salary_min / 1000)}k–$${Math.round((j.salary_max || j.salary_min) / 1000)}k` : '',
    postedAt: toIso(j.epoch || j.date), precision: 'minute', sourceJobId: `rok:${j.id}`,
  }));
}
async function weWorkRemotely() {
  const { body, changed } = await getText('https://weworkremotely.com/remote-jobs.rss', { headers: { accept: 'application/rss+xml' } });
  if (!changed) return [];
  return feedEntries(body).map(it => {
    const t = xmlText(it, 'title'); const [company, ...rest] = t.split(':');
    return { title: rest.join(':').trim() || t, company: rest.length ? company.trim() : 'WWR listing', url: xmlLink(it), location: xmlText(it, 'region') || 'Remote', remote: true,
      description: xmlText(it, 'description'), postedAt: toIso(xmlTag(it, 'pubDate')), precision: 'minute' };
  });
}
async function himalayas() {
  const { data } = await getJson('https://himalayas.app/jobs/api?limit=100', { timeout: 20000 });
  return (data.jobs || []).map(j => ({
    title: j.title, company: j.companyName, url: j.applicationLink || j.guid, companyUrl: '', location: (j.locationRestrictions || []).join('; ') || 'Remote', remote: true,
    typeHint: j.employmentType || '', levelHint: j.seniority || '',
    description: htmlToText(j.description || j.excerpt || ''), salary: j.minSalary ? `${j.currency || '$'} ${j.minSalary}–${j.maxSalary || ''}` : '',
    postedAt: toIso(j.pubDate), precision: 'minute', sourceJobId: `him:${j.guid}`,
  }));
}
async function jobicy() {
  const { data } = await getJson('https://jobicy.com/api/v2/remote-jobs?count=50', { timeout: 20000 });
  return (data.jobs || []).map(j => ({
    title: decodeEntities(j.jobTitle), company: j.companyName, url: j.url, location: j.jobGeo || 'Remote', remote: true,
    typeHint: (j.jobType || []).join(' '), levelHint: j.jobLevel || '', description: htmlToText(j.jobDescription || j.jobExcerpt || ''),
    salary: j.annualSalaryMin ? `${j.salaryCurrency || ''} ${j.annualSalaryMin}–${j.annualSalaryMax || ''}` : '',
    postedAt: toIso(j.pubDate), precision: 'minute', sourceJobId: `jobicy:${j.id}`,
  }));
}
async function arbeitnow() {
  const { data } = await getJson('https://www.arbeitnow.com/api/job-board-api', { timeout: 20000 });
  return (data.data || []).map(j => ({
    title: j.title, company: j.company_name, url: j.url, location: j.location, remote: j.remote, typeHint: (j.job_types || []).join(' '),
    description: htmlToText(j.description || ''), skills: (j.tags || []).map(t => ({ name: t, group: 'Listed' })),
    postedAt: toIso(j.created_at), precision: 'minute', sourceJobId: `arbeit:${j.slug}`,
  }));
}
async function remotive() {
  const { data } = await getJson('https://remotive.com/api/remote-jobs?limit=200', { timeout: 30000 });
  return (data.jobs || []).map(j => ({
    title: j.title, company: j.company_name, url: j.url, location: j.candidate_required_location || 'Remote', remote: true,
    typeHint: j.job_type || '', description: htmlToText(j.description || ''), salary: j.salary || '',
    postedAt: toIso(j.publication_date ? j.publication_date + 'Z' : null), precision: 'minute', sourceJobId: `remotive:${j.id}`,
  }));
}
async function startupJobs() {
  const { body, changed } = await getText('https://startup.jobs/feeds/jobs', { headers: { accept: 'application/rss+xml' } });
  if (!changed) return [];
  return feedEntries(body).map(it => {
    const description = xmlText(it, 'content:encoded') || xmlText(it, 'description');
    let title = xmlText(it, 'title'); let company = xmlText(it, 'company') || xmlText(it, 'dc:creator');
    if (!company) { const m = title.match(/^(.*\S)\s+at\s+([^@]+?)\s*$/i); if (m) { title = m[1]; company = m[2]; } }
    return { title, company: company || 'Startup', url: xmlLink(it),
      location: xmlText(it, 'location'), description, postedAt: toIso(xmlTag(it, 'pubDate')), precision: 'minute' };
  });
}
// YC's public jobs page embeds a JSON list of featured postings.
async function ycJobs() {
  const { body } = await getText('https://www.ycombinator.com/jobs', { headers: { accept: 'text/html' } });
  const src = decodeEntities(body); const out = [];
  for (const m of src.matchAll(/"jobPostings":(\[[\s\S]*?\])\s*[,}]/g)) {
    try { for (const j of JSON.parse(m[1])) if (j.url && j.title) out.push({
      title: j.title, company: j.companyName || 'YC startup', url: new URL(j.url, 'https://www.ycombinator.com').href, location: j.location || '',
      typeHint: j.type || '', description: [j.prettyRole, j.salaryRange, j.minExperience, j.visa, ...(j.skills || [])].filter(Boolean).join(' · '),
      skills: (j.skills || []).map(s => ({ name: s, group: 'Listed' })), salary: j.salaryRange || '',
      postedAt: toIso(j.createdAt), precision: precisionOf(j.createdAt), companyMeta: { yc: j.companyBatchName, funded: true, ycSlug: (j.companyUrl || '').split('/').pop() },
    }); } catch { }
  }
  return out;
}

export const JOB_SOURCES = [
  { id: 'linkedin', name: 'LinkedIn (public job search)', every: 240, home: 'https://www.linkedin.com/jobs/search', trust: 'Public listings, read logged out. Searches are set in Settings', run: linkedin },
  { id: 'hn-hiring', name: 'HN: Who is hiring', every: 60, home: 'https://news.ycombinator.com/submitted?id=whoishiring', trust: 'Posted by the hiring company on Hacker News', run: hnWhoIsHiring },
  { id: 'hn-jobs', name: 'HN: YC job posts', every: 60, home: 'https://news.ycombinator.com/jobs', trust: 'Posted by YC companies', run: hnJobStories },
  { id: 'simplify-intern', name: 'Simplify internships (GitHub)', every: 120, home: 'https://github.com/SimplifyJobs/Summer2027-Internships', trust: 'Community-verified list, links to employer ATS', run: simplifyAdapter('https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json', 'intern') },
  { id: 'simplify-newgrad', name: 'Simplify new grad (GitHub)', every: 120, home: 'https://github.com/SimplifyJobs/New-Grad-Positions', trust: 'Community-verified list, links to employer ATS', run: simplifyAdapter('https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json', 'newgrad') },
  { id: 'vansh-intern', name: 'vanshb03 internships (GitHub)', every: 180, home: 'https://github.com/vanshb03/Summer2027-Internships', trust: 'Community-maintained list', run: simplifyAdapter('https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/dev/.github/scripts/listings.json', 'vintern') },
  { id: 'vansh-newgrad', name: 'vanshb03 new grad (GitHub)', every: 180, home: 'https://github.com/vanshb03/New-Grad-2026', trust: 'Community-maintained list', run: simplifyAdapter('https://raw.githubusercontent.com/vanshb03/New-Grad-2026/dev/.github/scripts/listings.json', 'vnewgrad') },
  { id: 'sarthzk-in', name: 'India Tech Internships (GitHub)', every: 300, home: 'https://github.com/Sarthzk/internship-tracker', trust: 'Scraped from company career pages', run: sarthzkIndia },
  { id: 'internscan-in', name: 'InternScan India', every: 1800, home: 'https://internscan.vercel.app/in/', trust: 'Scraped from employer ATS; refreshed daily', run: () => internscan('in') },
  { id: 'internscan-us', name: 'InternScan US', every: 1800, home: 'https://internscan.vercel.app/us/', trust: 'Scraped from employer ATS; refreshed daily', run: () => internscan('us') },
  { id: 'startup-jobs', name: 'Startup.jobs', every: 120, home: 'https://startup.jobs', trust: 'Startup job board', run: startupJobs },
  { id: 'remoteok', name: 'Remote OK', every: 300, home: 'https://remoteok.com', trust: 'Remote job board', run: remoteOk },
  { id: 'wwr', name: 'We Work Remotely', every: 180, home: 'https://weworkremotely.com', trust: 'Remote job board', run: weWorkRemotely },
  { id: 'himalayas', name: 'Himalayas', every: 300, home: 'https://himalayas.app', trust: 'Remote job board', run: himalayas },
  { id: 'jobicy', name: 'Jobicy', every: 900, home: 'https://jobicy.com', trust: 'Remote job board', run: jobicy },
  { id: 'arbeitnow', name: 'Arbeitnow', every: 900, home: 'https://www.arbeitnow.com', trust: 'EU job board', run: arbeitnow },
  { id: 'remotive', name: 'Remotive (24h delayed)', every: 6 * 3600 + 60, home: 'https://remotive.com', trust: 'Remote job board; API delayed 24h, max 4 calls/day', run: remotive },
];
