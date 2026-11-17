// Storage on disk: one SQLite file, data/lookout.db.
//
// Lookout used to rewrite one JSON file (over 100 MB with 25,000 roles) every 15 seconds. Here each role, board
// and company is its own row, and a save writes only the rows that changed since the last one, inside one
// transaction, so a crash mid-save leaves the previous state whole.
//
// SQLite comes with Node.js itself (node:sqlite, Node 22.13 and later), so there is still nothing to install.
// SQLite's file format is stable and documented to be readable for decades. Where node:sqlite is missing
// (an older Node.js), openDb returns null and Lookout keeps using the JSON file, so nothing breaks.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Kept as one row per item. Everything else in the state is one row per top-level key.
const COLLECTIONS = { jobs: 'array', boards: 'object', companies: 'object' };
const digest = s => crypto.createHash('sha1').update(s).digest('base64');

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
      CREATE TABLE IF NOT EXISTS item (t TEXT NOT NULL, id TEXT NOT NULL, v TEXT NOT NULL, PRIMARY KEY (t, id)) WITHOUT ROWID;`);
    this.seen = new Map(); // "kv:key" / "t:id" -> digest of what is on disk
    this.q = {
      kvGet: this.db.prepare('SELECT k, v FROM kv'), kvPut: this.db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v'), kvDel: this.db.prepare('DELETE FROM kv WHERE k = ?'),
      itemGet: this.db.prepare('SELECT t, id, v FROM item'), itemPut: this.db.prepare('INSERT INTO item (t, id, v) VALUES (?, ?, ?) ON CONFLICT(t, id) DO UPDATE SET v = excluded.v'), itemDel: this.db.prepare('DELETE FROM item WHERE t = ? AND id = ?'),
      count: this.db.prepare('SELECT COUNT(*) AS n FROM kv'),
    };
  }
  /** Is there anything saved yet? */
  hasData() { return this.q.count.get().n > 0; }
  /** The whole saved state, as the JSON file used to hold it. */
  load() {
    const state = {};
    for (const { k, v } of this.q.kvGet.all()) { state[k] = JSON.parse(v); this.seen.set(`kv:${k}`, digest(v)); }
    for (const [t, shape] of Object.entries(COLLECTIONS)) state[t] = shape === 'array' ? [] : {};
    for (const { t, id, v } of this.q.itemGet.all()) {
      const shape = COLLECTIONS[t]; if (!shape) continue;
      const x = JSON.parse(v); this.seen.set(`${t}:${id}`, t === 'jobs' ? jobKey(x) : digest(v));
      if (shape === 'array') state[t].push(x); else state[t][id] = x;
    }
    // newest first, as the list expects
    state.jobs.sort((a, b) => String(b.postedAt || b.firstSeen || '').localeCompare(String(a.postedAt || a.firstSeen || '')));
    return state;
  }
  /** Write what changed since the last save. Returns the number of rows written or removed. */
  save(state) {
    let n = 0;
    this.db.exec('BEGIN');
    try {
      const keys = new Set();
      for (const [k, v] of Object.entries(state)) {
        if (COLLECTIONS[k] || v === undefined) continue; keys.add(`kv:${k}`);
        const s = JSON.stringify(v); const d = digest(s);
        if (this.seen.get(`kv:${k}`) !== d) { this.q.kvPut.run(k, s); this.seen.set(`kv:${k}`, d); n++; }
      }
      for (const [t, shape] of Object.entries(COLLECTIONS)) {
        const items = shape === 'array' ? (state[t] || []).map(x => [x.id, x]) : Object.entries(state[t] || {});
        for (const [id, x] of items) {
          if (!id) continue; const key = `${t}:${id}`; keys.add(key);
          // Roles: compare without the description (most of the bytes), which only ever grows when it changes.
          const d = t === 'jobs' ? jobKey(x) : digest(JSON.stringify(x));
          if (this.seen.get(key) !== d) { this.q.itemPut.run(t, String(id), JSON.stringify(x)); this.seen.set(key, d); n++; }
        }
      }
      for (const key of [...this.seen.keys()]) {
        if (keys.has(key)) continue;
        const i = key.indexOf(':'); const t = key.slice(0, i), id = key.slice(i + 1);
        if (t === 'kv') this.q.kvDel.run(id); else this.q.itemDel.run(t, id);
        this.seen.delete(key); n++;
      }
      this.db.exec('COMMIT');
      if (n > 2000) this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); // fold a big write into the main file
    } catch (e) { try { this.db.exec('ROLLBACK'); } catch { } this.seen.clear(); throw e; } // next save writes everything again
    return n;
  }
  /** A consistent copy of everything, for a backup, while Lookout keeps running. */
  backupTo(file) { try { fs.rmSync(file, { force: true }); } catch { } this.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`); return file; }
  close() { try { this.db.close(); } catch { } }
}
function jobKey(j) { const { description, ...rest } = j; return digest(JSON.stringify(rest)) + ':' + String(description || '').length; }
