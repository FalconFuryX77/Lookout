// Grows the starter list from Common Crawl, the free public crawl of the web: every company job board on
// Greenhouse, Lever, Ashby, Workable, SmartRecruiters and Recruitee that the crawl has seen is checked against
// that board's public job API, and kept when it has at least one computer-science role open right now.
// The boards already in the list stay. Run it every month or so (a GitHub Action does, see
// .github/workflows/boards.yml); Lookout picks the new list up on its own.
//
//   node starter/crawl-boards.mjs [--crawls 2] [--concurrency 8] [--recheck]
//
// Only URL lists are read from Common Crawl (its index), never page contents. Each board is asked once, through
// the same public API Lookout itself polls. Progress is cached in data/crawl-cache.json, so a run that stops can
// pick up where it left off; --recheck asks every board again.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harvestBoards } from '../src/discovery.mjs';
import { classifyRole, isComputingRole } from '../src/taxonomy.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const CRAWLS = Number(arg('crawls', 2)), CONC = Number(arg('concurrency', 8)), RECHECK = process.argv.includes('--recheck');
const OUT = path.join(here, 'sources.json');
const CACHE = path.join(here, '..', 'data', 'crawl-cache.json');
const UA = 'Lookout board-list builder (open source job scanner; https://github.com/FalconFuryX77/Lookout)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// Where each platform's boards live, as Common Crawl index queries.
const HOSTS = [
  { url: 'boards.greenhouse.io/*' }, { url: 'job-boards.greenhouse.io/*' },
  { url: 'jobs.lever.co/*' }, { url: 'jobs.ashbyhq.com/*' }, { url: 'apply.workable.com/*' },
  { url: 'jobs.smartrecruiters.com/*' }, { url: 'careers.smartrecruiters.com/*' },
  { url: 'recruitee.com', matchType: 'domain' },
];

async function get(url, { json = true, tries = 4, timeout = 60000 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: json ? 'application/json' : '*/*' }, signal: AbortSignal.timeout(timeout) });
      if (r.status === 404 || r.status === 410) return { status: r.status };
      if (r.status === 429 || r.status >= 500) { await sleep(3000 * (i + 1)); continue; }
      if (!r.ok) return { status: r.status };
      return { status: 200, body: json ? await r.json() : await r.text() };
    } catch { await sleep(2500 * (i + 1)); }
  }
  return { status: 0 };
}
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); }

// 1. Candidate boards from the crawl index
async function candidates() {
  const info = (await get('https://index.commoncrawl.org/collinfo.json')).body || [];
  const crawls = info.slice(0, CRAWLS).map(c => c.id);
  log('crawls:', crawls.join(', '));
  const found = new Map();
  for (const crawl of crawls) for (const h of HOSTS) {
    const q = `url=${encodeURIComponent(h.url)}${h.matchType ? `&matchType=${h.matchType}` : ''}`;
    const api = `https://index.commoncrawl.org/${crawl}-index?${q}`;
    const pages = (await get(`${api}&showNumPages=true`)).body?.pages || 0;
    let read = 0, before = found.size;
    for (let p = 0; p < pages; p++) {
      const r = await get(`${api}&fl=url&page=${p}`, { json: false, timeout: 120000 });
      if (r.status !== 200) continue; read++;
      for (const b of harvestBoards(r.body)) if (b.provider !== 'workday' && b.provider !== 'oracle') found.set(`${b.provider}:${b.board.toLowerCase()}`, b);
      await sleep(800); // the index is a shared, free service
    }
    log(`${crawl} ${h.url}: ${read}/${pages} index pages, +${found.size - before} boards (${found.size} so far)`);
  }
  return found;
}

