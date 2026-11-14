// Finds publicly published ways to reach a company: emails on the job post, on the company's
// own website (contact/about/team/careers pages, security.txt), its GitHub org's public email,
// founders listed on its YC profile, and official social profiles. Every contact carries the
// URL it was found on. Pattern guesses (first@domain) are labelled as unverified.
import { getText, htmlToText, domainOf, decodeEntities, pool } from './util.mjs';
import { extractEmails } from './enrich.mjs';

export const NOT_COMPANY_SITES = /(applytojob.com|jazzhr|taleo.net|successfactors|oraclecloud.com|paylocity|adp.com|ultipro|ukg|eightfold.ai|phenompeople|avature|pinpointhq|gem.com|comeet|hiringthing|catsone|gusto.com|jobvite|workforcenow|careers-page.com|ycombinator.com|greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|recruitee\.com|bamboohr\.com|breezy\.hr|jobvite\.com|myworkdayjobs\.com|workday\.com|icims\.com|ycombinator\.com|workatastartup\.com|startup\.jobs|linkedin\.com|indeed\.|glassdoor\.|wellfound\.com|angel\.co|internshala\.com|naukri\.com|instahyre\.com|cutshort\.io|github\.com|githubusercontent\.com|notion\.site|notion\.so|google\.com|forms\.gle|typeform\.com|remoteok|remotive|weworkremotely|arbeitnow|himalayas|jobicy|lensa|jooble|adzuna|ziprecruiter|monster|careerbuilder|news\.ycombinator\.com|simplify\.jobs|jobright\.ai|internscan|vercel\.app|twitter\.com|x\.com|medium\.com|substack\.com|rippling\.com|dover\.com|teamtailor\.com|personio\.|join\.com|keka\.com|zohorecruit|freshteam)/i;

