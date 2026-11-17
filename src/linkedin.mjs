// LinkedIn's public job search: the same pages anyone sees logged out. No account, no cookies.
//
// Speed matters most here (an early application counts for a lot), so every pass asks only for
// roles posted in the last few hours and reads the newest first. LinkedIn's "newest first" order is
// loose over a wide window (a week of results comes back shuffled), which is why a narrow window is
// the only way to see a role soon after it goes up. A slower sweep of the last day fills in whatever
// was posted while this computer was off.
import { getText, htmlToText, decodeEntities, sleep } from './util.mjs';

export const DEFAULT_LINKEDIN_SEARCHES = [
  { keywords: 'software engineer intern', location: 'India' },
  { keywords: 'machine learning intern', location: 'India' },
  { keywords: 'software intern', location: 'Worldwide', remote: true },
  { keywords: 'new grad software engineer', location: 'India' },
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const HEAD = { 'user-agent': UA, accept: 'text/html' };
const MAX_SEARCHES = 12, MAX_DETAILS = 30, PAUSE = 700;
const FRESH = { window: 'r10800', pages: 3 };   // every pass: the last 3 hours
const SWEEP = { window: 'r86400', pages: 4 };   // every SWEEP_EVERY passes: the last day
const SWEEP_EVERY = 8;
const RECHECK_PER_PASS = 4;                     // stored roles looked at again each pass (about 60 an hour)
const BACKOFF_MS = 20 * 60e3;                   // after LinkedIn says "slow down"
/** Roles older than this when found are stored but not pushed to the phone. */
export const LINKEDIN_ALERT_MAX_MIN = 125;

const text = s => decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
export const linkedinUrl = id => `https://www.linkedin.com/jobs/view/${id}`;

/** "33 minutes ago" -> 33, "2 hours ago" -> 120. Null when the card only gives days or weeks. */
export function agoMinutes(s) {
  const m = String(s || '').toLowerCase().match(/(\d+)\s*(second|minute|hour)s?\s+ago/);
  if (/just now/i.test(s || '')) return 0;
  if (!m) return null;
  return m[2] === 'second' ? 0 : m[2] === 'minute' ? Number(m[1]) : Number(m[1]) * 60;
}

/** Parse one page of search results into cards. */
export function parseCards(html) {
  const out = [];
  for (const li of html.split(/<li>/).slice(1)) {
    const id = li.match(/urn:li:jobPosting:(\d+)/)?.[1]; if (!id) continue;
    const title = text(li.match(/base-search-card__title[^>]*>([\s\S]*?)<\/h3>/)?.[1]);
    const company = text(li.match(/base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/)?.[1]);
    const companyPage = (li.match(/href="(https:\/\/[a-z.]*linkedin\.com\/company\/[^"?]+)/)?.[1] || '');
    const location = text(li.match(/job-search-card__location[^>]*>([\s\S]*?)<\/span>/)?.[1]);
    const time = li.match(/<time[^>]*datetime="(\d{4}-\d{2}-\d{2})"[^>]*>([\s\S]*?)<\/time>/);
    if (title && company) out.push({ id, title, company, companyPage, location, date: time?.[1] || '', ago: agoMinutes(text(time?.[2])) });
  }
  return out;
}
/**
 * Is the posting still taking applications? While it is, the public page's top card holds Apply and Save. When
 * the employer stops it ("No longer accepting applications" for signed-in visitors), the card stays and both
 * buttons go. true = open, false = closed, null = the page is not the one expected (no top card at all).
 */
export function pageOpen(html) {
  if (!/top-card-layout__cta-container/.test(html)) return null;
  return /top-card-layout__cta(?![\w-])|apply-button|public_jobs_apply-link|topcard-save-job/.test(html);
}
/** Parse a posting page: description plus the "Seniority level / Employment type" block. */
export function parseDetail(html) {
  const description = htmlToText(html.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/)?.[1] || '');
  const criteria = {};
  for (const m of html.matchAll(/job-criteria-subheader[^>]*>([\s\S]*?)<\/h3>\s*<span[^>]*>([\s\S]*?)<\/span>/g)) criteria[text(m[1]).toLowerCase()] = text(m[2]);
  return { description, seniority: criteria['seniority level'] || '', employment: criteria['employment type'] || '', industry: criteria.industries || '', func: criteria['job function'] || '', open: pageOpen(html) };
}
export const linkedinId = url => String(url || '').match(/linkedin\.com\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/)?.[1] || null;
const postingUrl = id => `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`;
// A closed page is believed only while LinkedIn's pages still show Apply on open roles: if LinkedIn changed its
// pages, every role would look closed, so nothing is closed until an open one has been seen again.
const OPEN_SEEN_FRESH = 45 * 60e3;
const markOpen = (cursor, open) => { if (open === true) cursor.openSeenAt = Date.now(); };
const trustClosed = cursor => Date.now() - (cursor.openSeenAt || 0) < OPEN_SEEN_FRESH;

/**
 * Read one stored role's posting now (when someone opens it). true = open, false = closed, null = could not tell.
 * Honours a pause LinkedIn asked for, and starts one if it asks again.
 */
