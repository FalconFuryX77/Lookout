// Persistent state (JSON on disk, atomic writes) + the job ingestion path with dedupe.
import fs from 'node:fs/promises';
import path from 'node:path';
import { Deduper, mergeInto, normCompany } from './dedupe.mjs';
import { enrich, inferCountry, inferLevel, extractSalary, extractEmails, cleanSalary, requirementLines } from './enrich.mjs';
import { hash, domainOf, canonicalUrl } from './util.mjs';
import { deepAttributes } from './taxonomy.mjs';

const MAX_JOBS = 12000;
const MAX_AGE_DAYS = 60;

const DEFAULT_FILTER_SETS = [
  { id: 'fs-india-intern', name: 'India · software internships', alert: true, filters: { types: ['Internship'], fields: ['Software & IT'], countries: ['India', 'Remote (global)'], age: '7d' } },
  { id: 'fs-fresh-early', name: 'Fresh software roles, 0–2 yrs', alert: true, filters: { fields: ['Software & IT'], levels: ['Intern', 'Entry'], expMax: 2, age: '1h' } },
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
        if (j.type !== 'Internship') j.level = inferLevel(j.title, text);
        j.salary = cleanSalary(extractSalary(text) || j.salary, j.type);
        j.emails = (j.emails || []).filter(e => extractEmails(e).length);
        j.requirements = requirementLines(text);
      }
      this.state.reenriched = 4; this.dirty = true;
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
  async save() {
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
    if (quick) { const j = this.byId.get(quick); if (j && j.sources.some(s => s.source === raw.source)) { j.lastSeen = new Date().toISOString(); return { job: j, isNew: false }; } }
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
      type: p.type, level: p.level, specialty: p.specialty, field: p.field, yearsMin: p.yearsMin, yearsMax: p.yearsMax, visa: p.visa, workMode: p.workMode, degrees: p.degrees, pay: p.pay, terms: p.terms,
      skills: p.skills, requirements: p.requirements, salary: p.salary, emails: p.emails,
      description: (p.description || '').slice(0, 12000),
      postedAt: p.postedAt || null, precision: p.postedAt ? p.precision : 'unknown', backfill: !!p.backfill,
      firstSeen: now, lastSeen: now,
      sources: [{ source: p.source, url: p.url, postedAt: p.postedAt, precision: p.precision, seenAt: now }],
    };
    this.state.jobs.unshift(job); this.byId.set(job.id, job); this.dedupe.index(job); this.touch();
    return { job, isNew: true };
  }

  prune() {
    const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
    const keep = j => this.state.tracking[j.id] || Date.parse(j.postedAt || j.firstSeen) >= cutoff;
    let jobs = this.state.jobs.filter(keep);
    jobs.sort((a, b) => (b.postedAt || b.firstSeen).localeCompare(a.postedAt || a.firstSeen));
    if (jobs.length > MAX_JOBS) jobs = jobs.filter((j, i) => i < MAX_JOBS || this.state.tracking[j.id]);
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
