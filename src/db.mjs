// Storage on disk: one SQLite file, data/lookout.db.
//
// Lookout used to rewrite one JSON file (over 100 MB with 25,000 roles) every 15 seconds. Here each role, board,
// company and day of the niche diary is its own row, the big lists (links of pruned roles, links of roles in
// other fields) are sets of rows, and a save writes only what changed since the last one, inside one
// transaction, so a crash mid-save leaves the previous state whole.
//
// Telling what changed has to be cheap: it runs every 15 seconds over tens of thousands of items. Roles and
// boards are compared on a short summary of the fields that matter (a role's description only grows when it
// changes, so its length stands in for it); everything else on a digest of its JSON.
//
// SQLite comes with Node.js itself (node:sqlite, Node 22.13 and later), so there is still nothing to install.
// SQLite's file format is stable and documented to be readable for decades. Where node:sqlite is missing
// (an older Node.js), openDb returns null and Lookout keeps using the JSON file, so nothing breaks.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Kept as one row per item (an array by id, or an object by key). Everything else is one row per top-level key.
const COLLECTIONS = { jobs: 'array', boards: 'object', companies: 'object', httpValidators: 'object', nicheDays: 'object' };
// Sets of strings kept as rows: added and removed one by one.
const SETS = ['gone', 'offScope'];
const digest = s => crypto.createHash('sha1').update(s).digest('base64');
const S1 = '\u0001';
// What a save compares for each item; anything that changes in a way worth keeping changes one of these.
function itemKey(t, x) {
  if (t === 'jobs') return [x.title, x.company, x.url, x.applyUrl, (x.urls || []).length, (x.sources || []).length, x.postedAt, x.precision, x.type, x.level, x.levelHint,
    x.specialty, x.field, x.cs, x.location, x.country, x.remote, x.salary, (x.emails || []).length, (x.skills || []).length, (x.description || '').length, (x.requirements || []).length,
    x.doubt?.level, (x.doubt?.reasons || []).join(), x.closedAt, x.closedBy, x.repostOf, x.middleman ? JSON.stringify(x.middleman) : '', (x.reposts || []).length, x.backfill,
    x.visa, x.workMode, x.yearsMin, x.yearsMax, (x.degrees || []).join(), (x.terms || []).join(), x.companyUrl, x.companyMeta ? JSON.stringify(x.companyMeta) : ''].join(S1);
  if (t === 'boards') return [x.provider, x.board, x.company, x.via, x.watched, x.lastPolled, x.polledOnce, x.errors, x.lastError, x.openRoles, x.newCount, x.lastNewAt, x.fundedAt, x.ycRecent,
    x.lv || 0, (x.listed || []).length, x.missing ? Object.keys(x.missing).length : 0, x.cursor ? JSON.stringify(x.cursor) : ''].join(S1);
  if (t === 'httpValidators') return `${x?.etag || ''}${S1}${x?.lastModified || ''}`;
  return digest(JSON.stringify(x));
}

export async function openDb(dir) {
  let DatabaseSync;
  try {
    // Node 22 prints a one-line "experimental" notice for node:sqlite; it is stable enough for a local file.
    const warn = process.emitWarning;
    process.emitWarning = (w, ...a) => (/SQLite/i.test(String(w?.message || w)) ? undefined : warn.call(process, w, ...a));
    try { ({ DatabaseSync } = await import('node:sqlite')); } finally { process.emitWarning = warn; }
  } catch { return null; }
  return new SqliteStore(path.join(dir, 'lookout.db'), DatabaseSync);
}

