// Reads a portfolio or personal site, and any other links you give it, for skills and projects.
// A plain download comes first; pages that only fill in after their JavaScript runs are read with a
// headless browser (src/browser.mjs). It stays on your site (up to 10 pages, one link deep), respects
// robots.txt, and stops at pages that ask for a human check rather than trying to get past them.
import { htmlToText, decodeEntities } from './util.mjs';
import { extractSkills } from '../public/skills.mjs';
import { githubTarget } from './github.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Lookout/2.1 (personal job-search tracker)';
const SKIP_EXT = /\.(pdf|png|jpe?g|gif|webp|svg|ico|mp4|webm|mp3|zip|gz|dmg|exe|apk|docx?|pptx?|xlsx?|css|js|json|xml|txt)(\?|#|$)/i;
const DEMO_HOSTS = /\.(vercel\.app|netlify\.app|github\.io|pages\.dev|web\.app|firebaseapp\.com|herokuapp\.com|onrender\.com|fly\.dev|railway\.app|streamlit\.app|hf\.space|surge\.sh|glitch\.me|replit\.app|repl\.co)$/i;
const CHALLENGE = /just a moment|verify you are human|checking your browser|enable javascript and cookies|are you a robot|captcha|access denied|attention required/i;
const PROJECTISH = /project|work|portfolio|case|build|made|about|skills?|experience|resume|cv|stack|tech/i;
const SOCIAL = { linkedin: /linkedin\.com\/in\//i, github: /github\.com\/[A-Za-z0-9-]+\/?$/i };

async function download(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en' }, signal: AbortSignal.timeout(15000), redirect: 'follow' });
  const type = res.headers.get('content-type') || '';
  if (!res.ok) throw new Error(`the site answered ${res.status}`);
  if (!/html|xml|text\/plain/i.test(type)) throw new Error('that link is not a web page');
  const buf = await res.arrayBuffer(); return { url: res.url, html: Buffer.from(buf.slice(0, 3e6)).toString('utf8') };
}
function parseHtml(html, base) {
  const meta = {}; for (const m of html.matchAll(/<meta\s+[^>]*?(?:name|property)=["']([^"']+)["'][^>]*?content=["']([^"']*)["'][^>]*>/gi)) meta[m[1].toLowerCase()] = decodeEntities(m[2]).slice(0, 500);
  for (const m of html.matchAll(/<meta\s+[^>]*?content=["']([^"']*)["'][^>]*?(?:name|property)=["']([^"']+)["'][^>]*>/gi)) meta[m[2].toLowerCase()] ??= decodeEntities(m[1]).slice(0, 500);
  const links = []; for (const m of html.matchAll(/<a\b[^>]*?href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) { try { const href = new URL(decodeEntities(m[1]), base).href; if (/^https?:/.test(href)) links.push({ href, text: htmlToText(m[2]).replace(/\s+/g, ' ').trim().slice(0, 120) }); } catch { } if (links.length > 800) break; }
  const jsonld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1].slice(0, 20000));
  const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m => m[1]).slice(0, 80);
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
  const body = html.replace(/<(nav|footer|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ');
  return { url: base, title, text: htmlToText(body).slice(0, 200000), links, meta, jsonld, scripts, generator: meta.generator || '', html };
}
const looksEmpty = p => p.text.replace(/\s+/g, ' ').length < 600 || (/<div[^>]+id=["'](root|__next|app|__nuxt|svelte)["'][^>]*>\s*<\/div>/i.test(p.html || '') && p.text.length < 1500);

// robots.txt: honour "Disallow" lines for all robots, per site
const robotsCache = new Map();
async function allowed(url) {
  const u = new URL(url); const key = u.origin;
  if (!robotsCache.has(key)) {
    let rules = [];
    try {
      const r = await fetch(`${key}/robots.txt`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8000) });
      if (r.ok) { let mine = false; for (const raw of (await r.text()).split(/\r?\n/)) { const l = raw.replace(/#.*/, '').trim(); const [k, ...v] = l.split(':'); const val = v.join(':').trim(); if (/^user-agent$/i.test(k)) mine = val === '*' || /lookout/i.test(val); else if (mine && /^disallow$/i.test(k) && val) rules.push(val); } }
    } catch { }
    robotsCache.set(key, rules);
  }
  return !robotsCache.get(key).some(p => u.pathname.startsWith(p.replace(/\*.*$/, '')));
}

/** What a page's own code shows it was built with (a portfolio built with Next.js is a Next.js project). */
function siteTech(p) {
  const out = new Set(); const s = p.scripts.join(' '); const h = p.html || '';
  if (/\/_next\//.test(s) || /__NEXT_DATA__|\/_next\/static/.test(h)) { out.add('Next.js'); out.add('React'); }
  else if (/data-reactroot|react(-dom)?(\.production)?(\.min)?\.js|__REACT_DEVTOOLS/i.test(s + h)) out.add('React');
  if (/\/_nuxt\//.test(s + h)) { out.add('Nuxt'); out.add('Vue'); } else if (/data-v-[0-9a-f]{8}|vue(\.runtime)?(\.global)?(\.prod)?\.js/i.test(s + h)) out.add('Vue');
  if (/\/_app\/immutable\/|svelte-[a-z0-9]{6}/i.test(s + h)) out.add('Svelte');
  if (/ng-version=/i.test(h)) out.add('Angular');
  if (/<astro-island|astro-[a-z0-9]{8}/i.test(h)) out.add('Astro');
  if (/\b(?:sm|md|lg|xl):(?:flex|grid|hidden|block|px-\d|text-)/.test(h)) out.add('Tailwind');
  return [...out];
}
/** Lines under a heading like "Skills", "Tech stack" or "Tools I use", up to the next heading. */
const SKILL_HEAD = /^(?:my |technical |tech(?:nical)? |core |key )?(?:skills?|tech(?:nology)? stack|stack|technologies|tools(?: (?:&|and) technologies)?|toolbox|languages(?: (?:&|and) (?:frameworks|tools))?|what i (?:use|work with)|i work with|expertise)\s*:?\s*$/i;
function skillSection(text) {
  const lines = String(text).split(/\n/).map(l => l.trim()).filter(Boolean); const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!SKILL_HEAD.test(lines[i])) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 40); j++) { const l = lines[j]; if (l.length > 160 || (/^[A-Z][a-z]+(?: [A-Za-z]+){0,3}$/.test(l) && /^(projects?|experience|about|contact|education|work|blog|writing|awards|certifications?)$/i.test(l))) break; out.push(l); }
  }
  return out;
}
function personFacts(p) {
  const knows = [], sameAs = [];
  const walk = x => { if (!x || typeof x !== 'object') return; if (Array.isArray(x)) return x.forEach(walk); const t = [].concat(x['@type'] || []);
    if (t.includes('Person')) { for (const k of [].concat(x.knowsAbout || [])) knows.push(typeof k === 'string' ? k : k?.name || ''); for (const u of [].concat(x.sameAs || [])) if (typeof u === 'string') sameAs.push(u); }
    if (x['@graph']) walk(x['@graph']); };
  for (const j of p.jsonld) { try { walk(JSON.parse(j)); } catch { } }
  return { knows: knows.filter(Boolean).slice(0, 60), sameAs };
}

/**
 * Reads the given links. kind: 'portfolio' (crawled a little) or 'other' (that page only).
 * Returns { pages, evidence: [{ skill, kind, detail, weight, where }], repos: [{ user, repo }], projects, socials, notes }.
 */
export async function readSites(targets, { getBrowser = async () => null, maxPages = 12, onProgress = () => { }, log = () => { } } = {}) {
  const out = { pages: [], evidence: [], repos: [], projects: [], socials: {}, notes: [] };
  const seen = new Set(); const seenEv = new Set();
  const ev = (skill, kind, detail, weight, where) => { const k = `${skill}|${kind}|${where}`.toLowerCase(); if (seenEv.has(k)) return; seenEv.add(k); out.evidence.push({ skill, kind, detail, weight, where }); };
  async function readOne(url, { render = true } = {}) {
    if (!(await allowed(url))) return { url, ok: false, note: 'robots.txt asks robots not to read this page' };
    let p = null, how = 'download';
    try { const d = await download(url); p = parseHtml(d.html, d.url); } catch (e) { p = null; if (!render) return { url, ok: false, note: e.message }; }
    if (render && (!p || looksEmpty(p))) {
      const b = await getBrowser();
      if (b) { try { const r = await b.read(url); p = { ...r, html: '' }; how = 'browser'; } catch (e) { if (!p) return { url, ok: false, note: `could not open it (${e.message})` }; } }
      else if (!p) return { url, ok: false, note: 'could not download it' };
    }
    if (CHALLENGE.test(p.title) || (p.text.length < 2000 && CHALLENGE.test(p.text.slice(0, 1500)))) return { url, ok: false, note: 'the site asks for a human check; open it in your browser and use the Lookout extension there' };
    return { url: p.url || url, ok: true, how, ...p };
  }
  let n = 0;
  for (const t of targets) {
    const host = (() => { try { return new URL(t.url).hostname.replace(/^www\./, ''); } catch { return ''; } })(); if (!host) continue;
    if (/(^|\.)linkedin\.com$/.test(host)) { out.notes.push('LinkedIn profiles can only be read signed in. Use “Save to PDF” on your LinkedIn profile and import that file instead.'); continue; }
    if (/(^|\.)github\.com$/.test(host)) { const g = githubTarget(t.url); if (g?.repo) out.repos.push(g); continue; } // read by the GitHub reader
    const queue = [t.url]; let depth0 = true; let pagesHere = 0;
    while (queue.length && n < maxPages && pagesHere < (t.kind === 'portfolio' ? 10 : 1)) {
      const url = queue.shift(); const key = url.replace(/[#?].*$/, '').replace(/\/$/, ''); if (seen.has(key)) continue; seen.add(key);
      onProgress({ step: 'sites', done: n, total: Math.min(maxPages, n + queue.length + 1), name: url.replace(/^https?:\/\//, '') });
      const p = await readOne(url); n++; pagesHere++;
      out.pages.push({ url, title: p.title || '', ok: p.ok, how: p.how || '', note: p.note || '' });
      if (!p.ok) { if (depth0) out.notes.push(`${host}: ${p.note}`); depth0 = false; continue; }
      const where = host; const isPortfolio = t.kind === 'portfolio';
      // a "Skills" / "Tech stack" section is a list of claims; anything else on the page is a passing mention
      const listed = new Set(skillSection(p.text).flatMap(l => extractSkills(l, l).map(s => s.name)));
      for (const s of listed) ev(s, isPortfolio ? 'site' : 'page', `listed under skills on ${host}`, 0.4, where);
      for (const s of extractSkills(p.text, p.title)) if (!listed.has(s.name)) ev(s.name, isPortfolio ? 'site' : 'page', isPortfolio ? `named on ${host}` : `on your ${host} page`, isPortfolio ? 0.15 : 0.25, where);
      const facts = personFacts(p);
      for (const k of facts.knows) for (const s of extractSkills(k, k)) ev(s.name, 'site', `listed as a skill on ${host}`, 0.35, where);
      if (depth0 && isPortfolio) for (const s of siteTech(p)) ev(s, 'site-tech', `${host} is built with it`, 0.15, where);
      for (const l of [...p.links, ...facts.sameAs.map(href => ({ href, text: '' }))]) {
        let u; try { u = new URL(l.href); } catch { continue; }
        const lh = u.hostname.replace(/^www\./, '');
        if (!isPortfolio) continue; // other people's names on a profile page (followers, answers) are not yours
        if (SOCIAL.linkedin.test(l.href)) out.socials.linkedin ||= l.href.replace(/[?#].*$/, '');
        if (lh === 'github.com') { const g = githubTarget(l.href); if (g?.repo) { if (!out.repos.some(r => r.user === g.user && r.repo === g.repo)) { out.repos.push(g); out.projects.push({ name: g.repo, url: `https://github.com/${g.user}/${g.repo}`, kind: 'repo', label: l.text }); } } else if (g) out.socials.github ||= `https://github.com/${g.user}`; continue; }
        if (isPortfolio && depth0 && lh !== host && DEMO_HOSTS.test(lh) && !out.projects.some(x => x.url === u.origin)) out.projects.push({ name: l.text || lh, url: u.origin + u.pathname, kind: 'demo' });
        if (isPortfolio && lh === host && !SKIP_EXT.test(u.pathname) && depth0) { const k = (u.origin + u.pathname).replace(/\/$/, ''); if (!seen.has(k) && !queue.includes(u.origin + u.pathname)) (PROJECTISH.test(u.pathname + ' ' + l.text) ? queue.unshift : queue.push).call(queue, u.origin + u.pathname); }
      }
      depth0 = false;
    }
  }
  // live demos: what each one was built with (one page each, a few at most)
  for (const d of out.projects.filter(x => x.kind === 'demo').slice(0, 5)) {
    onProgress({ step: 'demos', done: 0, total: 1, name: d.url.replace(/^https?:\/\//, '') });
    const p = await readOne(d.url, { render: false }).catch(() => null);
    if (p?.ok) { d.stack = siteTech(p); for (const s of d.stack) ev(s, 'site-tech', `${d.name} is built with it`, 0.2, new URL(d.url).hostname); }
  }
  return out;
}
