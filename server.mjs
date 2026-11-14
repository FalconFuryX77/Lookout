// Lookout — local, near-real-time startup job scanner.
// Polls job sources + company ATS boards on short intervals, links funding news to companies,
// deduplicates across sources, and pushes matches to your phone via ntfy.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './src/store.mjs';
import { JOB_SOURCES } from './src/sources.mjs';
import { FUNDING_FEEDS, fetchFundingFeed, fetchRecentYc, guessWebsite } from './src/funding.mjs';
import { fetchBoard, detectAts, detectInText, ATS_PROVIDERS } from './src/ats.mjs';
import { discoverContacts, websiteFor, NOT_COMPANY_SITES } from './src/contacts.mjs';
import { sendAlerts, testPush } from './src/notify.mjs';
import { matches, effectiveTime } from './public/filters.mjs';
import { normCompany } from './src/dedupe.mjs';
import { pool, domainOf } from './src/util.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const store = new Store(path.join(ROOT, 'data'));
await store.load();
const S = store.state;
store.state.settings.appUrl = `http://127.0.0.1:${PORT}`;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------------------------------------------------------------- funding helpers
const FUNDED_DAYS = 150;
function fundingInfo(c) {
  if (!c) return null;
  const recent = (c.funding || []).filter(f => Date.now() - Date.parse(f.publishedAt || 0) < FUNDED_DAYS * 864e5).sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
  if (recent.length) { const f = recent[0]; return { label: [f.stage !== 'Undisclosed' ? f.stage : 'Raised', f.amount].filter(Boolean).join(' '), at: f.publishedAt, url: f.url, publisher: f.publisher }; }
  if (c.yc && c.ycRecent) return { label: `YC ${c.yc}`, at: null, url: c.ycUrl || `https://www.ycombinator.com/companies/${c.ycSlug || ''}` };
  return null;
}
function view(job) {
  const c = store.company(job.company);
  const funding = fundingInfo(c) || (job.companyMeta?.funded ? { label: job.companyMeta.yc ? `YC ${job.companyMeta.yc}` : 'Funded' } : null);
  return { ...job, funded: !!funding, funding, contactCount: (c?.contacts?.emails?.length || 0) + (job.emails?.length || 0) };
}
function slim(j) {
  const v = view(j);
  const { description, requirements, ...rest } = v;
  return { ...rest, reqCount: requirements?.length || 0, snippet: (description || '').slice(0, 220) };
}

