// Lookout — local, near-real-time startup job scanner.
// Polls job sources + company ATS boards on short intervals, links funding news to companies,
// deduplicates across sources, and pushes matches to your phone via ntfy.
import http from 'node:http';
import zlib from 'node:zlib';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, DEFAULT_FILTER_SETS } from './src/store.mjs';
import { JOB_SOURCES, genericListAdapter } from './src/sources.mjs';
import { harvestBoards, discoverGithubLists, boardInterval, inspectList } from './src/discovery.mjs';
import { FUNDING_FEEDS, fetchFundingFeed, fetchRecentYc, fetchYcHiring, guessWebsite, parseHeadline } from './src/funding.mjs';
import { fetchBoard, detectAts, detectInText, ATS_PROVIDERS } from './src/ats.mjs';
import { discoverContacts, websiteFor, NOT_COMPANY_SITES } from './src/contacts.mjs';
import { sendAlerts, testPush, resolveChannel } from './src/notify.mjs';
import { DEFAULT_LINKEDIN_SEARCHES, LINKEDIN_ALERT_MAX_MIN } from './src/linkedin.mjs';
import { resumeText, parseResume } from './src/resume.mjs';
import { matches, effectiveTime, fundStageOf, normCo } from './public/filters.mjs';
import { normCompany } from './src/dedupe.mjs';
import { namedEmployer, sameRole, boardSlugs, linkRank, REPOSTER } from './src/root.mjs';
import { pool, domainOf, canonicalUrl, exportHttpValidators, importHttpValidators } from './src/util.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const store = new Store(process.env.LOOKOUT_DATA || path.join(ROOT, 'data'));
await store.load();
const S = store.state;
const catchUpUntil = store.repaired ? Date.now() + 30 * 60e3 : 0;
store.state.settings.appUrl = `http://127.0.0.1:${PORT}`;
S.settings.linkedinSearches ||= DEFAULT_LINKEDIN_SEARCHES;
S.boards ||= {}; S.dynamicSources ||= []; S.discoveryLog ||= []; S.blockedCompanies ||= [];
// Profiles: several people (or several résumés) on one computer. The open profile's saved views, pipeline,
// blocked companies and profile live in the usual places; the others wait in S.profiles until switched to.
// Alerts keep going out for every profile's views, open or not.
if (!Array.isArray(S.profiles) || !S.profiles.length) { S.profiles = [{ id: 'p1', label: S.settings.profile?.name || 'Me' }]; S.activeProfile = 'p1'; }
if (!S.profiles.some(p => p.id === S.activeProfile)) S.activeProfile = S.profiles[0].id;
const str = (v, n) => String(v ?? '').trim().slice(0, n);
function cleanProfile(b = {}, prev = {}) {
  const list = (v, n, len) => (Array.isArray(v) ? v : []).map(x => str(x, len)).filter(Boolean).slice(0, n);
  const num = (v, lo, hi) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Math.min(hi, Math.max(lo, Number(v))));
  const pick = k => (k in b ? b[k] : prev[k]);
  return {
    name: str(b.name, 80), pitch: str(b.pitch, 1500), link: str(b.link, 300),
    skills: [...new Map(list(b.skills, 120, 40).map(s => [s.toLowerCase(), s])).values()],
    headline: str(pick('headline'), 120), email: str(pick('email'), 120), phone: str(pick('phone'), 40),
    links: list(pick('links'), 8, 300), education: list(pick('education'), 8, 220), experience: list(pick('experience'), 14, 220),
    yearsExp: num(pick('yearsExp'), 0, 50), degree: str(pick('degree'), 20), gradYear: num(pick('gradYear'), 1970, 2100),
    projects: list(pick('projects'), 12, 260), strictFit: pick('strictFit') !== false, manualSkills: list(pick('manualSkills'), 120, 40),
    resume: pick('resume') && typeof pick('resume') === 'object' ? { file: str(pick('resume').file, 120), at: str(pick('resume').at, 30), chars: Number(pick('resume').chars) || 0 } : null,
  };
}
const blankProfile = () => cleanProfile({});
function alertScopes() {
  const scope = (filterSets, tracking, blocked, label, profile) => ({ filterSets: filterSets || [], ctx: { tracking: tracking || {}, blocked: new Set((blocked || []).map(normCo)), profile }, label });
  return [scope(S.filterSets, S.tracking, S.blockedCompanies, '', S.settings.profile), ...S.profiles.filter(p => p.id !== S.activeProfile && p.filterSets).map(p => scope(p.filterSets, p.tracking, p.blockedCompanies, p.label, p.profile))];
}
function switchProfile(id) {
  const to = S.profiles.find(p => p.id === id), from = S.profiles.find(p => p.id === S.activeProfile);
  if (!to || to === from) return false;
  if (from) Object.assign(from, { profile: S.settings.profile, filterSets: S.filterSets, tracking: S.tracking, blockedCompanies: S.blockedCompanies });
  S.settings.profile = to.profile || blankProfile(); S.filterSets = to.filterSets || []; S.tracking = to.tracking || {}; S.blockedCompanies = to.blockedCompanies || [];
  for (const k of ['profile', 'filterSets', 'tracking', 'blockedCompanies']) delete to[k];
  S.activeProfile = id; return true;
}
async function rawBody(req, max = 8e6) { const chunks = []; let n = 0; for await (const c of req) { n += c.length; if (n > max) throw new Error('That file is too large (8 MB is the limit).'); chunks.push(c); } return Buffer.concat(chunks); }