// 2. What each board has open right now, from its public API (titles only where the API allows it)
const titleCase = s => String(s).replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase());
async function openRoles({ provider, board }) {
  const b = encodeURIComponent(board);
  if (provider === 'greenhouse') {
    const r = await get(`https://boards-api.greenhouse.io/v1/boards/${b}/jobs`); if (r.status !== 200) return { status: r.status };
    const titles = (r.body.jobs || []).map(j => j.title);
    const name = titles.length ? (await get(`https://boards-api.greenhouse.io/v1/boards/${b}`)).body?.name : '';
    return { status: 200, titles, company: name || titleCase(board) };
  }
  if (provider === 'lever') { const r = await get(`https://api.lever.co/v0/postings/${b}?mode=json&limit=300`); return r.status !== 200 ? { status: r.status } : { status: 200, titles: (Array.isArray(r.body) ? r.body : []).map(j => j.text), company: titleCase(board) }; }
  if (provider === 'ashby') { const r = await get(`https://api.ashbyhq.com/posting-api/job-board/${b}`); return r.status !== 200 ? { status: r.status } : { status: 200, titles: (r.body.jobs || []).filter(j => j.isListed !== false).map(j => j.title), company: titleCase(board) }; }
  if (provider === 'workable') { const r = await get(`https://apply.workable.com/api/v1/widget/accounts/${b}`); return r.status !== 200 ? { status: r.status } : { status: 200, titles: (r.body.jobs || []).map(j => j.title), company: r.body.name || titleCase(board) }; }
  if (provider === 'smartrecruiters') { const r = await get(`https://api.smartrecruiters.com/v1/companies/${b}/postings?limit=100`); return r.status !== 200 ? { status: r.status } : { status: 200, titles: (r.body.content || []).map(j => j.name), company: r.body.content?.[0]?.company?.name || titleCase(board) }; }
  if (provider === 'recruitee') { const r = await get(`https://${b}.recruitee.com/api/offers/`); return r.status !== 200 ? { status: r.status } : { status: 200, titles: (r.body.offers || []).map(j => j.title), company: r.body.offers?.[0]?.company_name || titleCase(board) }; }
  return { status: 0 };
}
const computing = title => isComputingRole({ title, skills: [] }, classifyRole(title, ''));

// 3. Put it together
const cache = (() => { try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { return { boards: {} } } })();
const saveCache = () => { fs.mkdirSync(path.dirname(CACHE), { recursive: true }); fs.writeFileSync(CACHE, JSON.stringify(cache)); };
const found = await candidates();
const todo = [...found.entries()].filter(([k]) => RECHECK || !cache.boards[k] || Date.now() - Date.parse(cache.boards[k].at) > 20 * 864e5);
log(`checking ${todo.length} of ${found.size} boards (${found.size - todo.length} checked recently)`);
let done = 0;
await pool(todo, CONC, async ([k, b]) => {
  const r = await openRoles(b);
  cache.boards[k] = r.status === 200 ? { at: new Date().toISOString(), provider: b.provider, board: b.board, company: String(r.company || b.board).slice(0, 120), roles: r.titles.length, cs: r.titles.filter(computing).length } : { at: new Date().toISOString(), provider: b.provider, board: b.board, status: r.status };
  if (++done % 250 === 0) { saveCache(); log(`checked ${done}/${todo.length}`); }
  await sleep(150);
});
saveCache();

const current = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const have = new Set(current.boards.map(b => `${b.platform}:${b.board.toLowerCase()}`));
let added = 0; const byPlatform = {};
for (const [k, c] of Object.entries(cache.boards)) {
  if (!found.has(k) && !have.has(k)) continue;
  if (have.has(k) || !(c.cs > 0)) continue;
  current.boards.push({ platform: c.provider, board: c.board, company: c.company }); have.add(k); added++;
  byPlatform[c.provider] = (byPlatform[c.provider] || 0) + 1;
}
current.boards.sort((a, b) => a.company.localeCompare(b.company) || a.board.localeCompare(b.board));
current.exported = new Date().toISOString();
current.description = 'Careers boards with computer-science roles (found through community lists, the YC directory, funding news and Common Crawl) and community job lists. Lookout keeps it up to date on its own.';
fs.writeFileSync(OUT, JSON.stringify(current, null, 1) + '\n');
const checked = Object.values(cache.boards); const live = checked.filter(c => c.roles > 0).length, withCs = checked.filter(c => c.cs > 0).length;
log(`done: ${found.size} boards in the crawl; ${live} have roles open, ${withCs} have computer-science roles. Added ${added} ${JSON.stringify(byPlatform)}; the list now has ${current.boards.length} boards.`);
