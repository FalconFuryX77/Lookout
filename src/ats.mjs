// Applicant-tracking-system detection and polling. Polling a company's own ATS is the
// fastest trustworthy signal: the posting appears there before any aggregator copies it.
import { getText, getJson, htmlToText, toIso, precisionOf, decodeEntities } from './util.mjs';

const DETECT = [
  ['greenhouse', /(?:boards|job-boards)(?:-api)?\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=|v1\/boards\/)?([A-Za-z0-9_-]+)/i],
  ['lever', /jobs\.lever\.co\/([A-Za-z0-9_.-]+)/i],
  ['ashby', /jobs\.ashbyhq\.com\/([A-Za-z0-9_.%-]+)/i],
  ['workable', /apply\.workable\.com\/(?!api)([A-Za-z0-9_-]+)/i],
  ['smartrecruiters', /(?:careers|jobs)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/i],
  ['recruitee', /([A-Za-z0-9-]+)\.recruitee\.com/i],
  ['workday', /\/\/((?:wd\d+\.)?myworkdaysite\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?recruiting\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+)/i, m => m[1].replace(/\/(?:[a-z]{2}-[A-Z]{2}\/)?recruiting\//, '/')],
  ['oracle', /\/\/([a-z0-9-]+\.fa(?:\.[a-z0-9-]+)*\.oraclecloud\.com)\/hcmUI\/CandidateExperience\/[a-z]{2}(?:-[A-Z]{2})?\/sites\/([A-Za-z0-9_]+)/i, m => `${m[1].toLowerCase()}/${m[2]}`],
];
const BAD_SLUGS = new Set(['embed', 'js', 'api', 'v1', 'jobs', 'careers', 'static', 'assets', 'www', 'boards', 'job_board', 'cdn']);

export function detectInText(text) {
  for (const [provider, re, build] of DETECT) {
    const m = String(text).match(re);
    if (m && build) return { provider, board: build(m) };
    if (m && m[1] && !BAD_SLUGS.has(m[1].toLowerCase())) return { provider, board: decodeURIComponent(m[1]).replace(/\.$/, '') };
  }
  return null;
}

/** Look at the company site + its careers pages and find which ATS it uses. */
export async function detectAts(website, nameHint = '') {
  if (!website) return null;
  const origin = new URL(website).origin;
  for (const p of ['', '/careers', '/jobs', '/careers/', '/company/careers', '/join', '/join-us']) {
    try {
      const r = await getText(origin + p, { timeout: 9000, conditional: false, headers: { accept: 'text/html' } });
      const hit = detectInText(r.url) || detectInText(r.body);
      if (hit) return hit;
    } catch { }
  }
  // No guessing board names from the company name: generic names ("elite", "orchestra") belong to
  // unrelated companies. A board counts only when the company's own site links to it.
  return null;
}

/** Fetch all current postings of one ATS board as normalized postings (minus `source`). */
export async function fetchBoard({ provider, board, company, known, state }) {
  const b = encodeURIComponent(board);
  if (provider === 'greenhouse') {
    const { data } = await getJson(`https://boards-api.greenhouse.io/v1/boards/${b}/jobs?content=true`, { timeout: 15000 });
    return (data.jobs || []).map(j => ({
      sourceJobId: `gh:${board}:${j.id}`, title: j.title, company: company || j.company_name || board,
      url: j.absolute_url, location: j.location?.name || '', description: htmlToText(j.content || ''),
      // Greenhouse only exposes updated_at; first_published exists on newer boards.
      postedAt: toIso(j.first_published || j.updated_at), precision: j.first_published ? 'minute' : 'date',
    }));
  }
  if (provider === 'lever') {
    const { data } = await getJson(`https://api.lever.co/v0/postings/${b}?mode=json`, { timeout: 15000 });
    return (Array.isArray(data) ? data : []).map(j => ({
      sourceJobId: `lever:${board}:${j.id}`, title: j.text, company: company || board, url: j.hostedUrl, applyUrl: j.applyUrl,
      location: [j.categories?.location, ...(j.categories?.allLocations || [])].filter(Boolean).join('; '),
      typeHint: j.categories?.commitment || '', remote: j.workplaceType === 'remote' ? true : undefined,
      description: [j.descriptionPlain, ...(j.lists || []).map(l => `${l.text}\n${htmlToText(l.content)}`), j.additionalPlain].filter(Boolean).join('\n\n'),
      postedAt: toIso(j.createdAt), precision: 'minute', salary: j.salaryRange ? `${j.salaryRange.currency || ''} ${j.salaryRange.min}–${j.salaryRange.max} ${j.salaryRange.interval || ''}`.trim() : '',
    }));
  }
  if (provider === 'ashby') {
    const { data } = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${b}?includeCompensation=true`, { timeout: 15000 });
    return (data.jobs || []).filter(j => j.isListed !== false).map(j => ({
      sourceJobId: `ashby:${board}:${j.id || j.jobUrl}`, title: j.title, company: company || board, url: j.jobUrl, applyUrl: j.applyUrl,
      location: [j.location, ...(j.secondaryLocations || []).map(l => l.location)].filter(Boolean).join('; '),
      remote: j.isRemote, typeHint: j.employmentType || '', description: j.descriptionPlain || htmlToText(j.descriptionHtml || ''),
      postedAt: toIso(j.publishedAt), precision: precisionOf(j.publishedAt), salary: j.compensation?.compensationTierSummary || '',
    }));
  }
  if (provider === 'workable') {
    const { data } = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${b}?details=true`, { timeout: 15000 });
    return (data.jobs || []).map(j => ({
      sourceJobId: `workable:${board}:${j.shortcode}`, title: j.title, company: company || data.name || board, url: j.url || j.shortlink,
      location: [j.city, j.state, j.country].filter(Boolean).join(', '), remote: j.telecommuting, typeHint: j.employment_type || '',
      description: htmlToText(j.description || ''), postedAt: toIso(j.published_on || j.created_at), precision: precisionOf(j.published_on || j.created_at),
    }));
  }
  if (provider === 'smartrecruiters') {
    const { data } = await getJson(`https://api.smartrecruiters.com/v1/companies/${b}/postings?limit=100`, { timeout: 15000 });
    return (data.content || []).map(j => ({
      sourceJobId: `sr:${board}:${j.id}`, title: j.name, company: company || j.company?.name || board, url: `https://jobs.smartrecruiters.com/${board}/${j.id}`,
      location: [j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(', '), remote: j.location?.remote,
      typeHint: j.typeOfEmployment?.label || '', levelHint: j.experienceLevel?.label || j.experienceLevel?.id || '', description: `${j.department?.label || ''} ${j.function?.label || ''}`.trim(),
      postedAt: toIso(j.releasedDate), precision: 'minute',
    }));
  }
  if (provider === 'recruitee') {
    const { data } = await getJson(`https://${b}.recruitee.com/api/offers/`, { timeout: 15000 });
    return (data.offers || []).map(j => ({
      sourceJobId: `recruitee:${board}:${j.id}`, title: j.title, company: company || j.company_name || board, url: j.careers_url,
      location: j.location || [j.city, j.country].filter(Boolean).join(', '), remote: j.remote, typeHint: j.employment_type_code || '', levelHint: j.experience_code || '',
      description: htmlToText(`${j.description || ''}\n${j.requirements || ''}`), postedAt: toIso((j.published_at || j.created_at || '').replace(' UTC', 'Z').replace(' ', 'T')), precision: 'minute',
    }));
  }
  if (provider === 'yc') {
    // YC company profile embeds that company's Work at a Startup postings.
    const { body } = await getText(`https://www.ycombinator.com/companies/${b}`, { timeout: 15000, headers: { accept: 'text/html' } });
    const m = body.match(/data-page="([^"]+)"/); if (!m) return [];
    const page = JSON.parse(decodeEntities(m[1])); const c = page.props?.company || {};
    return (page.props?.jobPostings || []).map(j => ({
      sourceJobId: `yc:${j.id}`, title: j.title, company: company || j.companyName || c.name, url: new URL(j.url, 'https://www.ycombinator.com').href,
      companyUrl: c.website || '', location: j.location || '', typeHint: j.type || '',
      description: [j.prettyRole, j.roleSpecificType, j.minExperience && `Experience: ${j.minExperience}`, j.salaryRange && `Salary: ${j.salaryRange}`, j.equityRange && `Equity: ${j.equityRange}`, j.visa, c.one_liner].filter(Boolean).join('\n'),
      skills: (j.skills || []).map(s => ({ name: typeof s === 'string' ? s : s.name, group: 'Listed' })), salary: j.salaryRange || '',
      postedAt: toIso(j.createdAt || j.created_at), precision: precisionOf(j.createdAt || j.created_at),
      companyMeta: { yc: j.companyBatchName || c.batch_name, funded: true, ycSlug: board, website: c.website },
    }));
  }
  if (provider === 'workday' || provider === 'oracle') return pagedBoard(provider, board, company, known, state);
  throw new Error(`Unsupported ATS ${provider}`);
}