importHttpValidators(S.httpValidators); // resume: ask feeds "anything new since last time?" instead of re-downloading
for (const c of Object.values(S.companies)) if (c.contacts && c.contacts.v !== 2) c.contacts = null; // re-check with the cleaner v2 finder
if (S.boardVerifyMigrated !== 1) { // drop boards that were guessed from company names (unverified), then re-detect from site links
  const reset = new Set();
  for (const c of Object.values(S.companies)) if (c.ats && c.ats.provider !== 'yc' && !c.atsVia && (c.yc || c.funding?.length)) { reset.add(c.key); c.ats = null; c.atsCheckedAt = null; }
  for (const b of Object.values(S.boards)) if (!b.watched && ['YC directory', 'funding news', 'company site'].includes(b.via) && reset.has(normCompany(b.company))) delete S.boards[b.key];
  const old = S.jobs; const before = old.length;
  const drop = j => j.sources.every(s => s.source === 'ats') && reset.has(normCompany(j.company)) && !S.tracking[j.id];
  for (const j of old) if (drop(j)) { store.byId.delete(j.id); store.dedupe.unindex(j); }
  S.jobs = old.filter(j => !drop(j)); // S is store.state
  S.boardVerifyMigrated = 1; store.touch();
  console.log(`boards: re-verifying ${reset.size} companies; removed ${before - S.jobs.length} roles from unverified boards`);
}
{ // re-validate stored funding headlines with the current parser (drops IPOs, VC funds, bad names)
  const bad = new Set(S.funding.filter(f => !parseHeadline(f.title)).map(f => f.url));
  if (bad.size) { S.funding = S.funding.filter(f => !bad.has(f.url)); for (const c of Object.values(S.companies)) if (c.funding?.length) c.funding = c.funding.filter(f => !bad.has(f.url)); console.log(`funding: dropped ${bad.size} non-funding headlines`); }
}
const allSources = () => [...JOB_SOURCES, ...dynamicSourceObjects()];
const srcLabel = id => allSources().find(s => s.id === id)?.name || id;
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
  const v = { ...job, funded: !!funding, funding, contactCount: (c?.contacts?.emails?.length || 0) + (job.emails?.length || 0), teamSize: c?.teamSize || null };
  v.fundStage = fundStageOf(v);
  const site = c?.website || websiteFor(job, c);
  v.domain = c?.domain || (site ? domainOf(site) : '');
  return v;
}
function slim(j) {
  const v = view(j);
  // The list needs far less than the detail view: no description, URLs, skill groups or full source records.
  const { description, requirements, urls, companyUrl, applyUrl, companyMeta, lastSeen, url, skills, sources, emails, ...rest } = v;
  return { ...rest, skills: (skills || []).map(s => s.name), sources: (sources || []).map(s => ({ source: s.source })), emails: emails?.length ? [emails[0]] : [], snippet: (description || '').slice(0, 160) };
}

