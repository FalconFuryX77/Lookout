// Cross-source deduplication. Two postings are the same job when either
//  (a) their canonical apply/listing URLs match, or
//  (b) normalized company + normalized title match and their locations don't conflict.
import { canonicalUrl } from './util.mjs';
import { bestLink, linkRank } from './root.mjs';

const COMPANY_NOISE = /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|pvt|private|corp|corporation|co|company|gmbh|s\.a|sa|plc|bv|ag|technologies|technology|tech|labs?|software|solutions|systems|ai|hq|group|holdings|the)\b/g;
export function normCompany(name = '') {
  return String(name).toLowerCase()
    .replace(/\((?:[swfx]|summer|winter|fall|spring)\s?'?\d{2,4}\)/gi, '') // YC batch tags like (W24)
    .replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(COMPANY_NOISE, ' ')
    .replace(/\s+/g, ' ').trim() || String(name).toLowerCase().trim();
}

const TITLE_NOISE = /\b(summer|winter|fall|spring|autumn|20\d\d|remote|hybrid|onsite|on-site|in-office|immediate joiner|urgent|hiring|new|m\/f\/d|f\/m\/d|w\/m\/d|x\/f\/m|f\/m\/x|f\/h|h\/f|the|of|and|a|an|for|in|to|with)\b/g;
const TITLE_SYNONYMS = [[/\bsr\b\.?/g, 'senior'], [/\bjr\b\.?/g, 'junior'], [/\bswe\b/g, 'software engineer'], [/\bsde\b/g, 'software engineer'], [/\bml\b/g, 'machine learning'], [/\bfront[\s-]?end\b/g, 'frontend'], [/\bback[\s-]?end\b/g, 'backend'], [/\bfull[\s-]?stack\b/g, 'fullstack'], [/\bdeveloper\b/g, 'engineer'], [/\binternship\b/g, 'intern'], [/\bengineering\b/g, 'engineer'], [/\bengg?\b/g, 'engineer'], [/\bco-?op\b/g, 'coop'], [/\bph\.?d\.?\b/g, 'phd']];
// Suffix / parenthetical segments that only describe where or when — safe to drop.
const PLACE_OR_TIME = /^(remote|hybrid|on-?site|in-office|anywhere|global|worldwide|us|usa|uk|eu|emea|apac|latam|canada|india|europe|united states|united kingdom|multiple locations|\d+ locations?|(?:summer|winter|fall|spring|autumn)(?: ?20\d\d)?(?: start)?|20\d\d|(?:start(?:ing)? )?(?:january|february|march|april|may|june|july|august|september|october|november|december)(?: 20\d\d)?|new grad|immediate joiner|urgent|full[- ]time|part[- ]time|contract)$/;
const PLACE_WORD = /^(san francisco|sf|new york|nyc|seattle|austin|boston|chicago|los angeles|london|berlin|paris|toronto|vancouver|bengaluru|bangalore|hyderabad|pune|mumbai|delhi|gurugram|gurgaon|noida|chennai|singapore|dubai|amsterdam|munich|sydney|remote,? .*|.*, [a-z]{2}|.*, (?:usa|us|uk|india|canada))$/;
export function normTitle(title = '') {
  const raw = String(title).toLowerCase();
  const segs = [];
  let main = raw.replace(/\(([^)]*)\)|\[([^\]]*)\]/g, (_, a, b) => { segs.push((a ?? b).trim()); return ' '; });
  const parts = main.split(/\s[-–—|@]\s|\s+at\s+/); main = parts.shift();
  segs.push(...parts.map(p => p.trim()));
  // keep descriptive segments ("Intern - Software" vs "Intern - Mechanical"), drop place/time ones
  const kept = segs.filter(sg => sg && !PLACE_OR_TIME.test(sg) && !PLACE_WORD.test(sg) && !/^\d+$/.test(sg) && !/^(?:req|ref|job)[ .#:-]/.test(sg));
  let s = [main, ...kept].join(' ');
  for (const [re, to] of TITLE_SYNONYMS) s = s.replace(re, to);
  const words = s.replace(/[^a-z0-9 ]+/g, ' ').replace(TITLE_NOISE, ' ').split(/\s+/).filter(Boolean);
  return [...new Set(words)].sort().join(' '); // word order doesn't matter ("Intern, System Architecture")
}

export function fingerprint(job) { return `${normCompany(job.company)}|${normTitle(job.title)}`; }

const CITY_ALIAS = { sf: 'san francisco', 'san francisco bay area': 'san francisco', nyc: 'new york', 'new york city': 'new york', bangalore: 'bengaluru', gurgaon: 'gurugram', 'washington dc': 'washington', 'washington d.c.': 'washington' };
function cities(loc = '') {
  return new Set(String(loc).toLowerCase().split(/;|\||\/| or /).map(x => x.split(',')[0].trim()).map(x => CITY_ALIAS[x] || x)
    .filter(x => x && x.length > 1 && !/\b(?:remote|anywhere|multiple|locations?|hybrid|united states|usa|india|canada|uk|europe|worldwide)\b/.test(x)));
}
export function locationsConflict(a, b) {
  const ca = a.country, cb = b.country;
  const vague = c => !c || c === 'Unknown' || c.startsWith('Remote');
  if (!vague(ca) && !vague(cb) && ca !== cb) return true;
  const A = cities(a.location), B = cities(b.location);
  if (!A.size || !B.size) return false;
  for (const c of A) if (B.has(c)) return false;
  return true;
}

const REPOST_GAP_DAYS = 21;

export class Deduper {
  constructor() { this.byUrl = new Map(); this.byFp = new Map(); }
  index(job) {
    for (const u of job.urls || [job.url]) if (u) this.byUrl.set(canonicalUrl(u), job.id);
    const fp = fingerprint(job);
    const list = this.byFp.get(fp) || []; if (!list.includes(job.id)) list.push(job.id); this.byFp.set(fp, list);
  }
  unindex(job) {
    for (const u of job.urls || [job.url]) if (u && this.byUrl.get(canonicalUrl(u)) === job.id) this.byUrl.delete(canonicalUrl(u));
    const fp = fingerprint(job); const list = (this.byFp.get(fp) || []).filter(id => id !== job.id);
    list.length ? this.byFp.set(fp, list) : this.byFp.delete(fp);
  }
  /** Returns the id of an existing job this posting duplicates, or null. */
  match(posting, getJob) {
    for (const u of [posting.url, posting.applyUrl]) { const id = u && this.byUrl.get(canonicalUrl(u)); if (id) return id; }
    const termsConflict = (a, b) => a.terms?.length && b.terms?.length && !a.terms.some(t => b.terms.includes(t)); // Summer vs Winter internship
    // Same title at the same company weeks later is a new opening (or a re-post worth seeing again), not the old one.
    const farApart = (a, b) => a.postedAt && b.postedAt && Math.abs(Date.parse(a.postedAt) - Date.parse(b.postedAt)) > REPOST_GAP_DAYS * 864e5;
    for (const id of this.byFp.get(fingerprint(posting)) || []) { const j = getJob(id); if (j && !locationsConflict(j, posting) && !termsConflict(j, posting) && !farApart(j, posting)) return id; }
    return null;
  }
}

/** Merge a new sighting of a job into an existing record (mutates and returns `job`). */
export function mergeInto(job, p) {
  const src = { source: p.source, url: p.url, postedAt: p.postedAt, precision: p.precision, seenAt: new Date().toISOString() };
  if (!job.sources.some(s => s.source === p.source)) job.sources.push(src);
  job.urls = [...new Set([...(job.urls || []), p.url, p.applyUrl].filter(Boolean))];
  // Prefer the most precise / earliest posting time across sources.
  const better = (p.precision === 'minute' && job.precision !== 'minute') || (p.postedAt && (!job.postedAt || (p.precision === job.precision && p.postedAt < job.postedAt)));
  if (better && p.postedAt) { job.postedAt = p.postedAt; job.precision = p.precision; }
  if ((p.description || '').length > (job.description || '').length) { job.description = p.description; job.requirements = p.requirements; }
  if (!job.applyUrl && p.applyUrl) job.applyUrl = p.applyUrl;
  // Apply opens the most direct link on file: the employer's own listing beats any board's copy of it.
  { const best = bestLink(job.urls, job.company); if (best && linkRank(best, job.company) > linkRank(job.applyUrl || job.url, job.company)) job.applyUrl = best; }
  if (!job.levelHint && p.levelHint) job.levelHint = p.levelHint;
  if (p.type === 'Internship' && job.type !== 'Internship' && job.level !== 'Senior' && job.level !== 'Senior+') { job.type = 'Internship'; job.level = 'Intern'; }
  if (!job.salary && p.salary) job.salary = p.salary;
  if ((!job.companyUrl) && p.companyUrl) job.companyUrl = p.companyUrl;
  if (!job.companyMeta && p.companyMeta) job.companyMeta = p.companyMeta;
  if (p.companyMeta && job.companyMeta) job.companyMeta = { ...p.companyMeta, ...job.companyMeta };
  const names = new Set(job.skills.map(s => s.name.toLowerCase()));
  for (const s of p.skills || []) if (!names.has(s.name.toLowerCase())) job.skills.push(s);
  job.emails = [...new Set([...(job.emails || []), ...(p.emails || [])])];
  if (job.country === 'Unknown' && p.country !== 'Unknown') { job.country = p.country; job.location = p.location; }
  job.lastSeen = new Date().toISOString();
  return job;
}
