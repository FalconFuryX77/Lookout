// Finding the root posting. A role often reaches us through middlemen: a job board that links to a
// recruiter's page that links to the employer's own listing. Every hop wants your details. These helpers
// (1) rank links by how direct they are, (2) spot a posting that is really another company's role,
// and (3) decide whether two records are the same role.
import { normCompany, normTitle } from './dedupe.mjs';
import { linkRank, bestLink, isShortLink } from '../public/links.mjs';
export { linkRank, bestLink, isShortLink };

const host = u => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
/** Follow a short link's redirects (without loading the pages) and return where it ends up, or null. */
export async function followRedirects(url, max = 6) {
  let cur = url;
  for (let i = 0; i < max; i++) {
    let r;
    try { r = await fetch(cur, { method: 'HEAD', redirect: 'manual', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10000) }); }
    catch { return i ? cur : null; }
    if (r.status === 405 || r.status === 403 || r.status === 501) { try { r = await fetch(cur, { redirect: 'manual', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10000) }); r.body?.cancel?.(); } catch { return i ? cur : null; } }
    const loc = r.status >= 300 && r.status < 400 && r.headers.get('location');
    if (!loc) return i ? cur : null;            // a short link that does not redirect has nothing to tell us
    cur = new URL(loc, cur).href;
    if (!isShortLink(cur)) return cur;
  }
  return isShortLink(cur) ? null : cur;
}

/** Companies whose business is re-posting other companies' roles. */
export const REPOSTER = /\b(joblet|jobs4panindia|jobs ?4 ?pan ?india|talentgigs|crossing hurdles|targetjobs|jobgether|remotehunter|lensa|talentify|jobot|cybercoders|recruiting from scratch|hiretalent|hire ?digital|wiraa|uplers|supersourcing|recruitcrm|peoplegrove|jobright|hireclout|canvas talent|energy jobline|efinancialcareers|get ?it ?recruit|trabajo|jobleads|whatjobs|talent ?pop|sundayy|scaleup talent|sourcebae|hyring|hirebee|talentmate|expertia)\b/i;

const NOT_NAMES = new Set(('today world company client team candidate bachelor master it let we you he she they that there here what who one user customer people employee employer business industry market product platform tomorrow year month week day nation country city government university student patient member partner vendor child women men doctor nurse driver owner founder leader manager engineer developer designer analyst scientist intern person individual organization organisation firm startup enterprise brand store shop app site service system software data ai world’s earth life yesterday india america europe asia africa canada china japan germany france london york everyone anyone someone each other another').split(' '));
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * If this posting is really for another company, return that company's name as written.
 * Deliberately strict: the poster never names itself in the text, and the text speaks of someone
 * else's products, team or platform ("building micro1's human data platforms").
 */
export function namedEmployer(job) {
  const d = String(job.description || ''); if (d.length < 200) return null;
  const own = String(job.company || '').split(/[\s-]+/).filter(w => w.length > 2)[0];
  if (own && new RegExp(`\\b${esc(own)}`, 'i').test(d)) return null;
  const count = new Map();
  for (const m of d.matchAll(/\b([A-Za-z][A-Za-z0-9.&]{2,24})['’]s\b/g)) {
    const w = m[1]; if (NOT_NAMES.has(w.toLowerCase()) || !/[A-Z0-9]/.test(w)) continue;
    // a sentence-opening ordinary word ("Today's") is not a name; a name keeps its shape mid-sentence
    count.set(w, (count.get(w) || 0) + 1);
  }
  let best = null, n = 0;
  for (const [w] of count) { const all = (d.match(new RegExp(`\\b${esc(w)}\\b`, 'g')) || []).length; if (all > n) { best = w; n = all; } }
  if (!best || normCompany(best) === normCompany(job.company)) return null;
  return { name: best, mentions: n };
}

const words = t => new Set(String(t).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(x => x.length > 3));
const overlap = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / Math.min(a.size, b.size); };
/** Same role, told twice: titles agree and the text is largely the same. */
export function sameRole(a, b) {
  const ta = new Set(normTitle(a.title).split(' ').filter(Boolean)), tb = new Set(normTitle(b.title).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return false;
  let both = 0; for (const x of ta) if (tb.has(x)) both++;
  const jac = both / (ta.size + tb.size - both);
  if (jac === 1) return true;
  return jac >= 0.6 && overlap(words(a.description), words(b.description)) >= 0.55;
}
/** Board names worth trying for a company we only know by name. */
export function boardSlugs(name) {
  const base = String(name).toLowerCase().replace(/&/g, 'and'); const a = base.replace(/[^a-z0-9]+/g, ''), b = base.trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return [...new Set([a, b, `${a}hq`, `${a}-ai`, `${a}ai`].filter(s => s.length >= 3))].slice(0, 4);
}
export const BOARD_URL = { ashby: b => `https://jobs.ashbyhq.com/${b}`, greenhouse: b => `https://job-boards.greenhouse.io/${b}`, lever: b => `https://jobs.lever.co/${b}`, workable: b => `https://apply.workable.com/${b}`, smartrecruiters: b => `https://jobs.smartrecruiters.com/${b}`, recruitee: b => `https://${b}.recruitee.com` };
