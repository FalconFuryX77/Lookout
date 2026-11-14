// Self-expanding source discovery.
//  1. Harvest: every ATS link seen anywhere (aggregator listings, HN posts, company sites)
//     becomes a directly-polled company board.
//  2. GitHub: periodically search for new curated job-list repos, validate their data,
//     and add them as sources if they contribute jobs nobody else has.
//  3. Yield: track how many *unique* jobs each source/board produces and adapt polling,
//     backing off dead ones and speeding up active ones.
import { getJson } from './util.mjs';

const ATS_GLOBAL = [
  ['greenhouse', /(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=)?([A-Za-z0-9_-]+)/gi],
  ['greenhouse', /boards-api\.greenhouse\.io\/v1\/boards\/([A-Za-z0-9_-]+)/gi],
  ['lever', /jobs\.lever\.co\/([A-Za-z0-9_.-]+)/gi],
  ['ashby', /jobs\.ashbyhq\.com\/([A-Za-z0-9_.%-]+)/gi],
  ['workable', /apply\.workable\.com\/(?!api\b)([A-Za-z0-9_-]+)/gi],
  ['smartrecruiters', /(?:careers|jobs)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/gi],
  ['recruitee', /\/\/([A-Za-z0-9-]+)\.recruitee\.com/gi],
];
const BAD = new Set(['embed', 'js', 'api', 'v1', 'jobs', 'careers', 'static', 'assets', 'www', 'boards', 'job_board', 'cdn', 'j', 'o', 'p', 'share', 'oauth']);

/** All ATS boards referenced in a blob of text/URLs. */
export function harvestBoards(text) {
  const out = new Map();
  for (const [provider, re] of ATS_GLOBAL) {
    re.lastIndex = 0;
    for (const m of String(text).matchAll(re)) {
      const board = decodeURIComponent(m[1]).replace(/[.)]+$/, '');
      if (!board || board.length < 2 || BAD.has(board.toLowerCase())) continue;
      out.set(`${provider}:${board.toLowerCase()}`, { provider, board });
    }
  }
  return [...out.values()];
}

// Repo searches that surface new curated job lists. `fork:false` avoids hundreds of stale copies.
const QUERIES = [
  'internships 2027 in:name,description fork:false',
  'summer internships in:name,description fork:false',
  'new grad positions in:name,description fork:false',
  'new grad 2026 in:name,description fork:false',
  'off-season internships fork:false',
  'india internships in:name,description fork:false',
  'job board listings json fork:false',
];
const CANDIDATE_PATHS = ['.github/scripts/listings.json', 'listings.json', 'data/listings.json', 'data/jobs.json'];

function looksLikeListings(data) {
  const rows = Array.isArray(data) ? data : data?.listings || data?.jobs;
  if (!Array.isArray(rows) || rows.length < 20) return null;
  const sample = rows.slice(-50);
  const ok = sample.filter(r => r && (r.company_name || r.company) && r.title && r.url).length;
  if (ok < sample.length * 0.8) return null;
  const newest = Math.max(...rows.map(r => Number(r.date_posted) * (Number(r.date_posted) < 1e12 ? 1000 : 1) || Date.parse(r.first_seen || r.date_posted || '') || 0));
  return { rows: rows.length, newest };
}

/** Search GitHub for curated lists not yet known. Returns validated source descriptors. */
export async function discoverGithubLists(known, log = () => { }) {
  const found = [];
  const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const seenRepos = new Set();
  for (const q of QUERIES) {
    let items = [];
    try {
      const { data } = await getJson(`https://api.github.com/search/repositories?q=${encodeURIComponent(`${q} pushed:>${since}`)}&sort=updated&per_page=30`, { conditional: false, headers: { accept: 'application/vnd.github+json' } });
      items = data.items || [];
    } catch (e) { log(`github search failed: ${e.message}`); if (e.status === 403) break; continue; }
    for (const r of items) {
      if (seenRepos.has(r.full_name) || known.has(r.full_name.toLowerCase()) || r.archived) continue;
      seenRepos.add(r.full_name);
      for (const p of CANDIDATE_PATHS) {
        const url = `https://raw.githubusercontent.com/${r.full_name}/${r.default_branch}/${p}`;
        try {
          const { data } = await getJson(url, { conditional: false, timeout: 30000 });
          const v = looksLikeListings(data);
          if (v && Date.now() - v.newest < 21 * 864e5) {
            found.push({ id: `gh:${r.full_name.toLowerCase()}`, repo: r.full_name, name: `${r.full_name} (GitHub)`, url, home: r.html_url, rows: v.rows, stars: r.stargazers_count, addedAt: new Date().toISOString() });
            log(`discovered list ${r.full_name} (${v.rows} rows, ${r.stargazers_count}★)`);
            break;
          }
        } catch { /* path missing */ }
      }
    }
    await new Promise(res => setTimeout(res, 7000)); // unauthenticated search: 10 requests/minute
  }
  return found;
}

/** Fetch a list and summarize its quality: how many rows are dated, and their URLs (for overlap checks). */
export async function inspectList(url) {
  const { data } = await getJson(url, { conditional: false, timeout: 60000 });
  const rows = (Array.isArray(data) ? data : data?.listings || data?.jobs || []).filter(r => r && r.url && r.title && r.active !== false && r.is_visible !== false);
  const validDate = v => { if (v === null || v === undefined || v === '') return false; const n = typeof v === 'number' || /^\d+$/.test(String(v)) ? Number(v) * (Number(v) < 1e12 ? 1000 : 1) : Date.parse(v); return Number.isFinite(n) && n > Date.parse('2020-01-01') && n < Date.now() + 864e5; };
  const dated = rows.filter(r => validDate(r.date_posted) || validDate(r.first_seen) || validDate(r.posted)).length;
  return { rows: rows.length, datedShare: rows.length ? dated / rows.length : 0, urls: rows.slice(-600).map(r => r.url) };
}

/** Poll interval (ms) for a board, adapted to how active and how valuable it is. */
export function boardInterval(b, now = Date.now()) {
  if (b.errors >= 3) return 6 * 36e5;                                     // broken: retry every 6h
  if (b.watched) return 60e3;                                              // you asked for it
  if (b.fundedAt && now - Date.parse(b.fundedAt) < 45 * 864e5) return 120e3; // just raised: about to hire
  if (b.lastNewAt && now - Date.parse(b.lastNewAt) < 3 * 864e5) return 180e3; // posting actively
  if (b.ycRecent) return 600e3;
  if (b.lastNewAt && now - Date.parse(b.lastNewAt) < 21 * 864e5) return 900e3;
  if (b.provider === 'yc') return 3600e3;
  return 1800e3;
}
