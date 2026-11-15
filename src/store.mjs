// Persistent state (JSON on disk, atomic writes) + the job ingestion path with dedupe.
import fs from 'node:fs/promises';
import path from 'node:path';
import { Deduper, mergeInto, normCompany } from './dedupe.mjs';
import { bestLink, linkRank } from './root.mjs';
import { enrich, inferCountry, inferType, relevel, extractSalary, extractEmails, cleanSalary, requirementLines } from './enrich.mjs';
import { hash, domainOf, canonicalUrl } from './util.mjs';
import { deepAttributes } from './taxonomy.mjs';

const MAX_JOBS = 12000;        // everything that is not early-career: newest first
const MAX_EARLY = 15000;       // internships, apprenticeships and entry-level are kept on top of that
const MAX_AGE_DAYS = 60;
const isEarly = j => j.type === 'Internship' || j.type === 'Apprenticeship' || j.level === 'Intern' || j.level === 'Entry';

export const DEFAULT_FILTER_SETS = [
  { id: 'fs-india-intern', name: 'India · software internships', alert: true, filters: { stages: ['Internship'], fields: ['Software & IT'], countries: ['India', 'Remote (global)'], age: '7d' } },
  { id: 'fs-fresh-early', name: 'Fresh software roles, 0–2 yrs', alert: true, filters: { fields: ['Software & IT'], stages: ['Internship', 'Apprenticeship', 'Entry'], age: '1h' } },
  { id: 'fs-funded', name: 'Just-funded startups', alert: false, filters: { fundedOnly: true, excludeFields: ['Core Engineering'], expMax: 3, age: '7d' } },
];

export function emptyState() {
  return {
    version: 2,
    jobs: [],               // deduplicated job records
    companies: {},          // normCompany -> { name, domain, website, funding: [...], yc, founders, contacts, ats }
    funding: [],            // funding news items
    filterSets: DEFAULT_FILTER_SETS,
    tracking: {},           // jobId -> { status: saved|applied|contacted|interview|rejected|hidden, note, at }
    watch: [],              // user-added ATS boards { id, name, provider, board }
    settings: { ntfyServer: 'https://ntfy.sh', ntfyTopic: '', ntfyToken: '', desktopNotify: true, quietHours: '', profile: { name: '', pitch: '', skills: [], link: '' } },
    profiles: [],           // one entry per person; the open one's views, pipeline and profile live in the fields above
    activeProfile: '',
    sourceStatus: {},       // sourceId -> { ok, at, added, error, ms }
    alerts: [],             // recent alert log
    lastScan: null,
  };
}