export async function checkPosting(id, cursor = {}, timeout = 4000) {
  if (cursor.pauseUntil && Date.now() < cursor.pauseUntil) return null;
  try {
    const open = pageOpen((await getText(postingUrl(id), { headers: HEAD, conditional: false, timeout })).body);
    markOpen(cursor, open);
    return open === false && !trustClosed(cursor) ? null : open;
  } catch (e) { if (limitedErr(e)) cursor.pauseUntil = Date.now() + BACKOFF_MS; return null; }
}

const limitedErr = e => e?.status === 429 || e?.status === 999;

/**
 * known(url) says whether a role is already stored (or was pruned), so its detail page is fetched once only.
 * `cursor` is this source's small persistent state: the pass counter and any back-off.
 * Roles past the per-pass detail budget are left for the next pass (a few minutes later), newest first.
 * due(n) names up to n stored LinkedIn roles to look at again; the result's `closed` lists the ones that stopped
 * taking applications and `checked` every one that was read.
 */
export async function linkedin({ settings, known = () => false, cursor = {}, due = () => [] } = {}) {
  const searches = (settings?.linkedinSearches ?? DEFAULT_LINKEDIN_SEARCHES).filter(s => s?.keywords).slice(0, MAX_SEARCHES);
  if (!searches.length) return [];
  if (cursor.pauseUntil && Date.now() < cursor.pauseUntil) return [];
  cursor.pass = (cursor.pass || 0) + 1;
  const sweep = cursor.pass % SWEEP_EVERY === 1; // includes the very first pass
  let limited = false; const found = new Map(); // id -> card
  const skip = new Set(cursor.closedIds || []);  // found already closed: not read again

  async function collect(s, { window, pages }) {
    for (let page = 0; page < pages && !limited; page++) {
      const q = new URLSearchParams({ keywords: s.keywords, location: s.location || 'Worldwide', f_TPR: window, sortBy: 'DD', start: String(page * 10) });
      if (s.remote) q.set('f_WT', '2');
      let cards;
      try { cards = parseCards((await getText(`https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${q}`, { headers: HEAD, conditional: false })).body); }
      catch (e) { if (limitedErr(e)) limited = true; return; }
      await sleep(PAUSE);
      if (!cards.length) return;
      let fresh = 0;
      for (const c of cards) { if (found.has(c.id) || skip.has(c.id) || known(linkedinUrl(c.id))) continue; found.set(c.id, c); fresh++; }
      if (!fresh && window === FRESH.window) return; // a narrow window is close to newest-first: nothing new here means nothing new further down
    }
  }
  for (const s of searches) { if (limited) break; await collect(s, FRESH); }
  if (sweep) for (const s of searches) { if (limited) break; await collect(s, SWEEP); }

  // Newest first, so the detail budget always goes to the roles where being early matters.
  const queue = [...found.values()].sort((a, b) => (a.ago ?? 1e9) - (b.ago ?? 1e9) || b.date.localeCompare(a.date)).slice(0, MAX_DETAILS);
  const out = []; const closedNew = []; let sawOpen = false;
  const note = open => { markOpen(cursor, open); if (open === true) sawOpen = true; };
  for (const c of queue) {
    if (limited) break;
    const seenAt = Date.now();
    let d = { description: '', seniority: '', employment: '' };
    try { d = parseDetail((await getText(postingUrl(c.id), { headers: HEAD, conditional: false })).body); }
    catch (e) { if (limitedErr(e)) { limited = true; break; } }
    await sleep(PAUSE);
    note(d.open);
    const exact = c.ago !== null;
    const posting = {
      sourceJobId: `linkedin:${c.id}`, title: c.title, company: c.company, url: linkedinUrl(c.id), location: c.location,
      typeHint: d.employment, levelHint: d.seniority, description: d.description,
      postedAt: exact ? new Date(seenAt - c.ago * 60e3).toISOString() : c.date ? `${c.date}T00:00:00.000Z` : null,
      precision: exact ? 'minute' : 'date',
    };
    if (d.open === false) closedNew.push([c.id, posting]); else out.push(posting); // already closed when found: not worth showing
  }

  // A few stored roles a pass: has the employer stopped taking applications?
  const closed = [], checked = [];
  for (const url of limited ? [] : due(RECHECK_PER_PASS)) {
    const id = linkedinId(url); if (!id) continue;
    let open = null;
    try { open = pageOpen((await getText(postingUrl(id), { headers: HEAD, conditional: false })).body); }
    catch (e) { if (limitedErr(e)) { limited = true; break; } }
    await sleep(PAUSE);
    note(open);
    if (open === null) continue;           // could not tell: asked again on a later pass
    checked.push(url); if (open === false) closed.push(url);
  }
  // A page without Apply counts as closed only when open roles read in the same pass still show it: if LinkedIn
  // changed its pages, every role would look closed. Then nothing is decided and new roles are kept as usual.
  if (sawOpen) { if (closedNew.length) cursor.closedIds = [...closedNew.map(x => x[0]), ...(cursor.closedIds || [])].slice(0, 400); }
  else { out.push(...closedNew.map(x => x[1])); checked.length = 0; closed.length = 0; }

  if (limited) cursor.pauseUntil = Date.now() + BACKOFF_MS;
  if (limited && !out.length && !checked.length) throw new Error('LinkedIn asked for a pause; trying again in 20 minutes');
  return Object.assign(out, { closed, closedBy: 'linkedin', checked });
}
