// Shared helpers: HTTP with conditional caching, HTML/XML text extraction, small utilities.

const UA = 'Lookout/2.0 (personal job-search tracker; links back to sources)';
const httpCache = new Map(); // url -> { etag, lastModified, body }

export class HttpError extends Error {
  constructor(status, url) { super(`HTTP ${status}`); this.status = status; this.url = url; }
}

/**
 * GET a URL as text. Uses ETag / Last-Modified so polling every minute is cheap for
 * sources that support it (GitHub raw, many RSS servers). Returns { body, changed }.
 */
export async function getText(url, { headers = {}, timeout = 20000, conditional = true } = {}) {
  const cached = conditional ? httpCache.get(url) : null;
  const h = { 'user-agent': UA, 'accept-language': 'en', ...headers };
  if (cached?.etag) h['if-none-match'] = cached.etag;
  if (cached?.lastModified) h['if-modified-since'] = cached.lastModified;
  const res = await fetch(url, { headers: h, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
  if (res.status === 304 && cached) return { body: cached.body, changed: false, url: res.url };
  if (!res.ok) throw new HttpError(res.status, url);
  const body = await res.text();
  if (conditional) {
    const etag = res.headers.get('etag'); const lastModified = res.headers.get('last-modified');
    if (etag || lastModified) httpCache.set(url, { etag, lastModified, body });
  }
  return { body, changed: true, url: res.url };
}

export async function getJson(url, opts = {}) {
  const r = await getText(url, { ...opts, headers: { accept: 'application/json', ...(opts.headers || {}) } });
  return { ...r, data: JSON.parse(r.body) };
}

const ENT = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', mdash: '—', ndash: '–', hellip: '…', bull: '•' };
export function decodeEntities(s = '') {
  return String(s)
    .replace(/&#x([\da-f]+);/gi, (_, h) => safeCp(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCp(Number(d)))
    .replace(/&([a-z0-9#]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
function safeCp(n) { try { return String.fromCodePoint(n); } catch { return ''; } }

/** HTML -> readable plain text, keeping paragraph / list breaks. */
export function htmlToText(html = '') {
  let s = String(html);
  if (/&lt;\/?(p|div|li|br|ul|h\d)/i.test(s)) s = decodeEntities(s); // double-encoded HTML (common in feeds)
  return decodeEntities(s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>|<p\b[^>]*>/gi, '\n').replace(/<\/(p|div|h\d|ul|ol|tr)>/gi, '\n').replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// --- Minimal RSS / Atom parsing (enough for job + news feeds) ---
export function feedEntries(xml) { return [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map(m => m[0]); }
export function xmlTag(xml, name) {
  const m = xml.match(new RegExp(`<${name.replace(':', '\\:')}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name.replace(':', '\\:')}>`, 'i'));
  if (!m) return '';
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}
export function xmlText(xml, name) { return htmlToText(xmlTag(xml, name)); }
export function xmlLink(item) {
  const m = item.match(/<link\b[^>]*?href=["']([^"']+)["'][^>]*>/i);
  return decodeEntities(m ? m[1] : xmlTag(item, 'link')).trim();
}

export function toIso(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v);
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
}
/** "minute" when the source value carries a time of day, otherwise "date". */
export function precisionOf(v) {
  if (v === null || v === undefined || v === '') return 'unknown';
  if (typeof v === 'number') return 'minute';
  return /\d{1,2}:\d{2}/.test(String(v)) ? 'minute' : 'date';
}

export function domainOf(url) {
  try { const h = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); return h; } catch { return ''; }
}
export function canonicalUrl(url) {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|ref$|source$|gh_src$|lever-source|src$|fbclid|gclid)/i.test(k)) u.searchParams.delete(k);
    u.hash = '';
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`.toLowerCase();
  } catch { return String(url || '').toLowerCase(); }
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

/** Run async tasks with a concurrency cap. */
export async function pool(items, limit, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; try { out[idx] = await fn(items[idx], idx); } catch (e) { out[idx] = { error: e }; } }
  }));
  return out;
}
