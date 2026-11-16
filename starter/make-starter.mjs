// Builds starter/sources.json, the suggested list a new install can add with one click.
// It is made from a running Lookout's data, keeping only what came from public places (the YC directory,
// community GitHub lists, funding news, links inside listings) and only boards that had open roles
// recently. Companies someone watched by hand, or imported from another file, are left out.
//
//   node starter/make-starter.mjs [path to db.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harvestBoards } from '../src/discovery.mjs';
import { JOB_SOURCES } from '../src/sources.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbFile = process.argv[2] || path.join(here, '..', 'data', 'db.json');
const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
const PUBLIC = /^(YC directory|funding news|company site|followed link|named in a re-post|.*\(GitHub\)|HN|Simplify|vanshb03|InternScan|Startup\.jobs|Remote OK|We Work Remotely|Himalayas|Jobicy|Arbeitnow|Remotive|LinkedIn)/i;
const recent = b => (b.openRoles || 0) > 0 || (b.lastNewAt && Date.now() - Date.parse(b.lastNewAt) < 60 * 864e5);
const boards = new Map();
for (const b of Object.values(db.boards || {})) {
  if (b.watched || !PUBLIC.test(b.via || '') || (b.errors || 0) >= 3 || !recent(b)) continue;
  boards.set(`${b.provider}:${b.board.toLowerCase()}`, { platform: b.provider, board: b.board, company: b.company });
}
// careers sites on the newer platforms that roles on file already point to
for (const j of db.jobs || []) for (const u of j.urls || [j.url]) for (const h of harvestBoards(u || '')) {
  if ((h.provider === 'workday' || h.provider === 'oracle') && !boards.has(`${h.provider}:${h.board.toLowerCase()}`)) boards.set(`${h.provider}:${h.board.toLowerCase()}`, { platform: h.provider, board: h.board, company: j.company });
}
const off = new Set(db.settings?.offSources || []);
const lists = [
  ...JOB_SOURCES.filter(s => /^https:\/\/github\.com\/[^/]+\/[^/]+/.test(s.home || '') && !off.has(s.id)).map(s => ({ repo: s.home.replace('https://github.com/', '').split('/').slice(0, 2).join('/'), name: s.name })),
  ...(db.dynamicSources || []).filter(d => !d.disabled && !d.imported && d.validated === 2).map(d => ({ repo: d.repo, name: d.name, url: d.url })),
];
const out = {
  lookout: 'sources', version: 1, name: 'Lookout starter list',
  description: 'Careers boards and community job lists that were posting roles recently. Add it in Settings → Sources.',
  exported: new Date().toISOString(),
  boards: [...boards.values()].sort((a, b) => a.company.localeCompare(b.company) || a.board.localeCompare(b.board)),
  lists,
};
fs.writeFileSync(path.join(here, 'sources.json'), JSON.stringify(out, null, 1) + '\n');
const by = {}; for (const b of out.boards) by[b.platform] = (by[b.platform] || 0) + 1;
console.log(`starter: ${out.boards.length} boards ${JSON.stringify(by)}, ${lists.length} lists`);