// ---------------------------------------------------------------- alerts
const sse = new Set();
function broadcast(type, data) { const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`; for (const res of sse) res.write(msg); }

function alertEligible(job, bootstrapping) {
  const t = effectiveTime(job); const age = Date.now() - t;
  if (job.precision === 'minute') return age <= (bootstrapping ? 60 : 24 * 60) * 6e4;
  return !bootstrapping && Date.now() - Date.parse(job.firstSeen) < 5 * 6e4 && (!job.postedAt || Date.now() - Date.parse(job.postedAt) < 2 * 864e5);
}
async function handleNew(newJobs, bootstrapping) {
  if (!newJobs.length) return;
  broadcast('jobs', { added: newJobs.map(slim) });
  const items = [];
  for (const j of newJobs) {
    if (!alertEligible(j, bootstrapping)) continue;
    const v = view(j);
    const sets = S.filterSets.filter(fs => fs.alert && matches(v, fs.filters, { tracking: S.tracking }));
    if (sets.length) items.push({ job: v, sets: sets.map(s => s.name) });
  }
  if (!items.length) return;
  for (const { job, sets } of items) S.alerts.unshift({ at: new Date().toISOString(), jobId: job.id, title: job.title, company: job.company, sets });
  broadcast('alert', items.map(({ job, sets }) => ({ id: job.id, title: job.title, company: job.company, sets, url: job.applyUrl || job.url })));
  for (const { job } of items) queueContacts(job); // pre-fetch contacts for anything worth an alert
  try { const r = await sendAlerts(S.settings, items); if (r.sent) log(`push: ${r.sent} notification(s) for ${items.length} match(es)`); }
  catch (e) { log('push failed:', e.message); S.sourceStatus.ntfy = { ok: false, at: new Date().toISOString(), error: e.message }; }
  store.touch();
}

function ingestAll(sourceId, postings) {
  const fresh = [];
  for (const p of postings) {
    if (!p.title || !p.url || !p.company) continue;
    const { job, isNew } = store.ingest({ ...p, source: sourceId });
    if (p.companyMeta?.yc) store.upsertCompany(job.company, { yc: p.companyMeta.yc, ycSlug: p.companyMeta.ycSlug, ycRecent: true });
    if (p.companyUrl && !NOT_COMPANY_SITES.test(p.companyUrl)) { const c = store.company(job.company); if (!c?.website) store.upsertCompany(job.company, { website: p.companyUrl }); }
    if (isNew) fresh.push(job);
  }
  return fresh;
}

// ---------------------------------------------------------------- scheduler
const running = new Set();
const nextAt = {};
async function runSource(src) {
  if (running.has(src.id)) return; running.add(src.id);
  const st = S.sourceStatus[src.id] ||= { cursor: {}, runs: 0 };
  const started = Date.now(); const bootstrapping = !st.runs;
  try {
    const postings = await src.run({ cursor: st.cursor ||= {} });
    const fresh = ingestAll(src.id, postings);
    Object.assign(st, { ok: true, at: new Date().toISOString(), ms: Date.now() - started, fetched: postings.length, added: fresh.length, error: '' });
    st.runs = (st.runs || 0) + 1; st.totalAdded = (st.totalAdded || 0) + fresh.length;
    if (fresh.length) log(`${src.id}: +${fresh.length} new (${postings.length} fetched)`);
    await handleNew(fresh, bootstrapping);
  } catch (e) {
    Object.assign(st, { ok: false, at: new Date().toISOString(), ms: Date.now() - started, error: String(e.message || e).slice(0, 200) });
    log(`${src.id}: ${st.error}`);
  } finally {
    running.delete(src.id); nextAt[src.id] = Date.now() + src.every * 1000; store.touch();
    broadcast('status', { id: src.id, ...publicStatus(src.id) });
  }
}

// ATS boards: every watched / funded / YC company with a detected board.
function boards() {
  const out = [];
  for (const w of S.watch) out.push({ key: `w:${w.id}`, provider: w.provider, board: w.board, company: w.name, priority: 0 });
  for (const c of Object.values(S.companies)) if (c.ats) out.push({ key: `c:${c.key}`, provider: c.ats.provider, board: c.ats.board, company: c.name, priority: fundingInfo(c)?.at ? 1 : 2 });
  return out;
}
const boardPolled = {};
const BOARD_EVERY = [60e3, 120e3, 600e3]; // watched: 1 min, freshly funded: 2 min, other YC: 10 min
async function runBoards() {
  if (running.has('ats')) return; running.add('ats');
  const st = S.sourceStatus['ats'] ||= { cursor: {}, runs: 0 };
  const started = Date.now();
  try {
    const due = boards().filter(b => Date.now() - (boardPolled[b.key] || 0) >= BOARD_EVERY[b.priority]).sort((a, b) => a.priority - b.priority).slice(0, 60);
    let fetched = 0, added = 0, errors = 0;
    await pool(due, 8, async b => {
      boardPolled[b.key] = Date.now();
      try {
        const posts = await fetchBoard(b); fetched += posts.length;
        const firstTime = !st.cursor[b.key]; st.cursor[b.key] = Date.now();
        const fresh = ingestAll('ats', posts); added += fresh.length;
        await handleNew(fresh, firstTime);
      } catch (e) { errors++; if (e.status === 404) { const c = Object.values(S.companies).find(x => `c:${x.key}` === b.key); if (c) c.ats = null; } }
    });
    Object.assign(st, { ok: true, at: new Date().toISOString(), ms: Date.now() - started, fetched, added, boards: boards().length, polled: due.length, error: errors ? `${errors} board(s) failed` : '' });
    st.runs++; st.totalAdded = (st.totalAdded || 0) + added;
    if (added) log(`ats: +${added} new from ${due.length} boards`);
  } finally { running.delete('ats'); nextAt.ats = Date.now() + 30e3; store.touch(); broadcast('status', { id: 'ats', ...publicStatus('ats') }); }
}

// Funding news + YC batches -> companies.
async function runFunding() {
  if (running.has('funding')) return; running.add('funding');
  const st = S.sourceStatus['funding'] ||= { cursor: {}, runs: 0 };
  let added = 0; const errs = [];
  try {
    await pool(FUNDING_FEEDS, 4, async feed => {
      try {
        for (const f of await fetchFundingFeed(feed)) {
          if (S.funding.some(x => x.id === f.id || (normCompany(x.company) === normCompany(f.company) && x.amount === f.amount))) continue;
          S.funding.unshift({ ...f, firstSeen: new Date().toISOString() }); added++;
          store.upsertCompany(f.company, { funding: [{ url: f.url, stage: f.stage, amount: f.amount, publishedAt: f.publishedAt, publisher: f.publisher }] });
        }
      } catch (e) { errs.push(`${feed.name}: ${e.message}`); }
    });
    if (!st.cursor.ycAt || Date.now() - st.cursor.ycAt > 6 * 36e5) {
      const yc = await fetchRecentYc();
      for (const c of yc) store.upsertCompany(c.name, { website: c.website, yc: c.batch, ycSlug: c.slug, ycRecent: true, ycUrl: c.url, oneLiner: c.oneLiner, isHiring: c.isHiring, teamSize: c.teamSize, industry: c.industry });
      st.cursor.ycAt = Date.now(); st.ycCompanies = yc.length;
    }
    S.funding.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
    Object.assign(st, { ok: !errs.length || added > 0, at: new Date().toISOString(), added, error: errs.join(' · ').slice(0, 300) });
    st.runs++;
    if (added) { log(`funding: +${added} rounds`); broadcast('funding', { added }); }
  } finally { running.delete('funding'); nextAt.funding = Date.now() + 5 * 60e3; store.touch(); }
}

// Background discovery: find websites for funded companies, then which ATS they use.
async function runDiscovery() {
  if (running.has('discovery')) return; running.add('discovery');
  try {
    const cands = Object.values(S.companies).filter(c => !c.atsCheckedAt || (Date.now() - Date.parse(c.atsCheckedAt) > 7 * 864e5 && !c.ats))
      .map(c => ({ c, p: (fundingInfo(c)?.at ? 0 : c.isHiring ? 1 : c.yc ? 2 : 3) })).filter(x => x.p < 3).sort((a, b) => a.p - b.p).slice(0, 6);
    await pool(cands, 3, async ({ c }) => {
      if (!c.website) c.website = await guessWebsite(c.name);
      if (c.website) { c.domain = domainOf(c.website); c.ats = await detectAts(c.website, c.name); }
      if (!c.ats && c.ycSlug && c.isHiring) c.ats = { provider: 'yc', board: c.ycSlug };
      c.atsCheckedAt = new Date().toISOString(); store.touch();
      if (c.ats) log(`discovery: ${c.name} -> ${c.ats.provider}/${c.ats.board}`);
    });
  } finally { running.delete('discovery'); nextAt.discovery = Date.now() + 12e3; }
}

// Contacts: on demand + pre-fetched for alerted jobs.
const contactQueue = []; const contactInFlight = new Map();
function queueContacts(job) { if (!contactQueue.includes(job.id)) contactQueue.push(job.id); }
async function contactsFor(job, force = false) {
  const key = normCompany(job.company);
  const c = store.company(job.company) || store.upsertCompany(job.company, {});
  if (!force && c.contacts && Date.now() - Date.parse(c.contacts.checkedAt) < 7 * 864e5) return mergeJobEmails(c.contacts, job);
  if (contactInFlight.has(key)) return contactInFlight.get(key);
  const p = (async () => {
    if (!websiteFor(job, c) && !c.websiteGuessedAt) { c.website = await guessWebsite(c.name); c.websiteGuessedAt = new Date().toISOString(); }
    return discoverContacts(job, c);
  })().then(r => {
    c.contacts = r; if (r.website && !c.website) c.website = r.website; if (r.founders?.length) c.founders = r.founders; c.socials = r.socials;
    if (!c.ats && !c.atsCheckedAt && r.website) detectAts(r.website, c.name).then(a => { c.ats = a; c.atsCheckedAt = new Date().toISOString(); store.touch(); }).catch(() => { });
    store.touch(); return mergeJobEmails(r, job);
  }).finally(() => contactInFlight.delete(key));
  contactInFlight.set(key, p); return p;
}
function mergeJobEmails(r, job) {
  const have = new Set(r.emails.map(e => e.email));
  const extra = (job.emails || []).filter(e => !have.has(e)).map(email => ({ email, role: 'Hiring', source: 'Job posting', url: job.applyUrl || job.url, confidence: 'published' }));
  return { ...r, emails: [...extra, ...r.emails] };
}
async function runContactQueue() {
  const id = contactQueue.shift(); const job = id && store.byId.get(id);
  if (job) { try { await contactsFor(job); broadcast('contacts', { id }); } catch { } }
}

function publicStatus(id) { const { cursor, ...rest } = S.sourceStatus[id] || {}; return { ...rest, nextAt: nextAt[id] || null, running: running.has(id) }; }

let scanAllRequested = false;
async function tick() {
  for (const src of JOB_SOURCES) if (!running.has(src.id) && (scanAllRequested || Date.now() >= (nextAt[src.id] || 0))) runSource(src);
  if (scanAllRequested) { for (const k of Object.keys(boardPolled)) boardPolled[k] = 0; }
  scanAllRequested = false;
  if (Date.now() >= (nextAt.ats || 0)) runBoards();
  if (Date.now() >= (nextAt.funding || 0)) runFunding();
  if (Date.now() >= (nextAt.discovery || 0)) runDiscovery();
  runContactQueue();
}
// stagger first runs so startup doesn't hammer everything at once
JOB_SOURCES.forEach((s, i) => { nextAt[s.id] = Date.now() + i * 1500; });
nextAt.ats = Date.now() + 20e3; nextAt.discovery = Date.now() + 30e3;
setInterval(tick, 3000); tick();
setInterval(() => { store.prune(); store.save().catch(e => log('save failed', e.message)); }, 15e3);
setInterval(() => { for (const res of sse) res.write(': ping\n\n'); }, 25e3);

// ---------------------------------------------------------------- HTTP API
function json(res, code, v) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(v)); }
async function body(req) { let s = ''; for await (const c of req) { s += c; if (s.length > 2e6) throw new Error('Request too large'); } return s ? JSON.parse(s) : {}; }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

function sourcesMeta() {
  return [
    ...JOB_SOURCES.map(s => ({ id: s.id, name: s.name, every: s.every, home: s.home, trust: s.trust, kind: 'jobs', ...publicStatus(s.id) })),
    { id: 'ats', name: 'Company career pages (ATS)', every: 30, home: '', trust: 'Direct from the company’s own Greenhouse / Lever / Ashby / Workable / SmartRecruiters / Recruitee board', kind: 'jobs', ...publicStatus('ats') },
    { id: 'funding', name: 'Funding news + YC batches', every: 300, home: '', trust: FUNDING_FEEDS.map(f => f.name).join(', ') + ', yc-oss', kind: 'funding', ...publicStatus('funding') },
  ];
}
function signals() {
  const jobsByCo = new Map();
  for (const j of S.jobs) { const k = normCompany(j.company); jobsByCo.set(k, (jobsByCo.get(k) || 0) + 1); }
  return Object.values(S.companies).map(c => ({ c, f: fundingInfo(c) })).filter(x => x.f)
    .map(({ c, f }) => ({ key: c.key, name: c.name, website: c.website || '', oneLiner: c.oneLiner || '', industry: c.industry || '', teamSize: c.teamSize || null, yc: c.yc || '', funding: f, rounds: c.funding || [], isHiring: !!c.isHiring, ats: c.ats || null, atsCheckedAt: c.atsCheckedAt || null, openJobs: jobsByCo.get(c.key) || 0, contacts: c.contacts ? { emails: c.contacts.emails.slice(0, 4), founders: c.contacts.founders || [] } : null, founders: c.founders || [] }))
    .sort((a, b) => (b.funding.at || '0').localeCompare(a.funding.at || '0') || b.openJobs - a.openJobs);
}

async function route(req, res) {
  const url = new URL(req.url, 'http://x'); const p = url.pathname; const m = req.method;
  if (m === 'GET' && p === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write('retry: 3000\n\n'); sse.add(res); req.on('close', () => sse.delete(res)); return;
  }
  if (m === 'GET' && p === '/api/jobs') return json(res, 200, { jobs: S.jobs.map(slim), now: Date.now() });
  if (m === 'GET' && p.startsWith('/api/job/')) { const j = store.byId.get(decodeURIComponent(p.slice(9))); return j ? json(res, 200, view(j)) : json(res, 404, { error: 'Not found' }); }
  if (m === 'GET' && p === '/api/meta') {
    const { ntfyToken, ...settings } = S.settings;
    return json(res, 200, { settings: { ...settings, hasToken: !!ntfyToken }, filterSets: S.filterSets, tracking: S.tracking, sources: sourcesMeta(), watch: S.watch, alerts: S.alerts.slice(0, 50), funding: S.funding.slice(0, 300), stats: { jobs: S.jobs.length, companies: Object.keys(S.companies).length, boards: boards().length, funded: Object.values(S.companies).filter(c => fundingInfo(c)).length } });
  }
  if (m === 'GET' && p === '/api/signals') return json(res, 200, { companies: signals() });
  if (m === 'GET' && p.startsWith('/api/contacts/')) {
    const j = store.byId.get(decodeURIComponent(p.slice(14))); if (!j) return json(res, 404, { error: 'Not found' });
    return json(res, 200, await contactsFor(j, url.searchParams.get('refresh') === '1'));
  }
  if (m === 'POST' && p === '/api/scan') { scanAllRequested = true; nextAt.ats = 0; nextAt.funding = 0; return json(res, 200, { ok: true }); }
  if (m === 'POST' && p === '/api/filter-sets') {
    const b = await body(req); const name = String(b.name || '').trim().slice(0, 60);
    if (!name) return json(res, 400, { error: 'Give the filter set a name.' });
    const existing = S.filterSets.find(f => f.id === b.id);
    const rec = { id: existing?.id || `fs-${Date.now().toString(36)}`, name, alert: !!b.alert, filters: b.filters || {} };
    if (existing) Object.assign(existing, rec); else S.filterSets.push(rec);
    store.touch(); await store.save(); return json(res, 200, rec);
  }
  if (m === 'DELETE' && p.startsWith('/api/filter-sets/')) { const id = decodeURIComponent(p.slice(17)); S.filterSets = S.filterSets.filter(f => f.id !== id); store.touch(); return json(res, 200, { ok: true }); }
  if (m === 'POST' && p === '/api/track') {
    const b = await body(req); if (!store.byId.has(b.id)) return json(res, 404, { error: 'Unknown job' });
    if (!b.status) delete S.tracking[b.id]; else S.tracking[b.id] = { status: b.status, note: String(b.note || '').slice(0, 2000), at: new Date().toISOString() };
    store.touch(); return json(res, 200, S.tracking[b.id] || null);
  }
  if (m === 'POST' && p === '/api/settings') {
    const b = await body(req); const s = S.settings;
    for (const k of ['ntfyServer', 'ntfyTopic', 'quietHours']) if (k in b) s[k] = String(b[k] || '').trim();
    if ('ntfyToken' in b && b.ntfyToken !== '••••') s.ntfyToken = String(b.ntfyToken || '').trim();
    if ('desktopNotify' in b) s.desktopNotify = !!b.desktopNotify;
    if (b.profile) s.profile = { name: String(b.profile.name || '').slice(0, 80), pitch: String(b.profile.pitch || '').slice(0, 1500), link: String(b.profile.link || '').slice(0, 300), skills: (b.profile.skills || []).map(String).slice(0, 40) };
    store.touch(); await store.save(); return json(res, 200, { ok: true });
  }
  if (m === 'POST' && p === '/api/test-push') { try { const r = await testPush(S.settings); return json(res, r.skipped ? 400 : 200, r.skipped ? { error: 'Set an ntfy topic first.' } : r); } catch (e) { return json(res, 502, { error: e.message }); } }
  if (m === 'POST' && p === '/api/watch') {
    const b = await body(req); const name = String(b.name || '').trim();
    let target = null; const input = String(b.url || '').trim();
    if (b.provider && b.board) target = { provider: b.provider, board: String(b.board).trim() };
    else if (input) target = detectInText(input) || (/^https?:/.test(input) ? await detectAts(input, name) : null);
    if (!target || !ATS_PROVIDERS.includes(target.provider)) return json(res, 400, { error: 'Could not find a Greenhouse, Lever, Ashby, Workable, SmartRecruiters or Recruitee board at that address.' });
    try { await fetchBoard(target); } catch (e) { return json(res, 400, { error: `Board ${target.provider}/${target.board} did not respond (${e.message}).` }); }
    const w = { id: Date.now().toString(36), name: name || target.board, ...target, addedAt: new Date().toISOString() };
    S.watch.unshift(w); store.touch(); nextAt.ats = 0; return json(res, 200, w);
  }
  if (m === 'DELETE' && p.startsWith('/api/watch/')) { const id = decodeURIComponent(p.slice(11)); S.watch = S.watch.filter(w => w.id !== id); store.touch(); return json(res, 200, { ok: true }); }
  if (m === 'GET') {
    const file = p === '/' ? 'index.html' : p.slice(1);
    const full = path.join(ROOT, 'public', file);
    if (!full.startsWith(path.join(ROOT, 'public'))) return json(res, 403, { error: 'Forbidden' });
    try { const data = await fs.readFile(full); res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream', 'cache-control': 'no-cache' }); return res.end(data); }
    catch { return json(res, 404, { error: 'Not found' }); }
  }
  json(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => route(req, res).catch(e => { log('api error', e.message); if (!res.headersSent) json(res, 500, { error: e.message }); }));
server.listen(PORT, HOST, () => log(`Lookout running at http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { store.touch(); await store.save().catch(() => { }); process.exit(0); });