class SqliteStore {
  constructor(file, DatabaseSync) {
    this.file = file; this.isNew = !fs.existsSync(file);
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS item (t TEXT NOT NULL, id TEXT NOT NULL, v TEXT NOT NULL, PRIMARY KEY (t, id)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS member (s TEXT NOT NULL, k TEXT NOT NULL, PRIMARY KEY (s, k)) WITHOUT ROWID;`);
    this.seen = new Map(); // "kv:key" / "t:id" -> what was last written (digest or summary)
    this.saved = Object.fromEntries(SETS.map(s => [s, new Set()])); // what each set held at the last save
    this.q = {
      kvGet: this.db.prepare('SELECT k, v FROM kv'), kvPut: this.db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v'), kvDel: this.db.prepare('DELETE FROM kv WHERE k = ?'),
      itemGet: this.db.prepare('SELECT t, id, v FROM item'), itemPut: this.db.prepare('INSERT INTO item (t, id, v) VALUES (?, ?, ?) ON CONFLICT(t, id) DO UPDATE SET v = excluded.v'), itemDel: this.db.prepare('DELETE FROM item WHERE t = ? AND id = ?'),
      memGet: this.db.prepare('SELECT s, k FROM member'), memPut: this.db.prepare('INSERT OR IGNORE INTO member (s, k) VALUES (?, ?)'), memDel: this.db.prepare('DELETE FROM member WHERE s = ? AND k = ?'),
      count: this.db.prepare('SELECT COUNT(*) AS n FROM kv'),
    };
  }
  /** Is there anything saved yet? */
  hasData() { return this.q.count.get().n > 0; }
  /** The whole saved state, as the JSON file used to hold it, and the sets ({ gone, offScope }). */
  load() {
    const state = {};
    for (const { k, v } of this.q.kvGet.all()) { state[k] = JSON.parse(v); this.seen.set(`kv:${k}`, digest(v)); }
    const had = {};
    for (const [t, shape] of Object.entries(COLLECTIONS)) { had[t] = state[t]; state[t] = shape === 'array' ? [] : {}; }
    const rows = {};
    for (const { t, id, v } of this.q.itemGet.all()) {
      const shape = COLLECTIONS[t]; if (!shape) continue;
      const x = JSON.parse(v); this.seen.set(`${t}:${id}`, itemKey(t, x)); rows[t] = (rows[t] || 0) + 1;
      if (shape === 'array') state[t].push(x); else state[t][id] = x;
    }
    // Saved by an earlier version as one row: keep it until it is written the new way.
    for (const t of Object.keys(COLLECTIONS)) if (!rows[t] && had[t] !== undefined) { state[t] = had[t]; this.seen.delete(`kv:${t}`); this.dropKv = [...(this.dropKv || []), t]; }
    const sets = Object.fromEntries(SETS.map(s => [s, new Set()]));
    for (const { s, k } of this.q.memGet.all()) if (sets[s]) sets[s].add(k);
    for (const s of SETS) { // an earlier version kept these as one row in kv
      if (!sets[s].size && Array.isArray(state[s])) for (const k of state[s]) sets[s].add(k);
      if (state[s] !== undefined) { delete state[s]; this.dropKv = [...(this.dropKv || []), s]; }
      this.saved[s] = new Set(sets[s]);
    }
    state.jobs.sort((a, b) => String(b.postedAt || b.firstSeen || '').localeCompare(String(a.postedAt || a.firstSeen || ''))); // newest first
    return { state, sets };
  }
  /** Write what changed since the last save. `sets` maps a set's name to its Set. Returns rows written or removed. */
  save(state, sets = {}) {
    let n = 0;
    this.db.exec('BEGIN');
    try {
      for (const k of this.dropKv || []) { this.q.kvDel.run(k); n++; } this.dropKv = [];
      const keys = new Set();
      for (const [k, v] of Object.entries(state)) {
        if (COLLECTIONS[k] || SETS.includes(k) || v === undefined) continue; keys.add(`kv:${k}`);
        const s = JSON.stringify(v); const d = digest(s);
        if (this.seen.get(`kv:${k}`) !== d) { this.q.kvPut.run(k, s); this.seen.set(`kv:${k}`, d); n++; }
      }
      for (const [t, shape] of Object.entries(COLLECTIONS)) {
        const items = shape === 'array' ? (state[t] || []).map(x => [x.id, x]) : Object.entries(state[t] || {});
        for (const [id, x] of items) {
          if (!id) continue; const key = `${t}:${id}`; keys.add(key);
          const d = itemKey(t, x);
          if (this.seen.get(key) !== d) { this.q.itemPut.run(t, String(id), JSON.stringify(x)); this.seen.set(key, d); n++; }
        }
      }
      for (const key of [...this.seen.keys()]) {
        if (keys.has(key)) continue;
        const i = key.indexOf(':'); const t = key.slice(0, i), id = key.slice(i + 1);
        if (t === 'kv') this.q.kvDel.run(id); else this.q.itemDel.run(t, id);
        this.seen.delete(key); n++;
      }
      for (const s of SETS) {
        const now = sets[s]; if (!now) continue; const before = this.saved[s];
        for (const k of now) if (!before.has(k)) { this.q.memPut.run(s, k); n++; }
        for (const k of before) if (!now.has(k)) { this.q.memDel.run(s, k); n++; }
        this.saved[s] = new Set(now);
      }
      this.db.exec('COMMIT');
      if (n > 2000) this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); // fold a big write into the main file
    } catch (e) { try { this.db.exec('ROLLBACK'); } catch { } this.seen.clear(); for (const s of SETS) this.saved[s] = new Set(); throw e; } // next save writes everything again
    return n;
  }
  /** A consistent copy of everything, for a backup, while Lookout keeps running. */
  backupTo(file) { try { fs.rmSync(file, { force: true }); } catch { } this.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`); return file; }
  close() { try { this.db.close(); } catch { } }
}