export const ATS_PROVIDERS = ['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'recruitee', 'yc', 'workday', 'oracle'];

// ── Workday (myworkdaysite.com) and Oracle Cloud recruiting ───────────────────────────────────────
// Both list a company's roles newest first, a page at a time, without descriptions. Each poll reads the
// newest pages until it meets roles it already has, then keeps walking older pages where the last poll
// stopped, fetching full details for at most DETAIL_BUDGET new roles. Big employers fill in over a few polls.
// Workday's main domain (myworkdayjobs.com) answers automated requests with a security check, so it is not
// polled; only the myworkdaysite.com tenants that answer normally are.
const DETAIL_BUDGET = 20;
const BLOCKED = /Security Check|Enable JavaScript and cookies|cf-chl|Just a moment/i;
async function fetchJson(url, { method = 'GET', body } = {}) {
  const r = await fetch(url, { method, headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', accept: 'application/json', 'accept-language': 'en', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  if (!r.ok || BLOCKED.test(text.slice(0, 2000)) && !text.trimStart().startsWith('{')) { const e = new Error(BLOCKED.test(text) ? 'this careers site asks for a browser security check; not polled' : `HTTP ${r.status}`); e.status = r.status || 429; throw e; }
  return JSON.parse(text);
}
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10) + 'T00:00:00.000Z';
function workdayPosted(s = '') { // "Posted Today", "Posted Yesterday", "Posted 3 Days Ago", "Posted 30+ Days Ago"
  if (/today/i.test(s)) return daysAgo(0); if (/yesterday/i.test(s)) return daysAgo(1);
  const n = s.match(/(\d+)\+?\s*day/i); return n ? daysAgo(Number(n[1])) : null;
}
const PLATFORM = {
  workday: board => {
    const [host, tenant, site] = board.split('/'); const api = `https://${host}/wday/cxs/${tenant}/${site}`;
    return {
      size: 20,
      list: async offset => ((await fetchJson(`${api}/jobs`, { method: 'POST', body: { appliedFacets: {}, limit: 20, offset, searchText: '' } })).jobPostings || []),
      url: p => `https://${host}/recruiting/${tenant}/${site}${p.externalPath}`,
      detail: async (p, company) => {
        const i = (await fetchJson(`${api}${p.externalPath}`)).jobPostingInfo || {};
        return { sourceJobId: `wd:${tenant}:${i.jobReqId || p.externalPath}`, title: i.title || p.title, company, location: i.location || p.locationsText || '', typeHint: i.timeType || '', description: htmlToText(i.jobDescription || ''), postedAt: i.startDate ? `${String(i.startDate).slice(0, 10)}T00:00:00.000Z` : workdayPosted(p.postedOn), precision: 'date' };
      },
    };
  },
  oracle: board => {
    const [host, site] = board.split('/'); const api = `https://${host}/hcmRestApi/resources/latest`;
    return {
      size: 25,
      list: async offset => ((await fetchJson(`${api}/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=${site},limit=25,offset=${offset},sortBy=POSTING_DATES_DESC`)).items?.[0]?.requisitionList || []),
      url: p => `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${p.Id}`,
      detail: async (p, company) => {
        const d = (await fetchJson(`${api}/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22${encodeURIComponent(p.Id)}%22,siteNumber=${site}`)).items?.[0] || {};
        const posted = d.ExternalPostedStartDate || p.PostedDate;
        return { sourceJobId: `oracle:${host}:${p.Id}`, title: d.Title || p.Title, company, location: [p.PrimaryLocation, p.WorkplaceType].filter(Boolean).join(' · ') || d.PrimaryLocation || '', typeHint: d.JobSchedule || p.JobSchedule || '', levelHint: d.JobLevel || '', description: htmlToText([d.ExternalDescriptionStr, d.ExternalResponsibilitiesStr, d.ExternalQualificationsStr].filter(Boolean).join('\n')), postedAt: toIso(posted), precision: /T\d/.test(posted || '') ? 'minute' : 'date' };
      },
    };
  },
};
async function pagedBoard(provider, board, company, known = () => false, state = {}) {
  const P = PLATFORM[provider](board); const out = []; let budget = DETAIL_BUDGET;
  const take = async page => { // returns true when every role on the page is stored or already known
    let done = true;
    for (const p of page) {
      const url = P.url(p); if (known(url)) continue;
      if (budget <= 0) { done = false; continue; }
      budget--; try { out.push({ ...(await P.detail(p, company || board)), url }); } catch (e) { if (e.status === 429) throw e; done = false; }
      await new Promise(r => setTimeout(r, 250));
    }
    return done;
  };
  // 1. newest roles first, until a page holds nothing new
  for (let off = 0; off < P.size * 5 && budget > 0; off += P.size) {
    const page = await P.list(off); if (!page.length) { state.end = true; break; }
    const fresh = page.some(p => !known(P.url(p))); await take(page);
    if (!fresh) break;
  }
  // 2. carry on into older roles where the last poll stopped
  for (let off = Math.max(state.next || 0, P.size); !state.end && budget > 0 && off < 600; off += P.size) {
    const page = await P.list(off); if (!page.length) { state.end = true; break; }
    if (await take(page)) state.next = off + P.size; else break;
  }
  return out;
}
