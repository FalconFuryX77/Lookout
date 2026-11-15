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
/** Parse a posting page: description plus the "Seniority level / Employment type" block. */
export function parseDetail(html) {
  const description = htmlToText(html.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/)?.[1] || '');
  const criteria = {};
  for (const m of html.matchAll(/job-criteria-subheader[^>]*>([\s\S]*?)<\/h3>\s*<span[^>]*>([\s\S]*?)<\/span>/g)) criteria[text(m[1]).toLowerCase()] = text(m[2]);
  return { description, seniority: criteria['seniority level'] || '', employment: criteria['employment type'] || '', industry: criteria.industries || '', func: criteria['job function'] || '' };
}

const limitedErr = e => e?.status === 429 || e?.status === 999;

/**
 * known(url) says whether a role is already stored (or was pruned), so its detail page is fetched once only.
 * `cursor` is this source's small persistent state: the pass counter and any back-off.
 * Roles past the per-pass detail budget are left for the next pass (a few minutes later), newest first.
 */
export async function linkedin({ settings, known = () => false, cursor = {} } = {}) {
  const searches = (settings?.linkedinSearches ?? DEFAULT_LINKEDIN_SEARCHES).filter(s => s?.keywords).slice(0, MAX_SEARCHES);
  if (!searches.length) return [];
  if (cursor.pauseUntil && Date.now() < cursor.pauseUntil) return [];
  cursor.pass = (cursor.pass || 0) + 1;
  const sweep = cursor.pass % SWEEP_EVERY === 1; // includes the very first pass
  let limited = false; const found = new Map(); // id -> card

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
      for (const c of cards) { if (found.has(c.id) || known(linkedinUrl(c.id))) continue; found.set(c.id, c); fresh++; }
      if (!fresh && window === FRESH.window) return; // a narrow window is close to newest-first: nothing new here means nothing new further down
    }
  }
  for (const s of searches) { if (limited) break; await collect(s, FRESH); }
  if (sweep) for (const s of searches) { if (limited) break; await collect(s, SWEEP); }

  // Newest first, so the detail budget always goes to the roles where being early matters.
  const queue = [...found.values()].sort((a, b) => (a.ago ?? 1e9) - (b.ago ?? 1e9) || b.date.localeCompare(a.date)).slice(0, MAX_DETAILS);
  const out = [];
  for (const c of queue) {
    if (limited) break;
    const seenAt = Date.now();
    let d = { description: '', seniority: '', employment: '' };
    try { d = parseDetail((await getText(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${c.id}`, { headers: HEAD, conditional: false })).body); }
    catch (e) { if (limitedErr(e)) { limited = true; break; } }
    await sleep(PAUSE);
    const exact = c.ago !== null;
    out.push({
      sourceJobId: `linkedin:${c.id}`, title: c.title, company: c.company, url: linkedinUrl(c.id), location: c.location,
      typeHint: d.employment, levelHint: d.seniority, description: d.description,
      postedAt: exact ? new Date(seenAt - c.ago * 60e3).toISOString() : c.date ? `${c.date}T00:00:00.000Z` : null,
      precision: exact ? 'minute' : 'date',
    });
  }
  if (limited) cursor.pauseUntil = Date.now() + BACKOFF_MS;
  if (limited && !out.length) throw new Error('LinkedIn asked for a pause; trying again in 20 minutes');
  return out;
}
