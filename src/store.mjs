// Persistent state (SQLite in data/lookout.db, or a JSON file where Node.js has no SQLite) + the job
// ingestion path with dedupe.
import fs from 'node:fs/promises';
import path from 'node:path';
import { Deduper, mergeInto, normCompany, fingerprint, locationsConflict } from './dedupe.mjs';
import { bestLink, linkRank } from './root.mjs';
import { enrich, inferCountry, inferType, relevel, extractSalary, extractEmails, cleanSalary, requirementLines } from './enrich.mjs';
import { hash, domainOf, canonicalUrl } from './util.mjs';
import { deepAttributes } from './taxonomy.mjs';
import { openDb } from './db.mjs';

const MAX_JOBS = 20000;        // everything that is not early-career: newest first
const MAX_EARLY = 20000;       // internships, apprenticeships and entry-level are kept on top of that
const MAX_AGE_DAYS = 60;
const CLOSED_KEEP_DAYS = 60;    // how long a role its employer took down is remembered, so copies of it stay out
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
    settings: { ntfyServer: 'https://ntfy.sh', ntfyTopic: '', ntfyToken: '', desktopNotify: true, quietHours: '', scope: 'computing', profile: { name: '', pitch: '', skills: [], link: '' } },
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
    this.closed = new Map(); this.closedByUrl = new Map(); this.closedByFp = new Map();
    this.offScope = new Set(); // links of roles outside the fields kept, so each poll skips them without re-reading
  }
  async load() {
    await fs.mkdir(this.dir, { recursive: true });
    // SQLite when Node.js has it. A db.json from before is read once, written into the database on the first
    // save, and then kept beside it as db.json.migrated, untouched, in case it is ever needed.
    this.db = process.env.LOOKOUT_JSON_STORE ? null : await openDb(this.dir);
    this.migrating = false;
    try {
      let saved;
      if (this.db?.hasData()) saved = this.db.load();
      else { saved = JSON.parse(await fs.readFile(this.file, 'utf8')); if (this.db) this.migrating = true; }
      this.state = { ...emptyState(), ...saved, settings: { ...emptyState().settings, ...(saved.settings || {}) } };
      // upgrade untouched v1 default sets to the new defaults
      const OLD = ['India internships', 'Fresh early-career roles (last hour)', 'Recently funded startups'];
      this.state.filterSets = this.state.filterSets.map(fs => OLD.includes(fs.name) ? (DEFAULT_FILTER_SETS.find(d => d.id === fs.id) || fs) : fs);
    } catch { /* first run */ }
    this.gone = new Set(this.state.gone || []); delete this.state.gone;
    for (const t of this.state.closedRoles || []) this.indexClosed(t); delete this.state.closedRoles;
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
    if (this.state.rootLinks !== 2) { // Apply should open the most direct link a role has, not a job board's copy of it
      let n = 0;
      for (const j of this.state.jobs) { const best = bestLink(j.urls || [], j.company); if (best && linkRank(best, j.company) > linkRank(j.applyUrl || j.url, j.company)) { j.applyUrl = best; n++; } }
      if (n) console.log(`store: ${n} roles now open the employer's own listing instead of a job board's copy`);
      this.state.rootLinks = 2; this.dirty = true;
    }
    if (this.state.undatedListPurge !== 1) { // undated rows that only came from community lists aren't trustworthy
      const before = this.state.jobs.length;
      this.state.jobs = this.state.jobs.filter(j => j.postedAt || this.state.tracking[j.id] || !j.sources.every(s => s.source.startsWith('gh:')));
      this.state.undatedListPurge = 1; this.dirty = true;
      if (before !== this.state.jobs.length) console.log(`store: purged ${before - this.state.jobs.length} undated community-list rows`);
    }
    if (this.state.backfillMigrated !== 2) { for (const j of this.state.jobs) if (!j.postedAt) j.backfill = true; this.state.backfillMigrated = 2; this.dirty = true; }
    for (const j of this.state.jobs) { if (j.backfill === undefined && !j.postedAt && j.sources?.some(s => s.source === 'ats' || s.source.startsWith('gh:'))) j.backfill = true; delete j.category; Object.assign(j, deepAttributes(j)); this.byId.set(j.id, j); this.dedupe.index(j); }
    this.state.settings.scope ||= 'computing';
    if (this.state.settings.scope === 'computing' && this.state.scoped !== 1) { const r = this.applyScope(); if (r) console.log(`store: kept computer-science roles only; ${r} roles in other fields set aside`); }
  }
  /** Lookout keeps computer-science roles (and their applications) unless every field is chosen. */
  inScope(p) { return this.state.settings.scope === 'all' || p.cs !== false; }
  /** Drop stored roles outside the fields kept. Roles in anyone's pipeline stay. Returns how many went. */
  applyScope() {
    this.state.scoped = this.state.settings.scope === 'computing' ? 1 : 0; this.dirty = true;
    if (this.state.settings.scope !== 'computing') { this.offScope.clear(); return 0; }
    const drop = this.state.jobs.filter(j => j.cs === false && !this.tracked(j.id));
    for (const j of drop) for (const u of j.urls || [j.url]) if (u) this.offScope.add(canonicalUrl(u));
    this.removeJobs(drop.map(j => j.id));
    for (const j of drop) for (const u of j.urls || [j.url]) if (u) this.gone.delete(canonicalUrl(u)); // set aside, not pruned: choosing every field brings them back
    return drop.length;
  }
  // One write at a time: two overlapping saves would fight over the same temp file.
  save() { return (this.saving = (this.saving || Promise.resolve()).catch(() => { }).then(() => this.writeNow())); }
  async writeNow() {
    if (!this.dirty) return; this.dirty = false;
    if (this.db) {
      this.state.gone = [...this.gone].slice(-80000); this.state.closedRoles = [...this.closed.values()];
      try { this.db.save(this.state); } catch (e) { this.dirty = true; throw e; } finally { delete this.state.gone; delete this.state.closedRoles; }
      if (this.migrating) { this.migrating = false; try { await fs.rename(this.file, this.file + '.migrated'); console.log('store: moved db.json into lookout.db (the old file is kept as db.json.migrated)'); } catch { } }
      return;
    }
    const tmp = this.file + '.tmp';
    this.state.gone = [...this.gone].slice(-80000); this.state.closedRoles = [...this.closed.values()];
    const body = JSON.stringify(this.state); delete this.state.gone; delete this.state.closedRoles;
    try {
      await fs.writeFile(tmp, body);
      // Windows refuses the swap while anything (antivirus, a backup tool, an indexer) has db.json open; wait and retry.
      for (let i = 0; ; i++) { try { await fs.rename(tmp, this.file); break; } catch (e) { if (i >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e; await new Promise(r => setTimeout(r, 200 * (i + 1))); } }
    } catch (e) { this.dirty = true; throw e; } // keep the changes for the next save instead of dropping them
  }
  touch() { this.dirty = true; }
  /** A consistent copy of everything in one file, for backing up or moving to another computer. */
  async backup(file) { if (this.db) { await this.save(); return this.db.backupTo(file); } this.touch(); await this.save(); await fs.copyFile(this.file, file); return file; }
  async close() { this.touch(); await this.save(); this.db?.close(); }
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
  ingest(raw, { keep = false } = {}) { // keep: you chose this role yourself, so age and earlier removal do not apply
    // Fast path: same source re-reporting a job we already have (most of every poll).
    const quick = raw.url && this.dedupe.byUrl.get(canonicalUrl(raw.url));
    if (quick) { const j = this.byId.get(quick); if (j && j.sources.some(s => s.source === raw.source)) {
      j.lastSeen = new Date().toISOString();
      const hint = raw.levelHint || raw.level; // sources that state seniority: pick it up for roles stored before we read it
      if (hint && !j.levelHint) { j.levelHint = Array.isArray(hint) ? hint.join(' ') : String(hint); relevel(j); this.touch(); }
      return { job: j, isNew: false };
    } }
    // The employer's own board shows a link it had taken down: it was only hidden for a while (an edit, a pause).
    if (raw.source === 'ats' && raw.url) { const id = this.closedByUrl.get(canonicalUrl(raw.url)); if (id) { this.unclose(id); this.gone.delete(canonicalUrl(raw.url)); } }
    // Too old to matter, or already pruned once (prevents re-adding the same postings every poll).
    if (!keep && raw.postedAt && Date.now() - Date.parse(raw.postedAt) > MAX_AGE_DAYS * 864e5) return { job: null, isNew: false };
    if (!keep && raw.url && this.gone.has(canonicalUrl(raw.url))) return { job: null, isNew: false };
    if (!keep && raw.url && this.offScope.has(canonicalUrl(raw.url))) return { job: null, isNew: false, offScope: true };
    const p = enrich(raw);
    p.precision = p.precision || 'unknown';
    // A role its employer took down: another site's copy of it stays out, and the employer posting it again is noted.
    const tomb = !keep && this.closedMatch(p);
    if (tomb && p.source !== 'ats') return { job: null, isNew: false, closed: true };
    if (tomb) p.repostOf = tomb.closedAt;
    // Another sighting of a role already kept joins it, whatever this copy says on its own (a list's copy often
    // has only a title, which can be too little to tell its field).
    const existingId = this.dedupe.match(p, id => this.byId.get(id));
    if (existingId) {
      const job = this.byId.get(existingId);
      const before = job.sources.length;
      this.dedupe.unindex(job); mergeInto(job, p); Object.assign(job, deepAttributes(job)); this.dedupe.index(job);
      if (job.sources.length !== before) this.touch();
      return { job, isNew: false };
    }
    // Outside the fields kept (another profession): remembered so later polls skip it without reading it again.
    if (!keep && !this.inScope(p)) { if (raw.url) { this.offScope.add(canonicalUrl(raw.url)); if (this.offScope.size > 150000) this.offScope = new Set([...this.offScope].slice(-100000)); } return { job: null, isNew: false, offScope: true }; }
    const now = new Date().toISOString();
    const job = {
      id: hash(`${p.source}|${p.url}|${p.title}|${p.company}`),
      title: p.title, company: p.company, companyUrl: p.companyUrl || '', companyMeta: p.companyMeta || null,
      url: p.url, applyUrl: p.applyUrl || '', urls: [p.url, p.applyUrl].filter(Boolean),
      location: p.location, country: p.country, remote: p.remote,
      type: p.type, level: p.level, levelHint: p.levelHint || '', specialty: p.specialty, field: p.field, cs: p.cs, yearsMin: p.yearsMin, yearsMax: p.yearsMax, visa: p.visa, workMode: p.workMode, degrees: p.degrees, pay: p.pay, terms: p.terms,
      skills: p.skills, requirements: p.requirements, salary: p.salary, emails: p.emails,
      description: (p.description || '').slice(0, 12000),
      postedAt: p.postedAt || null, precision: p.postedAt ? p.precision : 'unknown', backfill: !!p.backfill, ...(p.repostOf ? { repostOf: p.repostOf } : {}),
      firstSeen: now, lastSeen: now,
      sources: [{ source: p.source, url: p.url, postedAt: p.postedAt, precision: p.precision, seenAt: now }],
    };
    this.state.jobs.unshift(job); this.byId.set(job.id, job); this.dedupe.index(job); this.touch();
    return { job, isNew: true };
  }

  /** Fold a re-poster's copy into the root record and drop the copy. Its links stay known, so it is not re-added. */
  fold(root, copy, { repost = true } = {}) {
    this.dedupe.unindex(root); this.dedupe.unindex(copy);
    root.urls = [...new Set([...(root.urls || [root.url]), ...(copy.urls || [copy.url])].filter(Boolean))];
    if (repost) { root.reposts ||= []; if (!root.reposts.some(r => r.company === copy.company)) root.reposts.push({ company: copy.company, source: copy.sources[0]?.source || '', url: copy.url }); }
    for (const s of copy.sources) if (!root.sources.some(x => x.source === s.source)) root.sources.push(s);
    const t = this.state.tracking; if (t[copy.id] && !t[root.id]) t[root.id] = t[copy.id]; delete t[copy.id];
    this.state.jobs = this.state.jobs.filter(j => j !== copy); this.byId.delete(copy.id);
    this.dedupe.index(root); this.touch();
    return root;
  }
  /** Is this role in anyone's pipeline (or hidden by anyone)? Those are never removed. */
  tracked(id) { return !!(this.state.tracking[id] || (this.state.profiles || []).some(p => p.tracking?.[id])); }

  indexClosed(t) {
    if (!t?.id || Date.now() - Date.parse(t.closedAt) > CLOSED_KEEP_DAYS * 864e5) return;
    this.closed.set(t.id, t);
    for (const u of t.urls || []) this.closedByUrl.set(canonicalUrl(u), t.id);
    const fp = fingerprint(t); const l = this.closedByFp.get(fp) || []; if (!l.includes(t.id)) l.push(t.id); this.closedByFp.set(fp, l);
  }
  unclose(id) {
    const t = this.closed.get(id); if (!t) return; this.closed.delete(id);
    for (const u of t.urls || []) if (this.closedByUrl.get(canonicalUrl(u)) === id) this.closedByUrl.delete(canonicalUrl(u));
    const fp = fingerprint(t); const l = (this.closedByFp.get(fp) || []).filter(x => x !== id); l.length ? this.closedByFp.set(fp, l) : this.closedByFp.delete(fp);
    this.touch();
  }
  /** The remembered closed role this posting is a copy of, if any (same link, or same company, title and place). */
  closedMatch(p) {
    if (!this.closed.size) return null;
    for (const u of [p.url, p.applyUrl]) { const id = u && this.closedByUrl.get(canonicalUrl(u)); if (id) return this.closed.get(id); }
    const termsConflict = (a, b) => a.terms?.length && b.terms?.length && !a.terms.some(t => b.terms.includes(t));
    for (const id of this.closedByFp.get(fingerprint(p)) || []) { const t = this.closed.get(id); if (t && !locationsConflict(t, p) && !termsConflict(t, p)) return t; }
    return null;
  }
  /**
   * The employer took this role down. Roles in someone's pipeline stay, marked closed; everything else goes,
   * and is remembered for a while so other sites' copies of it are not added back.
   * Returns 'removed', 'marked' or null.
   */
  closeJob(job, by = 'employer') {
    if (!job || job.closedAt) return null;
    const closedAt = new Date().toISOString();
    this.indexClosed({ id: job.id, title: job.title, company: job.company, location: job.location, country: job.country, terms: job.terms, urls: [...new Set([...(job.urls || []), job.url, job.applyUrl].filter(Boolean))], closedAt, by });
    if (this.tracked(job.id)) { job.closedAt = closedAt; job.closedBy = by; this.touch(); return 'marked'; }
    this.removeJobs([job.id]); return 'removed';
  }
  /** A role marked closed is listed by its employer again. */
  reopen(job) { if (!job?.closedAt) return false; delete job.closedAt; delete job.closedBy; this.unclose(job.id); this.touch(); return true; }
  removeJobs(ids) {
    const drop = new Set(ids); if (!drop.size) return;
    for (const id of drop) { const j = this.byId.get(id); if (!j) continue; this.byId.delete(id); this.dedupe.unindex(j); for (const u of j.urls || [j.url]) if (u) this.gone.add(canonicalUrl(u)); }
    this.state.jobs = this.state.jobs.filter(j => !drop.has(j.id)); this.touch();
  }
  prune() {
    for (const [id, t] of this.closed) if (Date.now() - Date.parse(t.closedAt) > CLOSED_KEEP_DAYS * 864e5) this.unclose(id);
    const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
    const tracked = id => this.tracked(id); // saved roles of every profile, open or not
    // Outside the fields kept: a role that only looked like computing work until its full posting arrived.
    const offField = j => this.state.settings.scope === 'computing' && j.cs === false;
    const keep = j => tracked(j.id) || (Date.parse(j.postedAt || j.firstSeen) >= cutoff && !offField(j));
    let jobs = this.state.jobs.filter(keep);
    jobs.sort((a, b) => (b.postedAt || b.firstSeen).localeCompare(a.postedAt || a.firstSeen));
    // Early-career roles don't compete with the flood of senior postings for space.
    if (jobs.length > MAX_JOBS) { let rest = 0, early = 0; jobs = jobs.filter(j => tracked(j.id) || (isEarly(j) ? early++ < MAX_EARLY : rest++ < MAX_JOBS)); }
    if (jobs.length !== this.state.jobs.length) {
      const ids = new Set(jobs.map(j => j.id));
      // Set-aside roles from other fields are only skipped (choosing every field brings them back); the rest are pruned.
      for (const j of this.state.jobs) if (!ids.has(j.id)) { this.byId.delete(j.id); this.dedupe.unindex(j); const into = offField(j) ? this.offScope : this.gone; for (const u of j.urls || [j.url]) if (u) into.add(canonicalUrl(u)); }
      if (this.gone.size > 100000) this.gone = new Set([...this.gone].slice(-80000));
      this.state.jobs = jobs; this.touch();
    }
    this.state.funding = this.state.funding.slice(0, 1500);
    this.state.alerts = this.state.alerts.slice(0, 300);
  }
}