const PATHS = ['', '/contact', '/contact-us', '/about', '/about-us', '/team', '/company', '/careers', '/jobs', '/.well-known/security.txt'];
const SOCIAL = [
  ['linkedin', /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/company\/[A-Za-z0-9_\-%.]+/i],
  ['x', /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/(?!intent|share|home|search)[A-Za-z0-9_]{2,15}(?=["'/?#\s])/i],
  ['github', /https?:\/\/(?:www\.)?github\.com\/(?!features|about|pricing|login|sponsors|orgs\/|topics)[A-Za-z0-9-]{2,39}(?=["'/?#\s])/i],
  ['instagram', /https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9_.]{2,30}(?=["'/?#\s])/i],
];
const NOT_A_PERSON = /^(security|vulnerabilit|vuln|abuse|privacy|legal|press|media|pr|noreply|no-reply|donotreply|do-not-reply|dmca|gdpr|dpo|dataprotection|compliance|accessibility|investors?|ir|billing|invoices?|accounts?|payments?|ap|ar|webmaster|postmaster|hostmaster|unsubscribe|bounce|notifications?|alerts?|status|trust|safety|copyright|report|spam|fraud|disclosure|bugbounty|bug-bounty|psirt|cert|soc|incident)\b/;
const ROLE_HINT = [[/^(jobs|careers|hiring|recruit|talent|hr|people|join)/, 'Hiring'], [/^(founders?|ceo|cto|hello|hi|hey)$/, 'Founders / general'], [/^(contact|info|team|support|help|sales|press|media|partners?)$/, 'General'], [/^(security|abuse)$/, 'Security']];

function roleFor(email) {
  const local = email.split('@')[0];
  for (const [re, r] of ROLE_HINT) if (re.test(local)) return r;
  return /^[a-z]+(\.[a-z]+)?$/.test(local) ? 'Person' : 'General';
}

export function websiteFor(job, company) {
  const cands = [company?.website, job.companyUrl, job.companyMeta?.website, job.applyUrl, job.url];
  for (const c of cands) if (c && /^https?:/i.test(c) && !NOT_COMPANY_SITES.test(c)) { try { return new URL(c).origin; } catch { } }
  return '';
}

async function fetchPage(url) {
  try { const r = await getText(url, { timeout: 9000, conditional: false, headers: { accept: 'text/html,text/plain' } }); return r.body.slice(0, 600000); } catch { return ''; }
}

async function ycFounders(slug) {
  if (!slug) return [];
  const html = await fetchPage(`https://www.ycombinator.com/companies/${encodeURIComponent(slug)}`);
  const m = html.match(/data-page="([^"]+)"/);
  if (!m) return [];
  try {
    const page = JSON.parse(decodeEntities(m[1]));
    const c = page?.props?.company || {};
    return (c.founders || []).map(f => ({ name: f.full_name, role: f.title || 'Founder', linkedin: f.linkedin_url || '', x: f.twitter_url || '', bio: (f.founder_bio || '').slice(0, 300) }));
  } catch { return []; }
}

async function githubOrg(url) {
  const org = url?.match(/github\.com\/([A-Za-z0-9-]+)/)?.[1];
  if (!org) return null;
  try {
    const r = await getText(`https://api.github.com/orgs/${org}`, { timeout: 8000, headers: { accept: 'application/vnd.github+json' } });
    const d = JSON.parse(r.body); return d.email ? { email: d.email.toLowerCase(), url: `https://github.com/${org}` } : null;
  } catch { return null; }
}

function patternGuesses(founders, domain) {
  if (!domain) return [];
  const out = [];
  for (const f of founders.slice(0, 3)) {
    const parts = String(f.name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, '').split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    const [first, last] = [parts[0], parts[parts.length - 1]];
    out.push({ email: `${first}@${domain}`, name: f.name, role: f.role, confidence: 'pattern', source: 'Common startup pattern (unverified)', alt: last && last !== first ? [`${first}.${last}@${domain}`, `${first[0]}${last}@${domain}`] : [] });
  }
  return out;
}

/** Full discovery for one company. Returns { website, emails[], founders[], socials{}, checkedAt, pagesChecked }. */
export async function discoverContacts(job, company = {}) {
  const website = websiteFor(job, company);
  const domain = website ? domainOf(website) : '';
  const found = new Map(); // email -> contact
  const add = (email, source, url, extra = {}) => {
    email = String(email).toLowerCase().trim().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$/.test(email) || /@www\./.test(email)) return; // "more@www.x.com" is a scraping artifact
    if (NOT_A_PERSON.test(email.split('@')[0])) return; // security@, press@, privacy@… are never the right inbox for a job
    if (found.has(email)) return;
    const onDomain = domain && (email.endsWith('@' + domain) || email.endsWith('.' + domain));
    found.set(email, { email, role: roleFor(email), source, url, confidence: onDomain || source === 'Job posting' ? 'published' : 'published-offdomain', ...extra });
  };
  for (const e of job.emails || []) add(e, 'Job posting', job.applyUrl || job.url);

  const socials = { ...(company.socials || {}) };
  for (const [k, re] of SOCIAL) if (!socials[k]) { const m = `${job.description || ''} `.match(re); if (m) socials[k] = m[0]; }
  const pagesChecked = [];
  if (website) {
    const pages = await pool(PATHS, 4, async p => ({ p, url: website + p, html: await fetchPage(website + p) }));
    for (const { url, html } of pages) {
      if (!html || html.length < 40) continue;
      pagesChecked.push(url);
      const mailtos = [...html.matchAll(/mailto:([^"'?>\s]+)/gi)].map(m => decodeURIComponent(m[1]));
      for (const e of [...mailtos, ...extractEmails(htmlToText(html))]) if (/@/.test(e)) add(e, url.endsWith('security.txt') ? 'security.txt' : 'Company website', url);
      for (const [k, re] of SOCIAL) if (!socials[k]) { const m = html.match(re); if (m) socials[k] = m[0].replace(/["']$/, ''); }
    }
  }
  const gh = await githubOrg(socials.github);
  if (gh) add(gh.email, 'GitHub organization profile', gh.url);

  const founders = company.founders?.length ? company.founders : await ycFounders(company.ycSlug || job.companyMeta?.ycSlug);
  const emails = [...found.values()].filter(c => c.role !== 'Security' && (!domain || c.confidence === 'published' || found.size < 4));
  const guesses = emails.some(c => c.role === 'Person' || c.role === 'Founders / general') ? [] : patternGuesses(founders, domain);
  // Rank: hiring/founder addresses first, then people, then general inboxes.
  const rank = { 'Hiring': 0, 'Founders / general': 1, 'Person': 2, 'General': 3, 'Security': 4 };
  emails.sort((a, b) => (rank[a.role] ?? 5) - (rank[b.role] ?? 5));
  return { v: 2, website, domain, emails, guesses, founders, socials, pagesChecked, checkedAt: new Date().toISOString() };
}
