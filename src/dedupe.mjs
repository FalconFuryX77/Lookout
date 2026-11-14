// Cross-source deduplication. Two postings are the same job when either
//  (a) their canonical apply/listing URLs match, or
//  (b) normalized company + normalized title match and their locations don't conflict.
import { canonicalUrl } from './util.mjs';

const COMPANY_NOISE = /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|pvt|private|corp|corporation|co|company|gmbh|s\.a|sa|plc|bv|ag|technologies|technology|tech|labs?|software|solutions|systems|ai|hq|group|holdings|the)\b/g;
export function normCompany(name = '') {
  return String(name).toLowerCase()
    .replace(/\((?:[swfx]|summer|winter|fall|spring)\s?'?\d{2,4}\)/gi, '') // YC batch tags like (W24)
    .replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(COMPANY_NOISE, ' ')
    .replace(/\s+/g, ' ').trim() || String(name).toLowerCase().trim();
}

const TITLE_NOISE = /\b(summer|winter|fall|spring|autumn|20\d\d|remote|hybrid|onsite|on-site|in-office|immediate joiner|urgent|hiring|new|m\/f\/d|f\/m\/d|w\/m\/d)\b/g;
const TITLE_SYNONYMS = [[/\bsr\b\.?/g, 'senior'], [/\bjr\b\.?/g, 'junior'], [/\bswe\b/g, 'software engineer'], [/\bsde\b/g, 'software engineer'], [/\bml\b/g, 'machine learning'], [/\bai\b/g, 'ai'], [/\bfront[\s-]?end\b/g, 'frontend'], [/\bback[\s-]?end\b/g, 'backend'], [/\bfull[\s-]?stack\b/g, 'fullstack'], [/\bdeveloper\b/g, 'engineer'], [/\binternship\b/g, 'intern'], [/\bengg?\b/g, 'engineer']];
export function normTitle(title = '') {
  let s = String(title).toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  s = s.split(/\s[-–—|@]\s| at /)[0]; // drop " - Bangalore", " | Remote", " at Acme"
  for (const [re, to] of TITLE_SYNONYMS) s = s.replace(re, to);
  return s.replace(TITLE_NOISE, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function fingerprint(job) { return `${normCompany(job.company)}|${normTitle(job.title)}`; }

function locationsConflict(a, b) {
  const ca = a.country, cb = b.country;
  const vague = c => !c || c === 'Unknown' || c.startsWith('Remote');
  if (vague(ca) || vague(cb)) return false;
  return ca !== cb;
}

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
    for (const id of this.byFp.get(fingerprint(posting)) || []) { const j = getJob(id); if (j && !locationsConflict(j, posting)) return id; }
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