// ---------------------------------------------------------------- alerts
const sse = new Set();
function broadcast(type, data) { const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`; for (const res of sse) res.write(msg); }

function alertEligible(job, bootstrapping) {
  const t = effectiveTime(job); const age = Date.now() - t;
  if (Date.now() < catchUpUntil && age > 2 * 36e5) return false; // re-reading boards after a data repair: old roles come back as "new" once, and must not buzz anyone
  // LinkedIn is a race: a push about a role that is already hours old is noise. It still shows in the app.
  if (job.sources.every(s => s.source === 'linkedin')) return job.precision === 'minute' && age <= LINKEDIN_ALERT_MAX_MIN * 6e4;
  if (job.precision === 'minute') return age <= (bootstrapping ? 60 : 24 * 60) * 6e4;
  return !bootstrapping && Date.now() - Date.parse(job.firstSeen) < 5 * 6e4 && (!job.postedAt || Date.now() - Date.parse(job.postedAt) < 2 * 864e5);
}
async function handleNew(newJobs, bootstrapping) {
  if (!newJobs.length) return;
  broadcast('jobs', { added: newJobs.map(slim) });
  const items = []; const scopes = alertScopes();
  for (const j of newJobs) {
    if (!alertEligible(j, bootstrapping)) continue;
    const v = view(j);
    const sets = scopes.flatMap(sc => sc.filterSets.filter(fs => fs.alert && matches(v, fs.filters, sc.ctx)).map(fs => ({ name: sc.label ? `${fs.name} (${sc.label})` : fs.name, channel: fs.channel || '' })));
    if (sets.length) items.push({ job: v, sets });
  }
  if (!items.length) return;
  for (const { job, sets } of items) S.alerts.unshift({ at: new Date().toISOString(), jobId: job.id, title: job.title, company: job.company, sets: sets.map(s => s.name) });
  broadcast('alert', items.map(({ job, sets }) => ({ id: job.id, title: job.title, company: job.company, sets: sets.map(s => s.name), url: job.applyUrl || job.url })));
  for (const { job } of items) queueContacts(job); // pre-fetch contacts for anything worth an alert
  try {
    const r = await sendAlerts(S.settings, items);
    if (r.sent) log(`push: ${r.sent} notification(s) for ${items.length} match(es) -> ${r.channels.join(', ')}`);
    if (r.errors.length) { log('push failed:', r.errors.join(' | ')); S.sourceStatus.ntfy = { ok: false, at: new Date().toISOString(), error: r.errors.join(' | ') }; }
  }
  catch (e) { log('push failed:', e.message); S.sourceStatus.ntfy = { ok: false, at: new Date().toISOString(), error: e.message }; }
  store.touch();
}

function ingestAll(sourceId, postings, backfill = false) {
  const fresh = [];
  for (const p of postings) {
    if (!p.title || !p.url || !p.company) continue;
    const { job, isNew } = store.ingest({ ...p, source: sourceId, backfill: backfill && !p.postedAt });
    if (!job) continue; // too old or previously pruned
    if (!isNew && !backfill) continue; // known posting; nothing new to learn from its links
    if (p.companyMeta?.yc) store.upsertCompany(job.company, { yc: p.companyMeta.yc, ycSlug: p.companyMeta.ycSlug, ycRecent: true });
    if (p.companyUrl && !NOT_COMPANY_SITES.test(p.companyUrl)) { const c = store.company(job.company); if (!c?.website) store.upsertCompany(job.company, { website: p.companyUrl }); }
    for (const h of harvestBoards(`${p.url} ${p.applyUrl || ''} ${sourceId === 'hn-hiring' ? p.description || '' : ''}`)) {
      if (sourceId === 'ats') break; // a board's own links point back to itself
      addBoard(h.provider, h.board, job.company, srcLabel(sourceId));
      const c = store.company(job.company); if (c && !c.ats) { c.ats = h; c.atsVia = 'harvest'; c.atsCheckedAt = new Date().toISOString(); }
    }
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
    let postings;
    try { postings = await src.run({ cursor: st.cursor ||= {}, settings: S.settings, known: u => { const c = canonicalUrl(u); return store.dedupe.byUrl.has(c) || store.gone.has(c); } }); }
    catch (e) { if (!e.notModified) throw e; postings = []; } // feed unchanged since last check
    const fresh = await resolveRoots(ingestAll(src.id, postings, bootstrapping));
    Object.assign(st, { ok: true, at: new Date().toISOString(), ms: Date.now() - started, fetched: postings.length, added: fresh.length, error: '' });
    if (postings.length) { st.dataRuns = (st.dataRuns || 0) + 1; st.seen = (st.seen || 0) + postings.length; st.unique = (st.unique || 0) + fresh.length; }
    if (src.dynamic) { const d = S.dynamicSources.find(x => x.id === src.id); if (d && st.dataRuns >= 2 && !st.unique) { d.disabled = true; (S.rejectedRepos ||= []).push(d.repo.toLowerCase()); S.discoveryLog.unshift({ at: new Date().toISOString(), kind: 'retired', text: d.name, via: 'no unique jobs' }); log(`retired ${d.name}: everything it lists is already covered`); } }
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

// ATS boards registry: watched + company-detected + harvested from every link we see.
const bkey = (provider, board) => `${provider}:${String(board).toLowerCase()}`;
const JUNK_BOARD = /\s|^[0-9a-f]{8}-[0-9a-f]{4}-|test|referral|sandbox|demo|merge|staging|^(?:en|de|fr|es|us|uk)(?:-[a-z]{2})?$/i;
const boardByCo = new Map(); // normCompany -> board key (one board per company)
{ // startup cleanup: drop junk boards and keep one board per company (prefer a real ATS with the most roles)
  const keep = new Map(); let removed = 0;
  for (const b of Object.values(S.boards)) {
    if (!b.watched && b.provider !== 'yc' && JUNK_BOARD.test(b.board)) { delete S.boards[b.key]; removed++; continue; }
    const ck = normCompany(b.company); const cur = keep.get(ck);
    const rank = x => (x.watched ? 1e6 : 0) + (x.provider === 'yc' ? 0 : 1e5) + (x.openRoles || 0);
    if (!cur) keep.set(ck, b); else { const loser = rank(b) > rank(cur) ? cur : b; if (!loser.watched) { delete S.boards[loser.key]; removed++; } keep.set(ck, loser === cur ? b : cur); }
  }
  for (const [ck, b] of keep) if (S.boards[b.key]) boardByCo.set(ck, b.key);
  if (removed) console.log(`boards: removed ${removed} junk/duplicate boards`);
}
function addBoard(provider, board, company, via, { force = false } = {}) {
  if (!ATS_PROVIDERS.includes(provider) || !board) return null;
  if (!force && provider !== 'yc' && JUNK_BOARD.test(board)) return null;
  const k = bkey(provider, board);
  let b = S.boards[k];
  const ck = company ? normCompany(company) : '';
  if (!b && ck && !force) { const other = S.boards[boardByCo.get(ck)]; if (other && other.key !== k && (other.errors || 0) < 3) return other; }
  if (!b) { if (ck) boardByCo.set(ck, k); b = S.boards[k] = { key: k, provider, board, company: company || board, via, addedAt: new Date().toISOString(), newCount: 0, errors: 0 }; S.discoveryLog.unshift({ at: b.addedAt, kind: 'board', text: `${company || board} · ${provider}`, via }); store.touch(); }
  else if (company && b.company === b.board) b.company = company;
  return b;
}
function syncBoards() {
  for (const w of S.watch) { const b = addBoard(w.provider, w.board, w.name, 'you', { force: true }); if (b) b.watched = true; }
  const watched = new Set(S.watch.map(w => bkey(w.provider, w.board)));
  for (const b of Object.values(S.boards)) if (b.watched && !watched.has(b.key)) b.watched = false;
  for (const c of Object.values(S.companies)) {
    if (!c.ats) continue;
    const b = addBoard(c.ats.provider, c.ats.board, c.name, c.funding?.length ? 'funding news' : c.yc ? 'YC directory' : 'company site');
    if (!b) continue;
    const f = fundingInfo(c); b.fundedAt = f?.at || null; b.ycRecent = !!(c.yc && c.ycRecent);
  }
}
function boards() { return Object.values(S.boards); }
async function runBoards() {
  if (running.has('ats')) return; running.add('ats');
  const st = S.sourceStatus['ats'] ||= { cursor: {}, runs: 0 };
  const started = Date.now();
  try {
    syncBoards();
    const now = Date.now();
    // Most overdue relative to its own interval first, so slow tiers aren't starved by fast ones.
    const due = boards().map(b => { const iv = boardInterval(b, now); return { b, ratio: (now - Date.parse(b.lastPolled || 0)) / iv }; }).filter(x => x.ratio >= 1)
      .sort((x, y) => y.ratio - x.ratio).slice(0, 50).map(x => x.b);
    let fetched = 0, added = 0, errors = 0;
    await pool(due, 10, async b => {
      b.lastPolled = new Date().toISOString();
      try {
        const posts = await fetchBoard({ provider: b.provider, board: b.board, company: b.company !== b.board ? b.company : undefined }); fetched += posts.length;
        const firstTime = !b.polledOnce; b.polledOnce = true; b.errors = 0; b.openRoles = posts.length;
        const fresh = ingestAll('ats', posts, firstTime); added += fresh.length;
        if (fresh.length && !firstTime) { b.lastNewAt = new Date().toISOString(); b.newCount += fresh.length; }
        if (firstTime && posts.length) b.lastNewAt = posts.map(p => p.postedAt).filter(Boolean).sort().pop() || null;
        await handleNew(fresh, firstTime);
      } catch (e) {
        if (e.notModified) { b.errors = 0; return; } // board unchanged since last poll: nothing to do
        errors++; b.errors = (b.errors || 0) + 1; b.lastError = e.message;
        if (e.status === 404 && b.errors >= 3 && !b.watched) { delete S.boards[b.key]; const c = Object.values(S.companies).find(x => x.ats && bkey(x.ats.provider, x.ats.board) === b.key); if (c) c.ats = null; }
      }
    });
    Object.assign(st, { ok: true, at: new Date().toISOString(), ms: Date.now() - started, fetched, added, boards: boards().length, polled: due.length, error: errors ? `${errors} board(s) failed this round` : '' });
    st.runs++; st.totalAdded = (st.totalAdded || 0) + added;
    if (added) log(`ats: +${added} new from ${due.length} boards`);
  } finally { running.delete('ats'); nextAt.ats = Date.now() + 15e3; store.touch(); broadcast('status', { id: 'ats', ...publicStatus('ats') }); }
}

// GitHub list discovery: find new curated job-list repos every 6 hours.
async function runListDiscovery() {
  if (running.has('lists')) return; running.add('lists');
  try {
    const known = new Set([...JOB_SOURCES.map(s => (s.home || '').replace('https://github.com/', '').toLowerCase()), ...S.dynamicSources.map(d => d.repo.toLowerCase()), ...(S.rejectedRepos || [])]);
    const found = await discoverGithubLists(known, m => log('lists:', m));
    // Quality gate: must be mostly dated, and must not just mirror what other sources already have.
    const judge = async (d, selfId) => {
      const q = await inspectList(d.url);
      const covered = q.urls.filter(u => { const id = store.dedupe.byUrl.get(canonicalUrl(u)); const j = id && store.byId.get(id); return (j && j.sources.some(s => s.source !== selfId)) || store.gone.has(canonicalUrl(u)); }).length;
      const overlap = q.urls.length ? covered / q.urls.length : 1;
      if (q.datedShare < 0.5) return `only ${Math.round(q.datedShare * 100)}% of rows are dated`;
      if (overlap > 0.7) return `${Math.round(overlap * 100)}% duplicates other sources`;
      return null;
    };
    const retire = (d, why) => { d.disabled = true; (S.rejectedRepos ||= []).push(d.repo.toLowerCase()); S.discoveryLog.unshift({ at: new Date().toISOString(), kind: 'retired', text: d.name, via: why }); log(`lists: retired ${d.name} (${why})`); };
    for (const d of S.dynamicSources.filter(x => !x.disabled && x.validated !== 2)) {
      try { const why = await judge(d, d.id); if (why) retire(d, why); else { d.validated = 2; log(`lists: kept ${d.name}`); } }
      catch (e) { log(`lists: could not check ${d.name}: ${e.message}`); }
    }
    let added = 0;
    for (const d of found) {
      let why = null; try { why = await judge(d, d.id); } catch (e) { why = e.message; }
      if (why) { (S.rejectedRepos ||= []).push(d.repo.toLowerCase()); log(`lists: skipped ${d.name} (${why})`); continue; }
      S.dynamicSources.push({ ...d, every: 300, runs: 0, unique: 0, disabled: false, validated: 2 }); added++;
      S.discoveryLog.unshift({ at: d.addedAt, kind: 'source', text: d.name, via: 'GitHub search' });
    }
    S.sourceStatus.lists = { ok: true, at: new Date().toISOString(), added, error: '' };
    store.touch();
  } catch (e) { S.sourceStatus.lists = { ok: false, at: new Date().toISOString(), error: e.message }; }
  finally { running.delete('lists'); nextAt.lists = Date.now() + 6 * 36e5; }
}
function dynamicSourceObjects() {
  return S.dynamicSources.filter(d => !d.disabled).map(d => ({ id: d.id, name: d.name, every: d.every || 300, home: d.home, trust: `Auto-discovered GitHub list (${d.stars ?? 0}★, ${d.rows} rows)`, dynamic: true, run: genericListAdapter(d.url, d.id) }));
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
      try { const hiring = await fetchYcHiring(); for (const c of hiring) { const co = store.upsertCompany(c.name, { website: c.website, yc: c.batch, ycSlug: c.slug, ycUrl: c.url, oneLiner: c.oneLiner, isHiring: true, teamSize: c.teamSize, industry: c.industry }); if (co && !co.ats) co.ats = { provider: 'yc', board: c.slug }; } st.ycHiring = hiring.length; } catch (e) { errs.push(`YC hiring: ${e.message}`); }
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
      if (c.website) { c.domain = domainOf(c.website); c.ats = await detectAts(c.website, c.name); if (c.ats) c.atsVia = 'site'; }
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
    if (!c.ats && !c.atsCheckedAt && r.website) detectAts(r.website, c.name).then(a => { c.ats = a; if (a) c.atsVia = 'site'; c.atsCheckedAt = new Date().toISOString(); store.touch(); }).catch(() => { });
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
  for (const src of allSources()) if (!running.has(src.id) && (scanAllRequested || Date.now() >= (nextAt[src.id] || 0))) runSource(src);
  if (scanAllRequested) { for (const b of boards()) if (boardInterval(b) <= 600e3) b.lastPolled = null; }
  scanAllRequested = false;
  if (Date.now() >= (nextAt.ats || 0)) runBoards();
  if (Date.now() >= (nextAt.funding || 0)) runFunding();
  if (Date.now() >= (nextAt.discovery || 0)) runDiscovery();
  if (Date.now() >= (nextAt.lists || 0)) runListDiscovery();
  runContactQueue();
}
// stagger first runs so startup doesn't hammer everything at once
JOB_SOURCES.forEach((s, i) => { nextAt[s.id] = Date.now() + i * 1500; });
nextAt.ats = Date.now() + 20e3; nextAt.discovery = Date.now() + 30e3; nextAt.lists = S.dynamicSources.some(d => !d.disabled && d.validated !== 2) ? Date.now() + 60e3 : S.sourceStatus.lists?.at ? Date.parse(S.sourceStatus.lists.at) + 6 * 36e5 : Date.now() + 90e3;
// ---------------------------------------------------------------- root postings
// A role that reaches us through a re-poster is folded into the employer's own listing when that can be
// found; when it can't, the copy is kept but marked, so it can be hidden and is never mistaken for the source.
const squash = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
S.rootProbes ||= {};
async function findRoot(j, { probe = true } = {}) {
  const reposter = REPOSTER.test(j.company); const named = namedEmployer(j);
  if (!named && !reposter) return null;
  let rootJob = null, employer = '';
  if (named) {
    const a = squash(named.name), b = squash(j.company);
    if (a.length >= 3 && !a.includes(b) && !b.includes(a)) {
      const ck = normCompany(named.name);
      const theirs = S.jobs.filter(x => x !== j && normCompany(x.company) === ck);
      if (theirs.length) employer = theirs[0].company; else if (reposter && named.mentions >= 2) employer = named.name;
      rootJob = theirs.find(x => linkRank(x.applyUrl || x.url) >= linkRank(j.applyUrl || j.url) && sameRole(j, x)) || null;
      // Only for known re-posters: look for the employer's own board, and accept it only if this very role is on it.
      if (!rootJob && probe && reposter && !boardByCo.has(ck) && Date.now() - Date.parse(S.rootProbes[ck] || 0) > 7 * 864e5) {
        S.rootProbes[ck] = new Date().toISOString();
        search: for (const provider of ['ashby', 'greenhouse', 'lever', 'workable']) for (const slug of boardSlugs(named.name)) {
          let posts; try { posts = await fetchBoard({ provider, board: slug, company: named.name }); } catch { continue; }
          const hit = posts.find(p => sameRole(j, p)); if (!hit) continue;
          const b2 = addBoard(provider, slug, named.name, 'named in a re-post'); if (b2) { b2.polledOnce = true; b2.lastPolled = new Date().toISOString(); b2.openRoles = posts.length; }
          ingestAll('ats', posts, true);
          rootJob = store.byId.get(store.dedupe.byUrl.get(canonicalUrl(hit.url))) || null; employer = named.name;
          break search;
        }
      }
    }
  }
  return { rootJob: rootJob === j ? null : rootJob, employer, reposter };
}
async function resolveRoots(fresh, opts) {
  const out = [];
  for (const j of fresh) {
    if (j.sources.some(s => s.source === 'ats')) { out.push(j); continue; }
    let r = null; try { r = await findRoot(j, opts); } catch { /* leave the posting as it is */ }
    if (r?.rootJob) {
      const justFound = Date.now() - Date.parse(r.rootJob.firstSeen) < 2 * 6e4;
      log(`root: "${j.title}" from ${j.company} is ${r.rootJob.company}'s own listing; kept that one`);
      store.fold(r.rootJob, j);
      if (justFound && !out.includes(r.rootJob)) out.push(r.rootJob); // the original is new to us too: it gets the alert
      continue;
    }
    if (r?.reposter && !j.middleman) { j.middleman = { employer: r.employer || '' }; store.touch(); }
    out.push(j);
  }
  return out;
}
// One pass over what is already stored (no outside requests): fold or mark the re-posts that arrived before this existed.
if (S.rootPass !== 1) setTimeout(async () => {
  const before = S.jobs.length; const list = S.jobs.filter(j => !j.sources.some(s => s.source === 'ats'));
  await resolveRoots(list, { probe: false });
  S.rootPass = 1; store.touch();
  log(`root: checked ${list.length} stored roles, folded ${before - S.jobs.length} re-posts, marked ${S.jobs.filter(j => j.middleman).length}`);
}, 15000);
setInterval(tick, 3000); tick();
setInterval(() => { store.prune(); S.httpValidators = exportHttpValidators(); store.save().catch(e => log('save failed', e.message)); }, 15e3);
setInterval(() => { for (const res of sse) res.write('event: ping\ndata: {}\n\n'); }, 25e3); // heartbeat the page can see

