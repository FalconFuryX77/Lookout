// Funding signals: who just raised money (=> likely to hire soon).
// Sources: YC batch data (yc-oss, rebuilt daily from YC's directory) and funding news RSS
// from established outlets. Headlines are parsed into company / amount / stage, and every
// record links to the article it came from.
import { getText, getJson, feedEntries, xmlTag, xmlText, xmlLink, toIso, hash } from './util.mjs';

export const FUNDING_FEEDS = [
  { id: 'tc-venture', name: 'TechCrunch Venture', url: 'https://techcrunch.com/category/venture/feed/' },
  { id: 'tc-startups', name: 'TechCrunch Startups', url: 'https://techcrunch.com/category/startups/feed/' },
  { id: 'cb-venture', name: 'Crunchbase News', url: 'https://news.crunchbase.com/sections/venture/feed/' },
  { id: 'entrackr', name: 'Entrackr (India)', url: 'https://entrackr.com/rss' },
  { id: 'inc42', name: 'Inc42 Buzz (India)', url: 'https://inc42.com/buzz/feed/' },
  { id: 'yourstory', name: 'YourStory (India)', url: 'https://yourstory.com/feed' },
  { id: 'gnews-seed', name: 'Google News: seed & Series A', url: 'https://news.google.com/rss/search?q=%22raises%22+(%22seed+round%22+OR+%22pre-seed%22+OR+%22Series+A%22)+when:3d&hl=en-US&gl=US&ceid=US:en' },
  { id: 'gnews-india', name: 'Google News: India startup funding', url: 'https://news.google.com/rss/search?q=startup+(raises+OR+bags+OR+secures)+(seed+OR+%22Series+A%22+OR+%22pre-Series+A%22)+India+when:3d&hl=en-IN&gl=IN&ceid=IN:en' },
];

const VERB = /\s+(?:has\s+)?(?:raises?|raised|secures?|secured|bags?|bagged|lands?|landed|closes?|closed|nabs?|snags?|picks up|scores?|grabs?|gets|receives?|collects?|announces?|completes?|mops up|rakes in)\b/i;
const AMOUNT = /(?:[$€£₹]|USD\s?|INR\s?|Rs\.?\s?)\s?\d[\d,.]*\s?(?:million|mn|m|billion|bn|b|crore|cr|lakh|k)?\b/i;
const STAGE = /\b(pre[- ]seed|seed|angel|pre[- ]series\s?[a-d]|series\s?[a-f]\d?|bridge|growth|venture debt)\b/i;

