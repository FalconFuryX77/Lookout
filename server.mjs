// Lookout — local, near-real-time startup job scanner.
// Polls job sources + company ATS boards on short intervals, links funding news to companies,
// deduplicates across sources, and pushes matches to your phone via ntfy.
import http from 'node:http';
import os from 'node:os';
import crypto from 'node:crypto';
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
import { DEFAULT_LINKEDIN_SEARCHES, LINKEDIN_ALERT_MAX_MIN, checkPosting, linkedinId } from './src/linkedin.mjs';
import { resumeText, parseResume } from './src/resume.mjs';
import { matches, effectiveTime, fundStageOf, normCo, mentionsIn, fit, overReach } from './public/filters.mjs';
import { enrich } from './src/enrich.mjs';
import { normCompany } from './src/dedupe.mjs';
import { assessListing } from './src/doubt.mjs';
import { diffListing } from './src/listing.mjs';
import { findNiches, recordNicheDays } from './src/niches.mjs';
import { addComputingWords, isComputingRole } from './src/taxonomy.mjs';
import { fetchBoardList, fetchVocab, latestRelease, newer, REPO } from './src/updates.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { namedEmployer, sameRole, boardSlugs, linkRank, bestLink, isShortLink, followRedirects, REPOSTER } from './src/root.mjs';
import { pool, domainOf, canonicalUrl, exportHttpValidators, importHttpValidators, clearHttpValidators } from './src/util.mjs';
import { scanLinks, sortLinks } from './src/scan.mjs';
import { githubTarget as githubTargetOf } from './src/github.mjs';
import { weighSkills } from './src/evidence.mjs';
import { findBrowsers, pickBrowser } from './src/browser.mjs';
import { extractSkills, skillInfo } from './public/skills.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// "Only roles mentioning" and "Hide roles mentioning" read the whole posting, which only the scanner has.
const fullText = j => `${j.title} ${j.company} ${j.location || ''} ${j.specialty || ''} ${(j.skills || []).map(x => x.name || x).join(' ')} ${j.description || ''}`;
const fullMention = (j, t) => mentionsIn(fullText(j), t);
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = process.env.LOOKOUT_DATA || path.join(ROOT, 'data');
const APP_VERSION = (() => { try { return JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return '0'; } })();
// Words that mark computing work beyond the built-in ones: the copy shipped with the app, and the newer one from
// GitHub (data/vocab.json). Read before the roles are, so a new niche is recognised from the first moment.
function loadVocab() {
  const words = [];
  for (const f of [path.join(ROOT, 'starter', 'vocab.json'), path.join(DATA_DIR, 'vocab.json')]) { try { const v = JSON.parse(readFileSync(f, 'utf8')); if (v?.lookout === 'vocab') words.push(...(v.computingTitleWords || [])); } catch { } }
  addComputingWords([...new Set(words)]); return words.length;
}
loadVocab();
const store = new Store(DATA_DIR);
await store.load();
store.prune(); // before the first page load: roles past their time, or outside the fields kept, never show
const S = store.state;
const catchUpUntil = store.repaired ? Date.now() + 30 * 60e3 : 0;
store.state.settings.appUrl = `http://127.0.0.1:${PORT}`;
S.settings.linkedinSearches ||= DEFAULT_LINKEDIN_SEARCHES;
S.settings.discover ??= true;          // find new boards and lists on its own
S.settings.pace ||= 'auto';            // auto | saver | slow
S.settings.offSources ||= [];          // sources switched off by hand
S.settings.browser ||= 'auto';         // which installed browser reads JavaScript-heavy pages: auto | none | an id | a path
S.settings.githubToken ||= '';         // optional: lifts GitHub's 60-requests-an-hour limit for "Scan my links"
// ---------------------------------------------------------------- who may talk to the scanner
// Lookout listens on this computer, so any web page open in your browser can try to reach it. Three rules:
//  1. The request must be addressed to this computer by address (localhost / an IP), never by a domain
//     name. That stops "DNS rebinding", where a website points its own domain at 127.0.0.1 to read your data.
//  2. Changes must come from Lookout's own pages. A request another website's page sends is refused.
//  3. Other devices (a phone on your Wi-Fi) and the browser extension need a key. Keys are made here and
//     shown in Settings; they never leave this computer except where you paste them.
S.settings.extKey ||= crypto.randomBytes(18).toString('base64url');    // pairs the browser extension
S.settings.deviceKey ||= crypto.randomBytes(18).toString('base64url'); // opens Lookout on your other devices
const IP_LITERAL = /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:.]+\])$/i;
const isLoopbackHost = h => ['127.0.0.1', 'localhost', '[::1]'].includes(h);
const isLoopbackAddr = a => /^(?:::ffff:)?127\.|^::1$/.test(a || '');
const hostOf = req => String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
const cookieKey = req => (String(req.headers.cookie || '').match(/(?:^|;\s*)lk_key=([\w-]+)/) || [])[1] || '';
const bearer = req => (String(req.headers.authorization || '').match(/^Bearer\s+([\w-]+)$/i) || [])[1] || '';
const sameKey = (a, b) => !!a && !!b && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
/** null when the request may go ahead, otherwise [status, message]. */
function guard(req, p, url) {
  const host = hostOf(req);
  if (!isLoopbackHost(host) && !(HOST !== '127.0.0.1' && IP_LITERAL.test(host))) return [403, 'Open Lookout at http://127.0.0.1:' + PORT];
  const ext = p.startsWith('/api/ext/');
  if (ext) { // the browser extension: its own origin, its own key, its own few endpoints
    if (p === '/api/ext/hello') return null;
    return sameKey(bearer(req), S.settings.extKey) ? null : [401, 'The extension is not paired with this Lookout. Paste the pairing key from Lookout → Settings → Browser extension.'];
  }
  if (!isLoopbackAddr(req.socket.remoteAddress)) { // another device on your network
    const k = cookieKey(req) || bearer(req) || url.searchParams.get('key') || '';
    if (!sameKey(k, S.settings.deviceKey)) return [401, 'This Lookout only opens on other devices with its link. Open Settings → Other devices on the computer running Lookout.'];
  }
  if (!['GET', 'HEAD'].includes(req.method)) {
    const origin = req.headers.origin; const site = req.headers['sec-fetch-site'];
    if (origin ? origin !== `http://${req.headers.host}` : site === 'cross-site') return [403, 'Refused: this request came from another website.'];
  }
  return null;
}
const lanAddresses = () => Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
// How often to check, by level. Auto keeps the adaptive 1-60 minute ladder; the others stretch that same
// ladder so the busiest boards are checked at the level's fastest pace and the quietest at its slowest.
const PACE = { saver: [30 * 60e3, 2 * 36e5], slow: [6 * 36e5, 24 * 36e5] };
function paced(ms) {
  const p = PACE[S.settings.pace]; if (!p) return ms;
  const t = Math.min(1, Math.max(0, Math.log(ms / 60e3) / Math.log(60)));   // 1 min .. 60 min -> 0 .. 1
  return Math.max(ms > 36e5 ? ms : 0, Math.round(p[0] * Math.pow(p[1] / p[0], t)));
}
const TIER_MS = { '1 min': 60e3, '2 min': 120e3, '3 min': 180e3, '10 min': 600e3, '15 min': 900e3, '30 min': 1800e3, '60 min': 3600e3, 'backing off': 6 * 36e5 };
const fmtDur = ms => ms < 36e5 ? `${Math.round(ms / 6e4)} min` : ms >= 6 * 36e5 || ms % 36e5 === 0 ? `${Math.round(ms / 36e5)} h` : `${(ms / 36e5).toFixed(1)} h`;
S.boards ||= {}; S.dynamicSources ||= []; S.discoveryLog ||= []; S.blockedCompanies ||= [];
S.discoveryLog = S.discoveryLog.filter(l => l.text !== '0 boards and 0 lists').map(l => { // 2.4.1 logged imports that added nothing, and "and 0 lists"
  const m = l.kind === 'source' && /^(\d+) boards and (\d+) lists$/.exec(l.text || ''); if (!m) return l;
  const [b, n] = [Number(m[1]), Number(m[2])];
  return { ...l, text: [b && `${b.toLocaleString('en-US')} board${b === 1 ? '' : 's'}`, n && `${n} list${n === 1 ? '' : 's'}`].filter(Boolean).join(' and ') };
});
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
  const out = {
    name: str(b.name, 80), pitch: str(b.pitch, 1500), link: str(b.link, 300),
    skills: [...new Map(list(b.skills, 120, 40).map(s => [s.toLowerCase(), s])).values()],
    headline: str(pick('headline'), 120), email: str(pick('email'), 120), phone: str(pick('phone'), 40),
    links: list(pick('links'), 8, 300), education: list(pick('education'), 8, 220), experience: list(pick('experience'), 14, 220),
    yearsExp: num(pick('yearsExp'), 0, 50), degree: str(pick('degree'), 20), gradYear: num(pick('gradYear'), 1970, 2100),
    projects: list(pick('projects'), 12, 260), strictFit: pick('strictFit') !== false, manualSkills: list(pick('manualSkills'), 120, 40),
    resume: pick('resume') && typeof pick('resume') === 'object' ? { file: str(pick('resume').file, 120), at: str(pick('resume').at, 30), chars: Number(pick('resume').chars) || 0 } : null,
    // your links, and where each skill came from (so a scan can tell what your work shows from what you listed)
    github: str(pick('github'), 200), linkedin: str(pick('linkedin'), 200), portfolio: str(pick('portfolio'), 300), otherLinks: list(pick('otherLinks'), 12, 300),
    rescan: pick('rescan') === true, resumeSkills: list(pick('resumeSkills'), 150, 40), linkedinSkills: list(pick('linkedinSkills'), 100, 40),
    acceptedSkills: list(pick('acceptedSkills'), 150, 40), ignoredSkills: list(pick('ignoredSkills'), 300, 40),
    pageSkills: (Array.isArray(pick('pageSkills')) ? pick('pageSkills') : []).slice(0, 200).map(x => ({ name: str(x?.name, 40), site: str(x?.site, 60), url: str(x?.url, 300), at: str(x?.at, 30) })).filter(x => x.name),
    linkedinPdf: pick('linkedinPdf') && typeof pick('linkedinPdf') === 'object' ? { file: str(pick('linkedinPdf').file, 120), at: str(pick('linkedinPdf').at, 30) } : null,
    scan: prev.scan || null, // written only by "Scan my links"
  };
  // profiles saved before the separate link boxes: sort the old single link (and the résumé's links) into them
  if (!out.github && !out.linkedin && !out.portfolio && !out.otherLinks.length && !('github' in b)) {
    const s = sortLinks([out.link, ...out.links]); Object.assign(out, { github: s.github, linkedin: s.linkedin, portfolio: s.portfolio, otherLinks: s.other.slice(0, 12) });
  }
  out.link ||= out.portfolio || out.github || out.linkedin || out.otherLinks[0] || ''; // the one link outreach drafts use
  return Object.assign(out, weighSkills(out));
}
/** The profile as the app sees it: the scan's per-repository detail stays on the server. */
function publicProfile(p) {
  if (!p) return p; const sc = p.scan;
  return { ...p, scan: sc ? { at: sc.at, browser: sc.browser, notes: sc.notes, foundLinks: sc.foundLinks, github: sc.github ? { user: sc.github.user, repos: sc.github.repos.length, profile: sc.github.profile, rateLeft: sc.github.rateLeft, rateReset: sc.github.rateReset } : null, pages: sc.sites?.pages || [] } : null };
}
const blankProfile = () => cleanProfile({});
function alertScopes() {
  const scope = (filterSets, tracking, blocked, label, profile) => ({ filterSets: filterSets || [], ctx: { tracking: tracking || {}, blocked: new Set((blocked || []).map(normCo)), profile, mentions: fullMention }, label });
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
// ---------------------------------------------------------------- "Scan my links"
const scanState = { running: false, profileId: null, progress: null, startedAt: null, error: null, finishedAt: null };
const publicScanState = () => ({ running: scanState.running, profileId: scanState.profileId, progress: scanState.progress, startedAt: scanState.startedAt, finishedAt: scanState.finishedAt, error: scanState.error });
const profileById = id => id === S.activeProfile ? S.settings.profile : S.profiles.find(x => x.id === id)?.profile;
async function runScan(id, { quiet = false } = {}) {
  const prof = profileById(id); if (!prof || scanState.running) return;
  Object.assign(scanState, { running: true, profileId: id, progress: { step: 'start', done: 0, total: 1 }, startedAt: new Date().toISOString(), error: null });
  broadcast('scan', publicScanState());
  try {
    const result = await scanLinks(prof, { token: S.settings.githubToken, browserChoice: S.settings.browser, log, onProgress: pr => { scanState.progress = pr; broadcast('scan', publicScanState()); } });
    // the profile may have been switched or edited meanwhile: store on whichever object holds it now
    const now = profileById(id); if (!now) return;
    // a read that failed this time (GitHub's hourly limit, a site that was down) keeps what the last good scan found
    const old = now.scan;
    if (old?.github?.repos?.length && !result.github?.repos?.length && githubTargetOf(now.github)?.user?.toLowerCase() === old.github.user?.toLowerCase()) {
      result.github = old.github; result.notes.push(`Kept the GitHub results from ${new Date(old.at).toLocaleDateString()}.`);
    }
    if (old?.sites?.evidence?.length && result.sites && !result.sites.pages.some(x => x.ok)) { result.sites = old.sites; result.notes.push('Kept what your site showed last time.'); }
    const next = cleanProfile({ ...now, scan: undefined }, { ...now, scan: result });
    if (id === S.activeProfile) S.settings.profile = next; else S.profiles.find(x => x.id === id).profile = next;
    const gh = result.github; log(`scan: ${gh ? `${gh.repos.length} repos` : 'no GitHub'}, ${result.sites?.pages.filter(x => x.ok).length || 0} pages${result.browser ? ` (${result.browser})` : ''}; ${next.suggestions.length} suggestions${quiet ? ' (weekly)' : ''}`);
    store.touch(); await store.save();
  } catch (e) { scanState.error = e.message; log('scan error', e.message); }
  finally { Object.assign(scanState, { running: false, progress: null, finishedAt: new Date().toISOString() }); broadcast('scan', publicScanState()); }
}
// weekly re-scan for profiles that asked for it, one at a time
setInterval(async () => {
  if (scanState.running) return;
  for (const pr of [{ id: S.activeProfile, profile: S.settings.profile }, ...S.profiles.filter(x => x.id !== S.activeProfile)]) {
    const p = pr.profile; if (!p?.rescan || !(p.github || p.portfolio || p.otherLinks?.length)) continue;
    if (p.scan?.at && Date.now() - Date.parse(p.scan.at) < 7 * 864e5) continue;
    await runScan(pr.id, { quiet: true }); return;
  }
}, 30 * 60e3);
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
// The window's list, one cached JSON row per role, rebuilt only when the role or its company changes, so the whole
// list (tens of thousands of roles) can be handed over without redoing every row each time.
const slimRows = new Map();
function slimJson(j) {
  const c = store.company(j.company);
  const k = `${j.title}|${(j.sources || []).length}|${j.applyUrl}|${j.doubt?.level}|${j.closedAt}|${j.cs}|${(j.emails || []).length}|${(j.skills || []).length}|${j.postedAt}|${j.specialty}|${j.middleman ? 1 : 0}|${(c?.funding || []).length}|${c?.ycRecent}|${c?.contacts?.emails?.length}|${c?.teamSize}|${c?.website}|${c?.domain}|${(j.description || '').length}`;
  const hit = slimRows.get(j.id); if (hit && hit.k === k) return hit.s;
  const s = JSON.stringify(slim(j)); slimRows.set(j.id, { k, s }); return s;
}
setInterval(() => { if (slimRows.size > S.jobs.length * 1.3 + 500) { const ids = new Set(S.jobs.map(j => j.id)); for (const id of slimRows.keys()) if (!ids.has(id)) slimRows.delete(id); } }, 10 * 60e3);
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
  broadcast('jobs', { added: newJobs.map(slim), quiet: !!bootstrapping }); // a board read for the first time: its roles are not news
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

// Reading a big board for the first time means hundreds of postings to sort; every 40 the scanner lets the
// window's requests through, so the app stays responsive while thousands of new boards are read.
async function ingestAll(sourceId, postings, backfill = false) {
  const fresh = [], setAside = []; let k = 0;
  for (const p of postings) {
    if (++k % 40 === 0) await new Promise(r => setImmediate(r));
    if (!p.title || !p.url || !p.company) continue;
    const { job, isNew, removedId } = store.ingest({ ...p, source: sourceId, backfill: backfill && !p.postedAt });
    if (removedId) setAside.push(removedId);
    if (!job) continue; // too old or previously pruned
    if (!isNew && !backfill) continue; // known posting; nothing new to learn from its links
    if (p.companyMeta?.yc) store.upsertCompany(job.company, { yc: p.companyMeta.yc, ycSlug: p.companyMeta.ycSlug, ycRecent: true });
    if (p.companyUrl && !NOT_COMPANY_SITES.test(p.companyUrl)) { const c = store.company(job.company); if (!c?.website) store.upsertCompany(job.company, { website: p.companyUrl }); }
    for (const h of harvestBoards(`${p.url} ${p.applyUrl || ''} ${sourceId === 'hn-hiring' ? p.description || '' : ''}`)) {
      if (sourceId === 'ats') break; // a board's own links point back to itself
      addBoard(h.provider, h.board, job.company, srcLabel(sourceId));
      const c = store.company(job.company); if (c && !c.ats) { c.ats = h; c.atsVia = 'harvest'; c.atsCheckedAt = new Date().toISOString(); }
    }
    if (isNew) { assess(job); fresh.push(job); }
  }
  if (setAside.length) broadcast('jobs', { added: [], removed: setAside }); // their full posting showed another field
  return fresh;
}

// ---------------------------------------------------------------- listings that may not be real
// Signs a listing may not be a real opening (src/doubt.mjs). Counts change as roles come and go, so every
// role is looked at again every few minutes; new ones are looked at as they arrive, before any alert.
function assess(job) {
  const d = assessListing(job);
  const before = JSON.stringify(job.doubt || null), after = JSON.stringify(d || null);
  if (before === after) return false;
  if (d) job.doubt = d; else delete job.doubt;
  return true;
}
function assessAll() { let changed = 0; for (const j of S.jobs) if (assess(j)) changed++; if (changed) { store.touch(); log(`doubt: ${changed} role(s) relabelled`); } }
assessAll(); setInterval(assessAll, 10 * 60e3); // before the first page load, so nothing doubtful slips into the list

// ---------------------------------------------------------------- niches
// A small diary of which kinds of computing work were hired for each day (src/niches.mjs), so rising niches can
// be told apart from ones that were always there, long after the roles themselves are pruned.
let nicheCache = null;
function noteNiches() { S.nicheDays = recordNicheDays(S.jobs, S.nicheDays || {}); nicheCache = null; store.touch(); }
setTimeout(noteNiches, 60e3); setInterval(noteNiches, 60 * 60e3);

// ---------------------------------------------------------------- updates from GitHub (src/updates.mjs)
// Once a day: new boards from the project's board list (when finding new boards is on), new vocabulary, and
// whether a newer version of the app has been released. Only the project's public files are read.
let updating = false;
async function checkUpdates(byHand = false) {
  if (updating) return; updating = true;
  const st = S.updates ||= {}; st.checkedAt = new Date().toISOString(); st.error = '';
  try {
    if (S.settings.autoUpdateList !== false && S.settings.discover !== false) {
      try {
        const list = await fetchBoardList();
        if (list && list.exported !== st.listExported) { const r = importSources(list, 'starter list'); st.listExported = list.exported; st.listAdded = r.added; st.listAt = st.checkedAt; if (r.added) log(`updates: ${r.added} new boards from the board list on GitHub`); }
      } catch (e) { if (!e.notModified) st.error = `Board list: ${e.message}`; }
      try {
        const v = await fetchVocab();
        if (v) { writeFileSync(path.join(DATA_DIR, 'vocab.json'), JSON.stringify(v)); loadVocab(); st.vocabVersion = v.version; for (const j of S.jobs) j.cs = isComputingRole(j); nicheCache = null; }
      } catch (e) { if (!e.notModified) st.error = st.error || `Vocabulary: ${e.message}`; }
    }
    try { const r = await latestRelease(); st.latest = r?.version || st.latest; st.release = r && newer(r.version, APP_VERSION) ? r : null; }
    catch (e) { if (byHand) st.error = st.error || `Checking for a new version: ${e.message}`; }
  } finally { updating = false; store.touch(); broadcast('status', { id: 'updates' }); }
}
function publicUpdates() { const u = S.updates || {}; return { version: APP_VERSION, latest: u.latest || null, release: u.release ? { version: u.release.version, name: u.release.name, url: u.release.url, notes: u.release.notes, publishedAt: u.release.publishedAt } : null, checkedAt: u.checkedAt || null, listAt: u.listAt || null, listAdded: u.listAdded || 0, vocabVersion: u.vocabVersion || null, error: u.error || '', auto: S.settings.autoUpdateList !== false, repo: REPO }; }
setTimeout(checkUpdates, 90e3); setInterval(checkUpdates, 24 * 36e5);
// The board list that comes with this version is added on its own (when finding new boards is on), once per list,
// so an update brings its new boards without a click. A board you removed by hand only comes back with a newer list.
async function addShippedList() {
  if (S.settings.discover === false || S.settings.autoUpdateList === false) return;
  try {
    const f = JSON.parse(await fs.readFile(STARTER_FILE, 'utf8')); const st = S.updates ||= {};
    if (!f.exported || st.shippedList === f.exported) return;
    const r = importSources(f, 'starter list'); st.shippedList = f.exported; store.touch();
    if (r.added) log(`starter: ${r.added} new boards from the list that came with this version`);
  } catch (e) { log('starter: could not read the board list that came with this version:', e.message); }
}
setTimeout(addShippedList, 5e3);
function niches() { if (!nicheCache || Date.now() - nicheCache.at > 10 * 60e3) nicheCache = { at: Date.now(), data: findNiches(S.jobs, S.nicheDays || {}) }; return nicheCache.data; }

// ---------------------------------------------------------------- roles their employer took down
// Boards that hand over every open role at once: a role missing from one of them has been taken down.
// (Workday and Oracle are read a page at a time, so a missing role there says nothing.)
const FULL_LIST = new Set(['greenhouse', 'lever', 'ashby', 'workable', 'recruitee', 'yc']);
function noteListing(b, posts, out) {
  const urls = posts ? new Set(posts.map(p => p.url && canonicalUrl(p.url)).filter(Boolean)) : null;
  const { present, close } = diffListing(b, urls);
  for (const u of present) { // a role in someone's pipeline that was marked closed is listed again
    const id = store.dedupe.byUrl.get(u); const j = id && store.byId.get(id);
    if (j?.closedAt && store.reopen(j)) out.updated.push(j);
  }
  for (const u of close) {
    const id = store.dedupe.byUrl.get(u); const j = id && store.byId.get(id); if (!j) continue;
    const r = store.closeJob(j, 'employer');
    if (r === 'removed') out.removed.push(j.id); else if (r === 'marked') out.updated.push(j);
  }
}
function announceClosed({ removed, updated }, label, by = 'employer') {
  if (!removed.length && !updated.length) return;
  broadcast('jobs', { added: [], removed, updated: updated.map(slim), closedBy: by });
  log(`${label}: ${removed.length} role(s) ${by === 'list' ? 'marked closed by the list' : by === 'linkedin' ? 'no longer taking applications on LinkedIn' : 'taken down by their employer'} removed${updated.length ? `, ${updated.length} in a pipeline marked closed or reopened` : ''}`);
  S.closedCount = (S.closedCount || 0) + removed.length;
}

// ---------------------------------------------------------------- LinkedIn roles that stop taking applications
// A role found only on LinkedIn has no careers board to watch, so its LinkedIn posting is looked at again: a few
// each pass, the ones in a pipeline first and then the longest unchecked, and straight away when someone opens it.
const LI_RECHECK = 12 * 36e5, LI_OPENED_RECHECK = 30 * 60e3;
const onlyLinkedIn = j => j.sources?.length && j.sources.every(s => s.source === 'linkedin');
const liCursor = () => (S.sourceStatus.linkedin ||= { cursor: {}, runs: 0 }).cursor ||= {};
const liChecked = () => liCursor().checkedAt ||= {};
function linkedinDue(n) {
  const seen = liChecked(); const now = Date.now(); const due = [];
  for (const j of S.jobs) {
    if (j.closedAt || !onlyLinkedIn(j)) continue;
    const id = linkedinId(j.url); if (!id) continue;
    const last = seen[id] || Date.parse(j.firstSeen) || 0;
    if (now - last < LI_RECHECK) continue;
    due.push([store.tracked(j.id) ? last - 30 * 864e5 : last, j.url]);
  }
  return due.sort((a, b) => a[0] - b[0]).slice(0, n).map(x => x[1]);
}
function noteLinkedInChecked(urls) {
  const seen = liChecked(); const now = Date.now();
  for (const u of urls) { const id = linkedinId(u); if (id) seen[id] = now; }
  const keys = Object.keys(seen);
  if (keys.length > 4000) { const live = new Set(S.jobs.filter(onlyLinkedIn).map(j => linkedinId(j.url))); for (const k of keys) if (!live.has(k)) delete seen[k]; }
}
/** Someone opened a LinkedIn-only role: if it has not been looked at in the last half hour, look now. */
async function checkLinkedInNow(j) {
  if (j.closedAt || !onlyLinkedIn(j)) return null;
  const id = linkedinId(j.url); const seen = liChecked();
  if (!id || Date.now() - (seen[id] || 0) < LI_OPENED_RECHECK) return null;
  const open = await checkPosting(id, liCursor());
  if (open === null) return null;
  seen[id] = Date.now();
  if (open) return null;
  const out = { removed: [], updated: [] }; const r = store.closeJob(j, 'linkedin');
  if (r === 'removed') out.removed.push(j.id); else if (r === 'marked') out.updated.push(j); else return null;
  announceClosed(out, 'linkedin', 'linkedin');
  return { closedAt: j.closedAt || new Date().toISOString(), closedBy: 'linkedin' };
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
    try { postings = await src.run({ cursor: st.cursor ||= {}, settings: S.settings, known: u => { const c = canonicalUrl(u); return store.dedupe.byUrl.has(c) || store.gone.has(c) || store.offScope.has(c); }, due: linkedinDue }); }
    catch (e) { if (!e.notModified) throw e; postings = []; } // feed unchanged since last check
    const fresh = await directLinks(await resolveRoots(await ingestAll(src.id, postings, bootstrapping)));
    // A list marking a role closed is believed only when Lookout has no employer board of its own to check;
    // LinkedIn saying a posting stopped taking applications, only for roles found on LinkedIn alone.
    if (postings.checked?.length) noteLinkedInChecked(postings.checked);
    if (postings.closed?.length) {
      const out = { removed: [], updated: [] }; const by = postings.closedBy || 'list';
      for (const u of postings.closed) {
        const id = store.dedupe.byUrl.get(canonicalUrl(u)); const j = id && store.byId.get(id);
        if (!j || (by === 'linkedin' ? !onlyLinkedIn(j) : j.sources.some(s => s.source === 'ats'))) continue;
        const r = store.closeJob(j, by); if (r === 'removed') out.removed.push(j.id); else if (r === 'marked') out.updated.push(j);
      }
      announceClosed(out, src.id, by);
    }
    Object.assign(st, { ok: true, at: new Date().toISOString(), ms: Date.now() - started, fetched: postings.length, added: fresh.length, error: '' });
    if (postings.length) { st.dataRuns = (st.dataRuns || 0) + 1; st.seen = (st.seen || 0) + postings.length; st.unique = (st.unique || 0) + fresh.length; }
    if (src.dynamic) { const d = S.dynamicSources.find(x => x.id === src.id); if (d && !d.imported && st.dataRuns >= 2 && !st.unique) { d.disabled = true; (S.rejectedRepos ||= []).push(d.repo.toLowerCase()); S.discoveryLog.unshift({ at: new Date().toISOString(), kind: 'retired', text: d.name, via: 'no unique jobs' }); log(`retired ${d.name}: everything it lists is already covered`); } }
    st.runs = (st.runs || 0) + 1; st.totalAdded = (st.totalAdded || 0) + fresh.length;
    if (fresh.length) log(`${src.id}: +${fresh.length} new (${postings.length} fetched)`);
    await handleNew(fresh, bootstrapping);
  } catch (e) {
    Object.assign(st, { ok: false, at: new Date().toISOString(), ms: Date.now() - started, error: String(e.message || e).slice(0, 200) });
    log(`${src.id}: ${st.error}`);
  } finally {
    running.delete(src.id); nextAt[src.id] = Date.now() + paced(src.every * 1000); store.touch();
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
  // With discovery off, only boards you chose (watched, imported, the starter list) are ever added.
  if (S.settings.discover === false && !force && !/^(you|imported|starter list)/.test(via || '')) return S.boards[bkey(provider, board)] || null;
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
  const started = Date.now(); let backlogged = false; // set below when more boards are due than one round takes
  try {
    syncBoards();
    const now = Date.now();
    // Most overdue relative to its own interval first, so slow tiers aren't starved by fast ones.
    const due = boards().map(b => { const iv = paced(boardInterval(b, now)); return { b, ratio: (now - Date.parse(b.lastPolled || 0)) / iv }; }).filter(x => x.ratio >= 1)
      .sort((x, y) => y.ratio - x.ratio); const batch = Math.max(50, Math.min(240, Math.ceil(boards().length / 40)));
    // A board read for the first time brings all its roles at once; at most 12 of those per round, so thousands of
    // newly added boards are taken in over an hour or two in the background instead of burying the computer.
    { let first = 0; for (let i = 0; i < due.length; i++) if (!due[i].b.polledOnce && ++first > 12) { due.splice(i, 1); i--; backlogged = true; } }
    backlogged = backlogged || due.length > batch; due.splice(batch); for (let i = 0; i < due.length; i++) due[i] = due[i].b;
    let fetched = 0, added = 0, errors = 0; const closed = { removed: [], updated: [] };
    await pool(due, 16, async b => {
      b.lastPolled = new Date().toISOString();
      try {
        const posts = await fetchBoard({ provider: b.provider, board: b.board, company: b.company !== b.board ? b.company : undefined, state: b.cursor ||= {}, known: u => { const c = canonicalUrl(u); return store.dedupe.byUrl.has(c) || store.gone.has(c) || store.offScope.has(c); } }); fetched += posts.length;
        const firstTime = !b.polledOnce; b.polledOnce = true; b.errors = 0; b.openRoles = posts.length;
        const fresh = await ingestAll('ats', posts, firstTime); added += fresh.length;
        if (FULL_LIST.has(b.provider) || posts.complete) noteListing(b, posts, closed);
        if (fresh.length && !firstTime) { b.lastNewAt = new Date().toISOString(); b.newCount += fresh.length; }
        if (firstTime && posts.length) b.lastNewAt = posts.map(p => p.postedAt).filter(Boolean).sort().pop() || null;
        await handleNew(fresh, firstTime);
      } catch (e) {
        if (e.notModified) { b.errors = 0; if (b.missing && Object.keys(b.missing).length) noteListing(b, null, closed); return; } // board unchanged since last poll: only overdue removals to settle
        errors++; b.errors = (b.errors || 0) + 1; b.lastError = e.message;
        if (e.status === 404 && b.errors >= 3 && !b.watched) { delete S.boards[b.key]; const c = Object.values(S.companies).find(x => x.ats && bkey(x.ats.provider, x.ats.board) === b.key); if (c) c.ats = null; }
      }
    });
    announceClosed(closed, 'ats');
    Object.assign(st, { ok: true, at: new Date().toISOString(), ms: Date.now() - started, fetched, added, boards: boards().length, polled: due.length, error: errors ? `${errors} board(s) failed this round` : '' });
    st.runs++; st.totalAdded = (st.totalAdded || 0) + added;
    if (added) log(`ats: +${added} new from ${due.length} boards`);
  } finally { running.delete('ats'); nextAt.ats = Date.now() + (backlogged ? 2e3 : 15e3); store.touch(); broadcast('status', { id: 'ats', ...publicStatus('ats') }); }
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
      } catch (e) { if (!e.notModified) errs.push(`${feed.name}: ${e.message}`); } // "nothing new since last time" is not a failure
    });
    if (!st.cursor.ycAt || Date.now() - st.cursor.ycAt > 6 * 36e5) {
      const yc = await fetchRecentYc();
      for (const c of yc) store.upsertCompany(c.name, { website: c.website, yc: c.batch, ycSlug: c.slug, ycRecent: true, ycUrl: c.url, oneLiner: c.oneLiner, isHiring: c.isHiring, teamSize: c.teamSize, industry: c.industry });
      try { const hiring = await fetchYcHiring(); for (const c of hiring) { const co = store.upsertCompany(c.name, { website: c.website, yc: c.batch, ycSlug: c.slug, ycUrl: c.url, oneLiner: c.oneLiner, isHiring: true, teamSize: c.teamSize, industry: c.industry }); if (co && !co.ats) co.ats = { provider: 'yc', board: c.slug }; } st.ycHiring = hiring.length; } catch (e) { errs.push(`YC hiring: ${e.message}`); }
      st.cursor.ycAt = Date.now(); st.ycCompanies = yc.length;
    }
    S.funding.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
    // A feed or two failing is normal (sites go down); only all of them failing is an error.
    Object.assign(st, { ok: errs.length < FUNDING_FEEDS.length || added > 0, at: new Date().toISOString(), added, error: errs.join(' · ').slice(0, 300) });
    st.runs++;
    if (added) { log(`funding: +${added} rounds`); broadcast('funding', { added }); }
  } finally { running.delete('funding'); nextAt.funding = Date.now() + paced(5 * 60e3); store.touch(); }
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
  const off = new Set(S.settings.offSources);
  for (const src of allSources()) if (!off.has(src.id) && !running.has(src.id) && (scanAllRequested || Date.now() >= (nextAt[src.id] || 0))) runSource(src);
  if (scanAllRequested) { for (const b of boards()) if (boardInterval(b) <= 600e3) b.lastPolled = null; }
  scanAllRequested = false;
  if (Date.now() >= (nextAt.ats || 0)) runBoards();
  if (Date.now() >= (nextAt.funding || 0)) runFunding();
  if (Date.now() >= (nextAt.discovery || 0)) runDiscovery();
  if (S.settings.discover !== false && Date.now() >= (nextAt.lists || 0)) runListDiscovery();
  runContactQueue();
}
// stagger first runs so startup doesn't hammer everything at once
JOB_SOURCES.forEach((s, i) => { nextAt[s.id] = Date.now() + i * 1500; });
nextAt.ats = Date.now() + 20e3; nextAt.discovery = Date.now() + 30e3; nextAt.lists = S.dynamicSources.some(d => !d.disabled && d.validated !== 2) ? Date.now() + 60e3 : S.sourceStatus.lists?.at ? Date.parse(S.sourceStatus.lists.at) + 6 * 36e5 : Date.now() + 90e3;
// ---------------------------------------------------------------- sharing sources
// A sources file is plain JSON anyone can read, edit and send:
//   { "lookout": "sources", "version": 1, "name": "...", "boards": [{ "platform", "board", "company" }],
//     "lists": [{ "repo": "owner/name", "name", "url" }] }
// Boards are company careers boards; lists are community job lists on GitHub.
const BUILTIN_LISTS = () => JOB_SOURCES.filter(s => /^https:\/\/github\.com\/[^/]+\/[^/]+/.test(s.home || ''));
const repoOf = home => String(home || '').replace(/^https:\/\/github\.com\//, '').split('/').slice(0, 2).join('/');
const RAW_GH = /^https:\/\/raw\.githubusercontent\.com\/[\w.-]+\/[\w.-]+\/[\w./%-]+$/;
const BOARD_OK = /^[A-Za-z0-9_.%/-]{2,200}$/;
function exportSources({ scope = 'all', name = 'My Lookout sources' } = {}) {
  const off = new Set(S.settings.offSources);
  let list = boards().filter(b => !(b.errors >= 3));
  let builtins = BUILTIN_LISTS().filter(s => !off.has(s.id)), dyn = S.dynamicSources.filter(d => !d.disabled);
  if (scope === 'useful') {
    // useful = produced a role that matches one of your saved views, or that you saved, applied to or noted
    const ctx = { tracking: S.tracking, blocked: new Set(S.blockedCompanies.map(normCo)), mentions: fullMention }; const keep = new Set();
    for (const j of S.jobs) {
      if (!S.tracking[j.id] && !S.filterSets.some(fs => matches(view(j), fs.filters, ctx))) continue;
      const k = boardByCo.get(normCompany(j.company)); if (k) keep.add(k);
    }
    list = list.filter(b => b.watched || keep.has(b.key));
    const yielded = id => (S.sourceStatus[id]?.unique || 0) > 0;
    builtins = builtins.filter(s => yielded(s.id)); dyn = dyn.filter(d => yielded(d.id));
  }
  return {
    lookout: 'sources', version: 1, name: String(name).slice(0, 80), exported: new Date().toISOString(),
    boards: list.map(b => ({ platform: b.provider, board: b.board, company: b.company })).sort((a, b) => a.company.localeCompare(b.company)),
    lists: [...builtins.map(s => ({ repo: repoOf(s.home), name: s.name })), ...dyn.map(d => ({ repo: d.repo, name: d.name, url: d.url }))],
  };
}
function importSources(text, label) {
  let f; try { f = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new Error('That file is not a Lookout sources file (it is not valid JSON).'); }
  if (!f || f.lookout !== 'sources' || !Array.isArray(f.boards || [])) throw new Error('That file is not a Lookout sources file.');
  const name = String(label || f.name || 'imported list').replace(/\s+/g, ' ').trim().slice(0, 60) || 'imported list';
  const via = name === 'starter list' ? 'starter list' : `imported: ${name}`;
  let added = 0, had = 0, skipped = 0, lists = 0;
  for (const x of (f.boards || []).slice(0, 500000)) {
    const provider = String(x?.platform || x?.provider || ''), board = String(x?.board || '').trim();
    if (!ATS_PROVIDERS.includes(provider) || !BOARD_OK.test(board)) { skipped++; continue; }
    const k = bkey(provider, board); if (S.boards[k]) { had++; continue; }
    const b = addBoard(provider, board, String(x.company || board).slice(0, 120), via);
    if (b && b.key === k) added++; else if (b) had++; else skipped++;
  }
  const off = new Set(S.settings.offSources);
  for (const l of (f.lists || []).slice(0, 200)) {
    const repo = String(l?.repo || ''); if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) continue;
    const builtin = BUILTIN_LISTS().find(s => repoOf(s.home).toLowerCase() === repo.toLowerCase());
    if (builtin) { if (off.delete(builtin.id)) lists++; continue; }
    const id = `gh:${repo.toLowerCase()}`; const cur = S.dynamicSources.find(d => d.id === id);
    if (cur) { if (cur.disabled) { cur.disabled = false; cur.imported = true; lists++; } continue; }
    if (!RAW_GH.test(String(l.url || ''))) continue; // lists are only ever read from GitHub
    S.dynamicSources.push({ id, repo, name: String(l.name || `${repo} (GitHub)`).slice(0, 80), url: l.url, home: `https://github.com/${repo}`, rows: 0, stars: 0, addedAt: new Date().toISOString(), every: 300, runs: 0, unique: 0, disabled: false, validated: 2, imported: true });
    S.rejectedRepos = (S.rejectedRepos || []).filter(r => r !== repo.toLowerCase()); lists++;
  }
  S.settings.offSources = [...off];
  const what = [added && `${added.toLocaleString('en-US')} board${added === 1 ? '' : 's'}`, lists && `${lists} list${lists === 1 ? '' : 's'}`].filter(Boolean).join(' and ');
  if (what) S.discoveryLog.unshift({ at: new Date().toISOString(), kind: 'source', text: what, via: name }); // nothing new: nothing to tell
  store.touch(); nextAt.ats = 0;
  return { name, added, had, skipped, lists };
}
function resetSources({ stopDiscovery = true } = {}) {
  let removed = 0;
  for (const b of boards()) if (!b.watched) { delete S.boards[b.key]; removed++; }
  boardByCo.clear(); for (const b of boards()) boardByCo.set(normCompany(b.company), b.key);
  const lists = S.dynamicSources.filter(d => !d.disabled).length + BUILTIN_LISTS().filter(s => !S.settings.offSources.includes(s.id)).length;
  S.dynamicSources = [];
  S.settings.offSources = [...new Set([...S.settings.offSources, ...BUILTIN_LISTS().map(s => s.id)])];
  if (stopDiscovery) S.settings.discover = false;
  S.discoveryLog.unshift({ at: new Date().toISOString(), kind: 'retired', text: `${removed} boards and ${lists} lists`, via: 'removed by you' });
  store.touch();
  return { removed, lists, kept: boards().length };
}
const STARTER_FILE = path.join(ROOT, 'starter', 'sources.json');
async function starterInfo() {
  try {
    const f = JSON.parse(await fs.readFile(STARTER_FILE, 'utf8'));
    const have = f.boards.filter(x => S.boards[bkey(x.platform, x.board)]).length;
    return { boards: f.boards.length, lists: (f.lists || []).length, have };
  } catch { return null; }
}
async function sourcesInfo() {
  const off = new Set(S.settings.offSources);
  return { boards: boards().length, lists: S.dynamicSources.filter(d => !d.disabled).length + BUILTIN_LISTS().filter(s => !off.has(s.id)).length, starter: await starterInfo() };
}
// One-time: boards on the newly supported platforms are already referenced by roles on file.
if (S.platformHarvest !== 1 && S.settings.discover !== false) {
  let n = 0; for (const j of S.jobs) for (const u of j.urls || [j.url]) for (const h of harvestBoards(u || '')) if ((h.provider === 'workday' || h.provider === 'oracle') && !S.boards[bkey(h.provider, h.board)] && addBoard(h.provider, h.board, j.company, 'followed link')) n++;
  if (n) log(`boards: found ${n} Oracle and Workday career sites in roles already on file`);
  S.platformHarvest = 1; store.touch();
}

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
      rootJob = theirs.find(x => linkRank(x.applyUrl || x.url, x.company) >= linkRank(j.applyUrl || j.url, j.company) && sameRole(j, x)) || null;
      // Only for known re-posters: look for the employer's own board, and accept it only if this very role is on it.
      if (!rootJob && probe && reposter && !boardByCo.has(ck) && Date.now() - Date.parse(S.rootProbes[ck] || 0) > 7 * 864e5) {
        S.rootProbes[ck] = new Date().toISOString();
        search: for (const provider of ['ashby', 'greenhouse', 'lever', 'workable']) for (const slug of boardSlugs(named.name)) {
          let posts; try { posts = await fetchBoard({ provider, board: slug, company: named.name }); } catch { continue; }
          const hit = posts.find(p => sameRole(j, p)); if (!hit) continue;
          const b2 = addBoard(provider, slug, named.name, 'named in a re-post'); if (b2) { b2.polledOnce = true; b2.lastPolled = new Date().toISOString(); b2.openRoles = posts.length; }
          await ingestAll('ats', posts, true);
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
// ---------------------------------------------------------------- direct links
// Community lists often hand out short links (go.vansh.nyc/…) that forward to the employer's own page.
// Follow each one once, keep the real address, and let Apply open it. If that address is already on file
// under another record, the two are the same role and become one.
S.redirects ||= {}; // short link -> [final address or '', when checked]
const shortQueue = []; let shortBusy = false;
const hasShort = j => (j.urls || [j.url]).some(u => u && isShortLink(u));
async function resolveShort(j) {
  let changed = false;
  for (const u of [...(j.urls || [j.url])]) {
    if (!u || !isShortLink(u)) continue;
    const key = canonicalUrl(u); let hit = S.redirects[key];
    if (!hit || (!hit[0] && Date.now() - Date.parse(hit[1]) > 864e5)) { hit = S.redirects[key] = [(await followRedirects(u)) || '', new Date().toISOString()]; store.touch(); await new Promise(r => setTimeout(r, 250)); }
    const final = hit[0]; if (!final || (j.urls || []).includes(final)) continue;
    const other = store.byId.get(store.dedupe.byUrl.get(canonicalUrl(final)));
    if (other && other !== j && store.byId.has(j.id)) { store.fold(other, j, { repost: false }); log(`direct: "${j.title}" at ${j.company} was already on file; merged`); return other; }
    store.dedupe.unindex(j); j.urls = [...new Set([...(j.urls || [j.url]), final])]; store.dedupe.index(j); changed = true;
    for (const h of harvestBoards(final)) addBoard(h.provider, h.board, j.company, 'followed link');
  }
  if (changed) { const best = bestLink(j.urls, j.company); if (best && linkRank(best, j.company) > linkRank(j.applyUrl || j.url, j.company)) j.applyUrl = best; store.touch(); }
  return j;
}
/** New roles: resolve the first few right away so their alerts carry the real link; queue the rest. */
async function directLinks(fresh) {
  const out = []; let inline = 0;
  for (const j of fresh) {
    if (!hasShort(j)) { out.push(j); continue; }
    if (inline++ >= 40) { shortQueue.push(j.id); out.push(j); continue; }
    let r = j; try { r = await resolveShort(j); } catch { }
    if (r === j) out.push(j); // folded into a role already on file: not new
  }
  return out;
}
setInterval(async () => {
  if (shortBusy || !shortQueue.length) return; shortBusy = true;
  try { for (let n = 0; n < 20 && shortQueue.length; n++) { const j = store.byId.get(shortQueue.shift()); if (j) await resolveShort(j).catch(() => { }); } }
  finally { shortBusy = false; }
}, 5000);
// Roles stored before this existed
setTimeout(() => { for (const j of S.jobs) if (hasShort(j) && !(j.urls || []).some(u => !isShortLink(u) && linkRank(u, j.company) === 3)) shortQueue.push(j.id); if (shortQueue.length) log(`direct: following ${shortQueue.length} short links in the background`); }, 20000);
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
async function body(req, limit = 2e6) { let s = ''; for await (const c of req) { s += c; if (s.length > limit) throw new Error('Request too large'); } return s ? JSON.parse(s) : {}; }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

function sourcesMeta() {
  return [
    ...allSources().map(s => ({ id: s.id, name: s.name, every: Math.round(paced(s.every * 1000) / 1000), home: s.home, trust: s.trust, kind: 'jobs', dynamic: !!s.dynamic, off: S.settings.offSources.includes(s.id), ...publicStatus(s.id) })),
    { id: 'ats', name: 'Company career pages (ATS)', every: 30, home: '', trust: 'Direct from each company’s own Greenhouse / Lever / Ashby / Workable / SmartRecruiters / Recruitee / YC / Oracle / Workday board, polled more often when it is busy (see Settings → Sources for the pace)', kind: 'jobs', ...publicStatus('ats') },
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
  return { boards: all.length, tiers, byProvider, byVia, top, log: S.discoveryLog.slice(0, 60), lists: S.dynamicSources, yield: yieldRows, listsStatus: S.sourceStatus.lists || null, nextListSearch: nextAt.lists || null, sourceCount: allSources().length + 1, pace: S.settings.pace, tierLabels: S.settings.pace === 'auto' ? null : Object.fromEntries(Object.entries(TIER_MS).map(([k, ms]) => [k, k === 'backing off' ? k : fmtDur(paced(ms))])) };
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
  const denied = guard(req, p, url);
  if (denied) {
    if ((req.headers.accept || '').includes('text/html')) { res.writeHead(denied[0], { 'content-type': 'text/html; charset=utf-8' }); return res.end(`<!doctype html><meta charset="utf-8"><title>Lookout</title><body style="font:16px system-ui;padding:40px;max-width:560px">${denied[1]}</body>`); }
    return json(res, denied[0], { error: denied[1] });
  }
  // a phone opening its link: remember the key in a cookie, then show the app
  if (m === 'GET' && url.searchParams.get('key') && !isLoopbackAddr(req.socket.remoteAddress)) {
    res.writeHead(302, { 'set-cookie': `lk_key=${S.settings.deviceKey}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`, location: '/' }); return res.end();
  }
  if (m === 'GET' && p === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write('retry: 3000\n\n'); sse.add(res); req.on('close', () => sse.delete(res)); return;
  }
  if (m === 'GET' && p === '/api/jobs') {
    const body = `{"jobs":[${S.jobs.map(slimJson).join(',')}],"now":${Date.now()}}`;
    if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      const gz = await new Promise((ok, bad) => zlib.gzip(body, { level: 1 }, (e, b) => e ? bad(e) : ok(b)));
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-encoding': 'gzip', 'cache-control': 'no-store' }); return res.end(gz);
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); return res.end(body);
  }
  if (m === 'GET' && p.startsWith('/api/job/')) {
    const j = store.byId.get(decodeURIComponent(p.slice(9))); if (!j) return json(res, 404, { error: 'Not found' });
    const closed = await checkLinkedInNow(j).catch(() => null); // a LinkedIn-only role is looked at as it is opened
    return json(res, 200, closed ? { ...view(j), ...closed } : view(j));
  }
  if (m === 'GET' && p === '/api/meta') {
    const { ntfyToken, extKey, deviceKey, githubToken, ...settings } = S.settings;
    return json(res, 200, { sourceInfo: await sourcesInfo(), profiles: S.profiles.map(p => ({ id: p.id, label: p.label, active: p.id === S.activeProfile })), settings: { ...settings, profile: publicProfile(settings.profile), hasToken: !!ntfyToken, hasGithubToken: !!githubToken }, scanState: publicScanState(), updates: publicUpdates(), learn: S.settings.learn !== false, filterSets: S.filterSets, tracking: S.tracking, blockedCompanies: S.blockedCompanies, sources: sourcesMeta(), watch: S.watch, alerts: S.alerts.slice(0, 50), funding: S.funding.slice(0, 300), stats: { jobs: S.jobs.length, companies: Object.keys(S.companies).length, boards: boards().length, funded: Object.values(S.companies).filter(c => fundingInfo(c)).length } });
  }
  if (m === 'GET' && p === '/api/signals') return json(res, 200, { companies: signals() });
  if (m === 'GET' && p === '/api/niches') return json(res, 200, niches());
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
    if ('discover' in b) s.discover = !!b.discover;
    if ('autoUpdateList' in b) s.autoUpdateList = !!b.autoUpdateList;
    if (['computing', 'all'].includes(b.scope) && b.scope !== s.scope) { // which fields Lookout keeps
      s.scope = b.scope; const dropped = store.applyScope();
      if (b.scope === 'all') { S.httpValidators = {}; clearHttpValidators(); for (const bd of boards()) { delete bd.listed; delete bd.missing; } } // read everything again, in full
      for (const k of Object.keys(nextAt)) if (k !== 'lists') nextAt[k] = 0;
      if (dropped) broadcast('jobs', { added: [], removed: [], resync: true });
      log(`scope: keeping ${b.scope === 'all' ? 'every field' : 'computer-science roles'}${dropped ? `; ${dropped} roles in other fields set aside` : ''}`);
    }
    if (['auto', 'saver', 'slow'].includes(b.pace) && b.pace !== s.pace) { s.pace = b.pace; for (const k of Object.keys(nextAt)) if (k !== 'lists') nextAt[k] = Math.min(nextAt[k] || 0, Date.now() + paced(60e3)); }
    if (Array.isArray(b.linkedinSearches)) { s.linkedinSearches = b.linkedinSearches.map(x => ({ keywords: String(x?.keywords || '').trim().slice(0, 80), location: String(x?.location || '').trim().slice(0, 80), remote: !!x?.remote })).filter(x => x.keywords).slice(0, 12); nextAt.linkedin = 0; }
    if (b.profile) s.profile = cleanProfile(b.profile, s.profile);
    if ('browser' in b) s.browser = str(b.browser, 400) || 'auto';
    if ('githubToken' in b && b.githubToken !== '••••') s.githubToken = str(b.githubToken, 200);
    if ('learn' in b) s.learn = !!b.learn;
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
  if (m === 'POST' && p === '/api/profile/scan') {
    if (scanState.running) return json(res, 409, { error: 'A scan is already running.' });
    const prof = S.settings.profile || {};
    if (!prof.github && !prof.portfolio && !(prof.otherLinks || []).length) return json(res, 400, { error: 'Add your GitHub, your site or another link first, and save.' });
    runScan(S.activeProfile).catch(e => log('scan failed', e.message));
    return json(res, 200, { started: true });
  }
  if (m === 'GET' && p === '/api/profile/scan') return json(res, 200, publicScanState());
  if (m === 'POST' && p === '/api/profile/skills') {
    // accept or ignore suggested skills, or bring ignored ones back
    const b = await body(req); const prof = S.settings.profile || {};
    const names = v => (Array.isArray(v) ? v : []).map(x => str(x, 40)).filter(Boolean);
    const low = s => s.toLowerCase(); const acc = names(b.accept), ign = names(b.ignore), un = new Set(names(b.unignore).map(low));
    const next = { ...prof,
      skills: [...new Map([...(prof.skills || []), ...acc].map(x => [low(x), x])).values()],
      acceptedSkills: [...new Set([...(prof.acceptedSkills || []), ...acc])],
      ignoredSkills: [...new Set([...(prof.ignoredSkills || []), ...ign])].filter(x => !un.has(low(x))) };
    S.settings.profile = cleanProfile(next, prof); store.touch(); await store.save();
    return json(res, 200, { profile: publicProfile(S.settings.profile) });
  }
  if (m === 'GET' && p === '/api/browsers') {
    const list = await findBrowsers({ again: url.searchParams.get('again') === '1' }); const chosen = await pickBrowser(S.settings.browser);
    return json(res, 200, { browsers: list.map(b => ({ id: b.id, name: b.name, engine: b.engine, path: b.path, isDefault: b.isDefault, usable: b.usable, auto: b.auto })), choice: S.settings.browser, using: chosen ? { id: chosen.id, name: chosen.name, path: chosen.path } : null });
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
  if (m === 'GET' && p === '/api/access') {
    // keys are only ever shown on this computer
    if (!isLoopbackAddr(req.socket.remoteAddress)) return json(res, 403, { error: 'Only on the computer running Lookout.' });
    const lan = HOST !== '127.0.0.1' && HOST !== 'localhost';
    return json(res, 200, { extKey: S.settings.extKey, extSeen: S.settings.extSeen || null, extFolder: path.join(ROOT, 'extension'), lan, deviceLinks: lan ? lanAddresses().map(a => `http://${a}:${PORT}/?key=${S.settings.deviceKey}`) : [] });
  }
  if (m === 'POST' && p === '/api/access/rotate') {
    if (!isLoopbackAddr(req.socket.remoteAddress)) return json(res, 403, { error: 'Only on the computer running Lookout.' });
    const b = await body(req); if (b.which === 'device') S.settings.deviceKey = crypto.randomBytes(18).toString('base64url'); else S.settings.extKey = crypto.randomBytes(18).toString('base64url');
    store.touch(); await store.save(); return json(res, 200, { ok: true });
  }
  if (p.startsWith('/api/ext/')) {
    const paired = sameKey(bearer(req), S.settings.extKey);
    if (paired) { S.settings.extSeen = new Date().toISOString(); store.touch(); }
    const prof = S.settings.profile || {}; const label = S.profiles.find(x => x.id === S.activeProfile)?.label || 'Me';
    const you = { label, name: prof.name || '', skills: prof.skills || [], strength: prof.strength || {}, yearsExp: prof.yearsExp ?? null, strictFit: prof.strictFit !== false };
    if (m === 'GET' && p === '/api/ext/hello') return json(res, 200, { app: 'lookout', paired, ...(paired ? { profile: you, port: PORT } : {}) });
    // the page the extension read, shaped like any other posting
    const posting = b => {
      const pg = b?.page || {}; const s = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
      const url = s(pg.url, 600);
      if (!/^https?:\/\//i.test(url)) throw new Error('The page has no web address.');
      return { title: s(pg.title, 200) || 'Untitled role', company: s(pg.company, 120) || (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Unknown'; } })(), url, applyUrl: s(pg.applyUrl, 600) || '', location: s(pg.location, 200), typeHint: s(pg.employmentType, 60), levelHint: s(pg.seniority, 60), description: String(pg.description || '').slice(0, 30000), postedAt: toIsoDate(pg.datePosted), precision: 'date', source: 'browser' };
    };
    const toIsoDate = v => { const t = Date.parse(v || ''); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
    if (m === 'POST' && p === '/api/ext/compare') {
      let raw; try { raw = posting(await body(req)); } catch (e) { return json(res, 400, { error: e.message }); }
      const e = enrich(raw); const ft = fit(e, prof);
      const hitId = store.dedupe.match(e, id => store.byId.get(id)); const hit = hitId && store.byId.get(hitId);
      return json(res, 200, {
        profile: you,
        role: { title: e.title, company: e.company, type: e.type, level: e.level, yearsMin: e.yearsMin ?? null, yearsMax: e.yearsMax ?? null, visa: e.visa, workMode: e.workMode, country: e.country, skills: e.skills.map(x => x.name) },
        fit: { have: ft.have, missing: ft.missing, general: ft.general, genHave: ft.genHave, expGap: ft.expGap, pct: ft.pct }, overReach: overReach(e, prof),
        onFile: hit ? { id: hit.id, title: hit.title, sources: hit.sources.map(x => x.source === 'ats' ? 'the company’s careers site' : x.source === 'browser' ? 'your browser' : srcLabel(x.source)), postedAt: hit.postedAt, firstSeen: hit.firstSeen, applyUrl: hit.applyUrl || hit.url, applyKind: ['copy', 'site', 'near', 'direct'][Math.max(0, linkRank(hit.applyUrl || hit.url, hit.company))], status: S.tracking[hit.id]?.status || '' } : null,
        board: detectInText(raw.url) || null,
      });
    }
    if (m === 'POST' && p === '/api/ext/save') {
      let raw; try { raw = posting(await body(req)); } catch (e) { return json(res, 400, { error: e.message }); }
      const { job, isNew } = store.ingest(raw, { keep: true }); // saved by you: kept however old, and never pruned while it is in your pipeline
      if (!job) return json(res, 400, { error: 'That role is too old to keep, or was removed from Lookout earlier.' });
      S.tracking[job.id] = { ...(S.tracking[job.id] || {}), status: S.tracking[job.id]?.status || 'saved', hidden: false, note: S.tracking[job.id]?.note || '', at: new Date().toISOString() };
      if (isNew) broadcast('jobs', { added: [slim(job)] });
      store.touch(); await store.save();
      return json(res, 200, { id: job.id, isNew, status: S.tracking[job.id].status, open: `http://127.0.0.1:${PORT}/#job:${job.id}` });
    }
    if (m === 'POST' && p === '/api/ext/watch') {
      const b = await body(req); const target = detectInText(String(b.url || ''));
      if (!target || !ATS_PROVIDERS.includes(target.provider)) return json(res, 400, { error: 'This page is not on a careers system Lookout can read.' });
      if (S.watch.some(w => w.provider === target.provider && w.board.toLowerCase() === target.board.toLowerCase())) return json(res, 200, { already: true });
      try { await fetchBoard(target); } catch (e) { return json(res, 400, { error: `That careers site did not answer (${e.message}).` }); }
      const w = { id: Date.now().toString(36), name: String(b.company || target.board).slice(0, 80), ...target, addedAt: new Date().toISOString() };
      S.watch.unshift(w); store.touch(); nextAt.ats = 0; return json(res, 200, w);
    }
    if (m === 'POST' && p === '/api/ext/profile-page') {
      // a profile page you are looking at (GitHub, Hugging Face, Stack Overflow...): which skills it shows, and which are new to you
      const b = await body(req); const pg = b?.page || {}; const url = str(pg.url, 600);
      const mine = new Set((prof.skills || []).map(n => skillInfo(n).canonical.toLowerCase()));
      const found = new Map();
      for (const s of [...extractSkills((Array.isArray(pg.tags) ? pg.tags : []).map(t => str(t, 60)).join('\n'), ''), ...extractSkills(String(pg.text || '').slice(0, 60000), str(pg.title, 200))]) if (skillInfo(s.name).tech && !found.has(s.name)) found.set(s.name, { name: s.name, have: mine.has(s.name.toLowerCase()) });
      const same = u => String(u || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/$/, '');
      const linked = [prof.github, prof.portfolio, ...(prof.otherLinks || [])].some(l => l && same(l) === same(url));
      return json(res, 200, { skills: [...found.values()].slice(0, 60), linked });
    }
    if (m === 'POST' && p === '/api/ext/profile-add') {
      const b = await body(req); const url = str(b.url, 600); const site = str(b.site, 60) || 'profile';
      if (!/^https:\/\//i.test(url)) return json(res, 400, { error: 'That page has no web address.' });
      const names = (Array.isArray(b.skills) ? b.skills : []).map(x => skillInfo(str(x, 40)).canonical).filter(Boolean).slice(0, 60);
      const have = new Set((prof.skills || []).map(n => n.toLowerCase())); const fresh = names.filter(n => !have.has(n.toLowerCase()));
      const at = new Date().toISOString(); const next = { ...prof, skills: [...(prof.skills || []), ...fresh], pageSkills: [...(prof.pageSkills || []), ...fresh.map(name => ({ name, site, url, at }))] };
      let linkSaved = false;
      if (b.saveLink) { const same = u => String(u || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''); if (![prof.github, prof.portfolio, prof.linkedin, ...(prof.otherLinks || [])].some(l => l && same(l) === same(url))) { if (/^https:\/\/github\.com\/[^/]+\/?$/i.test(url) && !prof.github) next.github = url; else next.otherLinks = [...(prof.otherLinks || []), url].slice(0, 12); linkSaved = true; } }
      S.settings.profile = cleanProfile(next, prof); store.touch(); await store.save(); broadcast('profile', { changed: true });
      const np = S.settings.profile;
      return json(res, 200, { added: fresh.length, linkSaved, profile: { label, name: np.name || '', skills: np.skills || [], strength: np.strength || {}, yearsExp: np.yearsExp ?? null, strictFit: np.strictFit !== false } });
    }
    return json(res, 404, { error: 'Unknown extension request.' });
  }
  if (m === 'POST' && p === '/api/mentions') {
    // Which roles mention each word anywhere in the posting. The app asks once per word, then only for roles it hasn't asked about.
    const b = await body(req).catch(() => ({}));
    const terms = [...new Set((Array.isArray(b.terms) ? b.terms : []).map(t => String(t).toLowerCase().trim()).filter(t => t && t.length <= 60))].slice(0, 30);
    const only = Array.isArray(b.ids) ? b.ids.map(id => store.byId.get(String(id))).filter(Boolean) : S.jobs;
    const out = {}; for (const t of terms) out[t] = [];
    for (const j of only) { const text = fullText(j); for (const t of terms) if (mentionsIn(text, t)) out[t].push(j.id); }
    return json(res, 200, { terms: out, ids: only.map(j => j.id) });
  }
  // Everything in one file: a consistent copy of the database, to keep or to move to another computer.
  if (m === 'GET' && p === '/api/backup') {
    const file = path.join(os.tmpdir(), `lookout-backup-${process.pid}.db`);
    try {
      await store.backup(file);
      const name = `lookout-backup-${new Date().toISOString().slice(0, 10)}${store.db ? '.db' : '.json'}`;
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${name}"`, 'content-length': (await fs.stat(file)).size, 'cache-control': 'no-store' });
      const { createReadStream } = await import('node:fs');
      return createReadStream(file).on('close', () => fs.rm(file, { force: true }).catch(() => { })).pipe(res);
    } catch (e) { return json(res, 500, { error: e.message }); }
  }
  if (m === 'POST' && p === '/api/updates/check') { await checkUpdates(true); return json(res, 200, publicUpdates()); }
  if (m === 'GET' && p === '/api/storage') return json(res, 200, { kind: store.db ? 'sqlite' : 'json', file: store.db ? path.join(store.dir, 'lookout.db') : path.join(store.dir, 'db.json'), roles: S.jobs.length, boards: boards().length });
  if (m === 'GET' && p === '/api/sources/export') {
    const f = exportSources({ scope: url.searchParams.get('scope') === 'useful' ? 'useful' : 'all', name: url.searchParams.get('name') || undefined });
    return json(res, 200, f);
  }
  if (m === 'POST' && p === '/api/sources/import') {
    try { const b = await body(req, 200e6); const r = importSources(b.text, b.name); await store.save(); return json(res, 200, { ...r, info: await sourcesInfo() }); }
    catch (e) { return json(res, 400, { error: e.message }); }
  }
  if (m === 'POST' && p === '/api/sources/starter') {
    try { const r = importSources(await fs.readFile(STARTER_FILE, 'utf8'), 'starter list'); await store.save(); return json(res, 200, { ...r, info: await sourcesInfo() }); }
    catch (e) { return json(res, 400, { error: e.code === 'ENOENT' ? 'The starter list is missing from this copy of Lookout.' : e.message }); }
  }
  if (m === 'POST' && p === '/api/sources/reset') {
    const b = await body(req); const r = resetSources({ stopDiscovery: b.stopDiscovery !== false }); await store.save();
    return json(res, 200, { ...r, info: await sourcesInfo() });
  }
  if (m === 'POST' && p === '/api/sources/toggle') {
    const b = await body(req); const id = String(b.id || '');
    if (!allSources().some(s => s.id === id)) return json(res, 404, { error: 'No such source.' });
    const off = new Set(S.settings.offSources); b.on ? off.delete(id) : off.add(id); S.settings.offSources = [...off];
    if (b.on) nextAt[id] = 0; store.touch(); return json(res, 200, { off: S.settings.offSources });
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
    if (!target || !ATS_PROVIDERS.includes(target.provider)) return json(res, 400, { error: 'Could not find a Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, Oracle or Workday (myworkdaysite.com) board at that address.' });
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
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await store.close().catch(() => { }); process.exit(0); });
