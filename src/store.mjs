// Persistent state (JSON on disk, atomic writes) + the job ingestion path with dedupe.
import fs from 'node:fs/promises';
import path from 'node:path';
import { Deduper, mergeInto, normCompany } from './dedupe.mjs';
import { enrich } from './enrich.mjs';
import { hash, domainOf } from './util.mjs';

const MAX_JOBS = 6000;
const MAX_AGE_DAYS = 60;

const DEFAULT_FILTER_SETS = [
  { id: 'fs-india-intern', name: 'India internships', alert: true, filters: { q: '', types: ['Internship'], levels: [], countries: ['India', 'Remote (global)'], categories: [], skills: [], age: '7d', remoteOnly: false, fundedOnly: false, sources: [], hasContact: false } },
  { id: 'fs-fresh-early', name: 'Fresh early-career roles (last hour)', alert: true, filters: { q: '', types: [], levels: ['Intern', 'Entry'], countries: [], categories: [], skills: [], age: '1h', remoteOnly: false, fundedOnly: false, sources: [], hasContact: false } },
  { id: 'fs-funded', name: 'Recently funded startups', alert: false, filters: { q: '', types: [], levels: ['Intern', 'Entry', 'Mid'], countries: [], categories: [], skills: [], age: '7d', remoteOnly: false, fundedOnly: true, sources: [], hasContact: false } },
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
    this.dirty = false; this.listeners = new Set();
  }
  async load() {
    await fs.mkdir(this.dir, { recursive: true });
    try {
      const saved = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.state = { ...emptyState(), ...saved, settings: { ...emptyState().settings, ...(saved.settings || {}) } };
    } catch { /* first run */ }
    for (const j of this.state.jobs) { this.byId.set(j.id, j); this.dedupe.index(j); }
  }
  async save() {
    if (!this.dirty) return; this.dirty = false;
    const tmp = this.file + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(this.state));
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
    const p = enrich(raw);
    p.precision = p.precision || 'unknown';
    const existingId = this.dedupe.match(p, id => this.byId.get(id));
    if (existingId) {
      const job = this.byId.get(existingId);
      const before = job.sources.length;
      this.dedupe.unindex(job); mergeInto(job, p); this.dedupe.index(job);
      if (job.sources.length !== before) this.touch();
      return { job, isNew: false };
    }
    const now = new Date().toISOString();
    const job = {
      id: hash(`${p.source}|${p.url}|${p.title}|${p.company}`),
      title: p.title, company: p.company, companyUrl: p.companyUrl || '', companyMeta: p.companyMeta || null,
      url: p.url, applyUrl: p.applyUrl || '', urls: [p.url, p.applyUrl].filter(Boolean),
      location: p.location, country: p.country, remote: p.remote,
      type: p.type, level: p.level, category: p.category,
      skills: p.skills, requirements: p.requirements, salary: p.salary, emails: p.emails,
      description: (p.description || '').slice(0, 20000),
      postedAt: p.postedAt || null, precision: p.postedAt ? p.precision : 'unknown',
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
      for (const j of this.state.jobs) if (!ids.has(j.id)) { this.byId.delete(j.id); this.dedupe.unindex(j); }
      this.state.jobs = jobs; this.touch();
    }
    this.state.funding = this.state.funding.slice(0, 1500);
    this.state.alerts = this.state.alerts.slice(0, 300);
  }
}