/** "Acme AI raises $4M seed round led by X" -> { company: 'Acme AI', amount: '$4M', stage: 'Seed' } */
export function parseHeadline(title) {
  const t = title.replace(/\s+[-–|]\s+[^-–|]{2,40}$/, ''); // strip " - Publisher"
  const m = t.match(VERB);
  if (!m || !(AMOUNT.test(t) || STAGE.test(t) || /\bfunding\b/i.test(t))) return null;
  // IPOs, acquisitions and public-market moves aren't early-stage hiring signals.
  if (/\b(ipo|listing|lists on|shares|stock|acquires|acquired|merger|sebi|nasdaq|nyse|bse|nse)\b/i.test(t)) return null;
  // VC firms raising their own funds are not hiring signals.
  if (/\b(?:fund|funds|vehicle|LP commitments?)\b(?!ing)/i.test(t.slice(m.index)) && !/\bfunding\b/i.test(t)) return null;
  let company = t.slice(0, m.index).trim()
    .replace(/^.*\]\s*/, '').replace(/^(?:exclusive|funding|scoop|breaking|report|update|watch|deal)\s*[:\-–]\s*/i, '');
  // Drop leading descriptors: "Bengaluru-based fintech startup Acme" -> "Acme", "DLI-backed C2i" -> "C2i"
  const DESC = /^.*\b(?:startup|start-up|platform|company|firm|maker|chipmaker|carmaker|manufacturer|provider|unicorn|player|app|brand|developer|operator|marketplace|lender|insurer|retailer|specialist|venture|outfit|disruptor|challenger|giant|major|newcomer)s?\s+(?=\S)/i;
  if (DESC.test(company)) company = company.replace(DESC, '');
  company = company.replace(/^(?:[\w.&]+-(?:based|backed|focused|led|owned|founded|incubated|powered)\s+)+/i, '').replace(/^[A-Z][\w.]*(?:['’]s)\s+(?=[A-Z0-9])/, '')
    .replace(/['’]s$/, '').replace(/^[^A-Za-z0-9]+/, '').replace(/[,:;]+$/, '').trim();
  if (!company || company.split(/\s+/).length > 4 || company.length > 40 || /^(it|this|the|a|an|how|why|what|startups?|investors?|india|us|report|exclusive)$/i.test(company)) return null;
  if (/^(how|why|what|when|where|who|these|top|here|this|our|my|your|all|most|many|some|\d+)\b/i.test(company)) return null;
  if (/\b(capital|ventures|partners|vc|fund|investments|holdings|asset management|private equity)\b/i.test(company)) return null;
  const stage = (t.match(STAGE)?.[1] || '').replace(/\s+/g, ' ').replace(/^./, c => c.toUpperCase()).replace(/series (\w)/i, (_, x) => `Series ${x.toUpperCase()}`);
  return { company, amount: t.match(AMOUNT)?.[0]?.trim() || '', stage: stage || 'Undisclosed' };
}

export async function fetchFundingFeed(feed) {
  const { body, changed } = await getText(feed.url, { headers: { accept: 'application/rss+xml, application/xml' }, timeout: 20000 });
  if (!changed) return [];
  const out = [];
  for (const it of feedEntries(body)) {
    const title = xmlText(it, 'title'); const url = xmlLink(it);
    if (!title || !url) continue;
    const parsed = parseHeadline(title);
    if (!parsed) continue;
    out.push({ id: hash(url), ...parsed, title, url, publisher: xmlText(it, 'source') || feed.name, feed: feed.id,
      publishedAt: toIso(xmlTag(it, 'pubDate') || xmlTag(it, 'published')), summary: xmlText(it, 'description').slice(0, 400) });
  }
  return out;
}

/** YC companies from the most recent batches (YC investment = funded, typically hiring after Demo Day). */
export async function fetchRecentYc() {
  const now = new Date(); const y = now.getUTCFullYear();
  const batches = [`winter-${y}`, `spring-${y}`, `summer-${y}`, `fall-${y}`, `fall-${y - 1}`, `summer-${y - 1}`];
  const out = [];
  for (const b of batches) {
    try {
      const { data } = await getJson(`https://yc-oss.github.io/api/batches/${b}.json`, { timeout: 30000 });
      for (const c of data) out.push({ name: c.name, slug: c.slug, website: c.website, oneLiner: c.one_liner, batch: c.batch, isHiring: c.isHiring, teamSize: c.team_size, industry: c.industry, locations: c.all_locations, status: c.status, url: c.url });
    } catch { /* batch may not exist yet */ }
  }
  return out;
}

/** Every YC company currently marked as hiring (any batch). */
export async function fetchYcHiring() {
  const { data } = await getJson('https://yc-oss.github.io/api/companies/hiring.json', { timeout: 60000 });
  return data.filter(c => c.status !== 'Inactive' && c.status !== 'Acquired').map(c => ({ name: c.name, slug: c.slug, website: c.website, oneLiner: c.one_liner, batch: c.batch, teamSize: c.team_size, industry: c.industry, url: c.url }));
}

/** Best-effort website lookup for a company only known from a headline. Confirms by page title. */
export async function guessWebsite(name) {
  const slug = name.toLowerCase().replace(/\b(ai|labs|technologies|inc)\b/g, m => m).replace(/[^a-z0-9]/g, '');
  const bare = name.toLowerCase().replace(/\s+(ai|labs|technologies|inc|hq)$/i, '').replace(/[^a-z0-9]/g, '');
  const tries = [...new Set([`${slug}.com`, `${slug}.ai`, `${bare}.ai`, `${slug}.io`, `${bare}.com`, `${slug}.co`, `${slug}.in`, `get${bare}.com`, `${bare}.so`])];
  const first = name.toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, '');
  for (const d of tries) {
    try {
      const r = await getText(`https://${d}`, { timeout: 7000, conditional: false, headers: { accept: 'text/html' } });
      const title = (r.body.match(/<title[^>]*>([^<]*)/i)?.[1] || '').toLowerCase();
      const og = (r.body.match(/property=["']og:site_name["'][^>]*content=["']([^"']+)/i)?.[1] || '').toLowerCase();
      if ((title.includes(first) || og.includes(first)) && !/(for sale|domain|parked|godaddy|namecheap|sedo|hugedomains|dan\.com)/i.test(r.body.slice(0, 5000))) return new URL(r.url).origin;
    } catch { }
  }
  return '';
}