// ---------------------------------------------------------------- HTTP API
function json(res, code, v) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(v)); }
async function body(req) { let s = ''; for await (const c of req) { s += c; if (s.length > 2e6) throw new Error('Request too large'); } return s ? JSON.parse(s) : {}; }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

function sourcesMeta() {
  return [
    ...allSources().map(s => ({ id: s.id, name: s.name, every: s.every, home: s.home, trust: s.trust, kind: 'jobs', dynamic: !!s.dynamic, ...publicStatus(s.id) })),
    { id: 'ats', name: 'Company career pages (ATS)', every: 30, home: '', trust: 'Direct from each company’s own Greenhouse / Lever / Ashby / Workable / SmartRecruiters / Recruitee / YC board, polled every 1–60 min depending on activity', kind: 'jobs', ...publicStatus('ats') },
    { id: 'funding', name: 'Funding news + YC batches', every: 300, home: '', trust: FUNDING_FEEDS.map(f => f.name).join(', ') + ', yc-oss', kind: 'funding', ...publicStatus('funding') },
  ];
}
function discoveryOverview() {
  const now = Date.now(); const all = boards();
  const tiers = { '1 min': 0, '2 min': 0, '3 min': 0, '10 min': 0, '15 min': 0, '30 min': 0, '60 min': 0, 'backing off': 0 };
  const name = ms => ms === 60e3 ? '1 min' : ms === 120e3 ? '2 min' : ms === 180e3 ? '3 min' : ms === 600e3 ? '10 min' : ms === 900e3 ? '15 min' : ms === 1800e3 ? '30 min' : ms === 3600e3 ? '60 min' : 'backing off';
  const byProvider = {}; const byVia = {};
  for (const b of all) { tiers[name(boardInterval(b, now))]++; byProvider[b.provider] = (byProvider[b.provider] || 0) + 1; byVia[b.via || 'other'] = (byVia[b.via || 'other'] || 0) + 1; }
  const top = all.filter(b => b.newCount).sort((a, b) => b.newCount - a.newCount).slice(0, 12).map(b => ({ company: b.company, provider: b.provider, newCount: b.newCount, lastNewAt: b.lastNewAt }));
  const yieldRows = allSources().map(s => { const st = S.sourceStatus[s.id] || {}; return { id: s.id, name: s.name, seen: st.seen || 0, unique: st.unique || 0, dynamic: !!s.dynamic }; });
  return { boards: all.length, tiers, byProvider, byVia, top, log: S.discoveryLog.slice(0, 60), lists: S.dynamicSources, yield: yieldRows, listsStatus: S.sourceStatus.lists || null, nextListSearch: nextAt.lists || null, sourceCount: allSources().length + 1 };
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
  if (m === 'GET' && p === '/api/jobs') {
    const body = JSON.stringify({ jobs: S.jobs.map(slim), now: Date.now() });
    if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      const gz = await new Promise((ok, bad) => zlib.gzip(body, { level: 6 }, (e, b) => e ? bad(e) : ok(b)));
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-encoding': 'gzip', 'cache-control': 'no-store' }); return res.end(gz);
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); return res.end(body);
  }
  if (m === 'GET' && p.startsWith('/api/job/')) { const j = store.byId.get(decodeURIComponent(p.slice(9))); return j ? json(res, 200, view(j)) : json(res, 404, { error: 'Not found' }); }
  if (m === 'GET' && p === '/api/meta') {
    const { ntfyToken, ...settings } = S.settings;
    return json(res, 200, { profiles: S.profiles.map(p => ({ id: p.id, label: p.label, active: p.id === S.activeProfile })), settings: { ...settings, hasToken: !!ntfyToken }, filterSets: S.filterSets, tracking: S.tracking, blockedCompanies: S.blockedCompanies, sources: sourcesMeta(), watch: S.watch, alerts: S.alerts.slice(0, 50), funding: S.funding.slice(0, 300), stats: { jobs: S.jobs.length, companies: Object.keys(S.companies).length, boards: boards().length, funded: Object.values(S.companies).filter(c => fundingInfo(c)).length } });
  }
  if (m === 'GET' && p === '/api/signals') return json(res, 200, { companies: signals() });
  if (m === 'GET' && p === '/api/discovery') return json(res, 200, discoveryOverview());
  if (m === 'GET' && p.startsWith('/api/contacts/')) {
    const j = store.byId.get(decodeURIComponent(p.slice(14))); if (!j) return json(res, 404, { error: 'Not found' });
    return json(res, 200, await contactsFor(j, url.searchParams.get('refresh') === '1'));
  }
  if (m === 'POST' && p === '/api/scan') { scanAllRequested = true; nextAt.ats = 0; nextAt.funding = 0; return json(res, 200, { ok: true }); }
  if (m === 'POST' && p === '/api/filter-sets') {
    const b = await body(req); const name = String(b.name || '').trim().slice(0, 60);
    if (!name) return json(res, 400, { error: 'Give the filter set a name.' });
    const existing = S.filterSets.find(f => f.id === b.id);
    const channel = String('channel' in b ? b.channel || '' : existing?.channel || '').trim().slice(0, 200);
    if (channel) { try { resolveChannel(S.settings, channel); } catch (e) { return json(res, 400, { error: e.message }); } }
    const rec = { id: existing?.id || `fs-${Date.now().toString(36)}`, name, alert: !!b.alert, channel, filters: b.filters || {} };
    if (existing) Object.assign(existing, rec); else S.filterSets.push(rec);
    store.touch(); await store.save(); return json(res, 200, rec);
  }
  if (m === 'DELETE' && p.startsWith('/api/filter-sets/')) { const id = decodeURIComponent(p.slice(17)); S.filterSets = S.filterSets.filter(f => f.id !== id); store.touch(); return json(res, 200, { ok: true }); }
  if (m === 'POST' && p === '/api/track') {
    const b = await body(req); if (!store.byId.has(b.id)) return json(res, 404, { error: 'Unknown job' });
    const prev = S.tracking[b.id] || {};
    const next = { status: 'status' in b ? (b.status === 'hidden' ? prev.status || '' : b.status || '') : prev.status || '', hidden: 'hidden' in b ? !!b.hidden : b.status === 'hidden' ? true : !!prev.hidden, note: 'note' in b ? String(b.note || '').slice(0, 2000) : prev.note || '', at: new Date().toISOString() };
    if (!next.status && !next.hidden && !next.note) delete S.tracking[b.id]; else S.tracking[b.id] = next;
    store.touch(); return json(res, 200, S.tracking[b.id] || null);
  }
  if (m === 'POST' && p === '/api/block') {
    const b = await body(req); const name = String(b.company || '').trim(); if (!name) return json(res, 400, { error: 'company required' });
    S.blockedCompanies = S.blockedCompanies.filter(c => c.toLowerCase() !== name.toLowerCase());
    if (b.block !== false) S.blockedCompanies.push(name);
    store.touch(); return json(res, 200, { blockedCompanies: S.blockedCompanies });
  }
  if (m === 'POST' && p === '/api/settings') {
    const b = await body(req); const s = S.settings;
    for (const k of ['ntfyServer', 'ntfyTopic', 'quietHours']) if (k in b) s[k] = String(b[k] || '').trim();
    if ('ntfyToken' in b && b.ntfyToken !== '••••') s.ntfyToken = String(b.ntfyToken || '').trim();
    if ('desktopNotify' in b) s.desktopNotify = !!b.desktopNotify;
    if (Array.isArray(b.linkedinSearches)) { s.linkedinSearches = b.linkedinSearches.map(x => ({ keywords: String(x?.keywords || '').trim().slice(0, 80), location: String(x?.location || '').trim().slice(0, 80), remote: !!x?.remote })).filter(x => x.keywords).slice(0, 12); nextAt.linkedin = 0; }
    if (b.profile) s.profile = cleanProfile(b.profile, s.profile);
    store.touch(); await store.save(); return json(res, 200, { ok: true });
  }
  if (m === 'POST' && p === '/api/resume') {
    // Read a résumé on this computer and hand back what was found. Nothing is saved until the profile is.
    try {
      const raw = await rawBody(req); const file = str(url.searchParams.get('name'), 120);
      const text = /json/.test(req.headers['content-type'] || '') ? str(JSON.parse(raw.toString('utf8') || '{}').text, 60000) : resumeText(raw, file);
      if (text.replace(/\s/g, '').length < 80) return json(res, 400, { error: 'There is not enough text there to read a résumé from.' });
      return json(res, 200, { file, parsed: parseResume(text) });
    } catch (e) { return json(res, 400, { error: e.message || 'That file could not be read.' }); }
  }
  if (m === 'POST' && p === '/api/profiles') {
    const b = await body(req); const label = str(b.label, 40);
    if (b.action === 'create') {
      if (!label) return json(res, 400, { error: 'Give the profile a name.' });
      if (S.profiles.length >= 12) return json(res, 400, { error: 'Twelve profiles is the limit.' });
      const id = `p-${Date.now().toString(36)}`;
      S.profiles.push({ id, label, profile: blankProfile(), filterSets: JSON.parse(JSON.stringify(DEFAULT_FILTER_SETS)).map(f => ({ ...f, alert: false })), tracking: {}, blockedCompanies: [] });
      switchProfile(id);
    } else if (b.action === 'switch') { if (!switchProfile(String(b.id))) return json(res, 404, { error: 'No such profile.' }); }
    else if (b.action === 'rename') { const t = S.profiles.find(x => x.id === b.id); if (!t || !label) return json(res, 400, { error: 'Give the profile a name.' }); t.label = label; }
    else if (b.action === 'delete') {
      if (S.profiles.length < 2) return json(res, 400, { error: 'This is the only profile.' });
      const id = String(b.id); if (!S.profiles.some(x => x.id === id)) return json(res, 404, { error: 'No such profile.' });
      if (id === S.activeProfile) switchProfile(S.profiles.find(x => x.id !== id).id);
      S.profiles = S.profiles.filter(x => x.id !== id);
    } else return json(res, 400, { error: 'Unknown action.' });
    store.touch(); await store.save();
    return json(res, 200, { profiles: S.profiles.map(x => ({ id: x.id, label: x.label, active: x.id === S.activeProfile })) });
  }
  if (m === 'POST' && p === '/api/test-push') {
    const b = await body(req).catch(() => ({}));
    try { const r = await testPush(S.settings, String(b?.channel || ''), String(b?.name || '').slice(0, 60)); return json(res, r.skipped ? 400 : 200, r.skipped ? { error: 'Set an ntfy topic first.' } : r); } catch (e) { return json(res, /topic|address|link/.test(e.message) ? 400 : 502, { error: e.message }); }
  }
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