export class Store {
  constructor(dir) {
    this.dir = dir; this.file = path.join(dir, 'db.json');
    this.state = emptyState(); this.dedupe = new Deduper(); this.byId = new Map();
    this.dirty = false; this.listeners = new Set(); this.gone = new Set();
  }
  async load() {
    await fs.mkdir(this.dir, { recursive: true });
    try {
      const saved = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.state = { ...emptyState(), ...saved, settings: { ...emptyState().settings, ...(saved.settings || {}) } };
      // upgrade untouched v1 default sets to the new defaults
      const OLD = ['India internships', 'Fresh early-career roles (last hour)', 'Recently funded startups'];
      this.state.filterSets = this.state.filterSets.map(fs => OLD.includes(fs.name) ? (DEFAULT_FILTER_SETS.find(d => d.id === fs.id) || fs) : fs);
    } catch { /* first run */ }
    this.gone = new Set(this.state.gone || []); delete this.state.gone;
    if (this.state.reenriched !== 4) { // recompute fields whose extractors improved
      for (const j of this.state.jobs) {
        const text = j.description || '';
        if (j.location) j.country = inferCountry(j.location);
        j.salary = cleanSalary(extractSalary(text) || j.salary, j.type);
        j.emails = (j.emails || []).filter(e => extractEmails(e).length);
        j.requirements = requirementLines(text);
      }
      this.state.reenriched = 4; this.dirty = true;
    }
    if (this.state.levelRules !== 1) { // internship + seniority rules were rewritten; reclassify what is stored
      const LISTS = /^(simplify-intern|vansh-intern|sarthzk|internscan)|^gh:.*intern/i;
      for (const j of this.state.jobs) {
        const text = j.description || '';
        const fromList = j.sources.some(s => LISTS.test(s.source));
        const t = inferType(j.title, j.type === 'Internship' ? 'internship' : '', text);
        if (t === 'Internship' || t === 'Apprenticeship') j.type = t;
        else if (j.type === 'Internship' && !fromList) j.type = t;
        Object.assign(j, deepAttributes(j)); relevel(j);
      }
      // The old size cap had thrown away most early-career roles older than a few days. Forget those
      // tombstones (and the "nothing changed" markers) once, so the next scans bring them back.
      this.gone = new Set(); this.state.httpValidators = {};
      this.state.levelRules = 1; this.dirty = true;
    }
    if (this.state.dedupeRepair !== 1) {
      // An early version of the matcher ignored cities, so one record could swallow the same title in
      // twenty different towns, and those listings then counted as "already seen" for good. Keep only the
      // links each record's own sources reported; the next scans sort the rest out under today's rules.
      let fixed = 0, freed = 0;
      for (const j of this.state.jobs) {
        const own = new Set([j.url, j.applyUrl, ...j.sources.map(s => s.url)].filter(Boolean).map(canonicalUrl));
        const kept = (j.urls || []).filter(u => own.has(canonicalUrl(u)));
        if (kept.length === (j.urls || []).length) continue;
        freed += j.urls.length - kept.length; fixed++; j.urls = kept;
        const first = j.sources.find(s => s.postedAt); if (first) { j.postedAt = first.postedAt; j.precision = first.precision || j.precision; }
      }
      if (fixed) console.log(`store: released ${freed} listings that had been folded into ${fixed} other records`);
      if (fixed) { this.state.httpValidators = {}; this.repaired = true; } // re-read every board once, even ones that say "nothing changed"
      this.state.dedupeRepair = 1; this.dirty = true;
    }
    if (this.state.rootLinks !== 1) { // Apply should open the most direct link a role has, not a job board's copy of it
      let n = 0;
      for (const j of this.state.jobs) { const best = bestLink(j.urls || []); if (best && linkRank(best) > linkRank(j.applyUrl || j.url)) { j.applyUrl = best; n++; } }
      if (n) console.log(`store: ${n} roles now open the employer's own listing instead of a job board's copy`);
      this.state.rootLinks = 1; this.dirty = true;
    }
    if (this.state.undatedListPurge !== 1) { // undated rows that only came from community lists aren't trustworthy
      const before = this.state.jobs.length;
      this.state.jobs = this.state.jobs.filter(j => j.postedAt || this.state.tracking[j.id] || !j.sources.every(s => s.source.startsWith('gh:')));
      this.state.undatedListPurge = 1; this.dirty = true;
      if (before !== this.state.jobs.length) console.log(`store: purged ${before - this.state.jobs.length} undated community-list rows`);
    }
    if (this.state.backfillMigrated !== 2) { for (const j of this.state.jobs) if (!j.postedAt) j.backfill = true; this.state.backfillMigrated = 2; this.dirty = true; }
    for (const j of this.state.jobs) { if (j.backfill === undefined && !j.postedAt && j.sources?.some(s => s.source === 'ats' || s.source.startsWith('gh:'))) j.backfill = true; delete j.category; Object.assign(j, deepAttributes(j)); this.byId.set(j.id, j); this.dedupe.index(j); }
  }
  // One write at a time: two overlapping saves would fight over the same temp file.
  save() { return (this.saving = (this.saving || Promise.resolve()).catch(() => { }).then(() => this.writeNow())); }
  async writeNow() {
    if (!this.dirty) return; this.dirty = false;
    const tmp = this.file + '.tmp';
    this.state.gone = [...this.gone].slice(-80000);
    const body = JSON.stringify(this.state); delete this.state.gone;
    await fs.writeFile(tmp, body);
    await fs.rename(tmp, this.file);
  }
  touch() { this.dirty = true; }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data) { for (const fn of this.listeners) try { fn(type, data); } catch { } }

  company(name) { return this.state.companies[normCompany(name)]; }
  upsertCompany(name, patch) {
    const key = normCompany(name); if (!key) return null;
    const c = this.state.companies[key] || { name, key, funding: [], founders: [], contacts: null };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null || v === '') continue;
      if (k === 'funding') { for (const f of v) if (!c.funding.some(x => x.url === f.url)) c.funding.push(f); }
      else if (k === 'founders') { if (v.length) c.founders = v; }
      else c[k] = v;
    }
    if (!c.domain && c.website) c.domain = domainOf(c.website);
    this.state.companies[key] = c; this.touch(); return c;
  }

  /**
   * Ingest one normalized posting. Returns { job, isNew } — isNew=false when it merged into
   * an existing record from another (or the same) source.
   */
  ingest(raw) {
    // Fast path: same source re-reporting a job we already have (most of every poll).
    const quick = raw.url && this.dedupe.byUrl.get(canonicalUrl(raw.url));
    if (quick) { const j = this.byId.get(quick); if (j && j.sources.some(s => s.source === raw.source)) {
      j.lastSeen = new Date().toISOString();
      const hint = raw.levelHint || raw.level; // sources that state seniority: pick it up for roles stored before we read it
      if (hint && !j.levelHint) { j.levelHint = Array.isArray(hint) ? hint.join(' ') : String(hint); relevel(j); this.touch(); }
      return { job: j, isNew: false };
    } }
    // Too old to matter, or already pruned once (prevents re-adding the same postings every poll).
    if (raw.postedAt && Date.now() - Date.parse(raw.postedAt) > MAX_AGE_DAYS * 864e5) return { job: null, isNew: false };
    if (raw.url && this.gone.has(canonicalUrl(raw.url))) return { job: null, isNew: false };
    const p = enrich(raw);
    p.precision = p.precision || 'unknown';
    const existingId = this.dedupe.match(p, id => this.byId.get(id));
    if (existingId) {
      const job = this.byId.get(existingId);
      const before = job.sources.length;
      this.dedupe.unindex(job); mergeInto(job, p); Object.assign(job, deepAttributes(job)); this.dedupe.index(job);
      if (job.sources.length !== before) this.touch();
      return { job, isNew: false };
    }
    const now = new Date().toISOString();
    const job = {
      id: hash(`${p.source}|${p.url}|${p.title}|${p.company}`),
      title: p.title, company: p.company, companyUrl: p.companyUrl || '', companyMeta: p.companyMeta || null,
      url: p.url, applyUrl: p.applyUrl || '', urls: [p.url, p.applyUrl].filter(Boolean),
      location: p.location, country: p.country, remote: p.remote,
      type: p.type, level: p.level, levelHint: p.levelHint || '', specialty: p.specialty, field: p.field, yearsMin: p.yearsMin, yearsMax: p.yearsMax, visa: p.visa, workMode: p.workMode, degrees: p.degrees, pay: p.pay, terms: p.terms,
      skills: p.skills, requirements: p.requirements, salary: p.salary, emails: p.emails,
      description: (p.description || '').slice(0, 12000),
      postedAt: p.postedAt || null, precision: p.postedAt ? p.precision : 'unknown', backfill: !!p.backfill,
      firstSeen: now, lastSeen: now,
      sources: [{ source: p.source, url: p.url, postedAt: p.postedAt, precision: p.precision, seenAt: now }],
    };
    this.state.jobs.unshift(job); this.byId.set(job.id, job); this.dedupe.index(job); this.touch();
    return { job, isNew: true };
  }

  /** Fold a re-poster's copy into the root record and drop the copy. Its links stay known, so it is not re-added. */
  fold(root, copy) {
    this.dedupe.unindex(root); this.dedupe.unindex(copy);
    root.urls = [...new Set([...(root.urls || [root.url]), ...(copy.urls || [copy.url])].filter(Boolean))];
    root.reposts ||= []; if (!root.reposts.some(r => r.company === copy.company)) root.reposts.push({ company: copy.company, source: copy.sources[0]?.source || '', url: copy.url });
    for (const s of copy.sources) if (!root.sources.some(x => x.source === s.source)) root.sources.push(s);
    const t = this.state.tracking; if (t[copy.id] && !t[root.id]) t[root.id] = t[copy.id]; delete t[copy.id];
    this.state.jobs = this.state.jobs.filter(j => j !== copy); this.byId.delete(copy.id);
    this.dedupe.index(root); this.touch();
    return root;
  }
  prune() {
    const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
    const others = (this.state.profiles || []).map(p => p.tracking).filter(Boolean); // saved roles of the profiles that are not open right now
    const tracked = id => this.state.tracking[id] || others.some(t => t[id]);
    const keep = j => tracked(j.id) || Date.parse(j.postedAt || j.firstSeen) >= cutoff;
    let jobs = this.state.jobs.filter(keep);
    jobs.sort((a, b) => (b.postedAt || b.firstSeen).localeCompare(a.postedAt || a.firstSeen));
    // Early-career roles don't compete with the flood of senior postings for space.
    if (jobs.length > MAX_JOBS) { let rest = 0, early = 0; jobs = jobs.filter(j => tracked(j.id) || (isEarly(j) ? early++ < MAX_EARLY : rest++ < MAX_JOBS)); }
    if (jobs.length !== this.state.jobs.length) {
      const ids = new Set(jobs.map(j => j.id));
      for (const j of this.state.jobs) if (!ids.has(j.id)) { this.byId.delete(j.id); this.dedupe.unindex(j); for (const u of j.urls || [j.url]) if (u) this.gone.add(canonicalUrl(u)); }
      if (this.gone.size > 100000) this.gone = new Set([...this.gone].slice(-80000));
      this.state.jobs = jobs; this.touch();
    }
    this.state.funding = this.state.funding.slice(0, 1500);
    this.state.alerts = this.state.alerts.slice(0, 300);
  }
}
