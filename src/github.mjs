// Reads a person's public GitHub: which languages they write, which libraries their projects use, and the
// tools their repositories show (Docker, CI, Terraform...). No login needed. GitHub allows 60 requests an
// hour without one, which covers about 25 repositories; an optional token raises that to 5,000.
// File contents come from raw.githubusercontent.com, which does not count against that limit.
import https from 'node:https';
import { LANGUAGES, skillsForPackage, isManifest, readManifest, fileSigns } from './packages.mjs';
import { extractSkills } from '../public/skills.mjs';

// Node's fetch gives up connecting after 10 seconds; on some networks GitHub takes longer than that to answer
// the first time. node:https waits as long as the operating system does, with our own limit on the whole request.
const agent = new https.Agent({ keepAlive: true, maxSockets: 6 }); // one slow connection, then reused
function get(url, headers, timeout = 30000) {
  return new Promise((ok, bad) => {
    const req = https.get(url, { headers, timeout, agent }, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) { res.resume(); return get(new URL(res.headers.location, url).href, headers, timeout).then(ok, bad); }
      const chunks = []; let n = 0;
      res.on('data', c => { n += c.length; if (n <= 4e6) chunks.push(c); });
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', bad);
    });
    req.on('timeout', () => req.destroy(new Error('GitHub took too long to answer')));
    req.on('error', bad);
  });
}
async function getRetry(url, headers, timeout) {
  try { return await get(url, headers, timeout); }
  catch (e) { await new Promise(r => setTimeout(r, 1500)); try { return await get(url, headers, timeout); } catch (e2) { throw new Error(`could not reach GitHub (${e2.code || e2.message})`); } }
}

const UA = 'Lookout (personal job-search tracker)';
const RESERVED = new Set(['about', 'features', 'pricing', 'login', 'join', 'sponsors', 'orgs', 'topics', 'collections', 'trending', 'explore', 'marketplace', 'settings', 'notifications', 'site', 'enterprise', 'apps', 'search', 'security', 'customer-stories', 'readme', 'events', 'team', 'codespaces', 'issues', 'pulls']);

/** The account and, when the link points at one, the repository: github.com/user or github.com/user/repo. */
export function githubTarget(url) {
  const m = String(url || '').trim().match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9-]{1,39})(?:\/([A-Za-z0-9._-]{1,100}))?/i);
  if (!m || RESERVED.has(m[1].toLowerCase())) return null;
  return { user: m[1], repo: m[2] && !/^(tab=|\?)/.test(m[2]) ? m[2].replace(/\.git$/, '') : null };
}

export function githubClient({ token = '', log = () => { } } = {}) {
  const rate = { remaining: null, reset: null, used: 0 };
  async function api(pathname) {
    if (rate.remaining !== null && rate.remaining <= 1) throw Object.assign(new Error('GitHub’s hourly limit is used up.'), { rateLimited: true });
    const res = await getRetry(`https://api.github.com${pathname}`, { 'user-agent': UA, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(token ? { authorization: `Bearer ${token}` } : {}) });
    rate.used++;
    const rem = res.headers['x-ratelimit-remaining']; if (rem !== undefined) rate.remaining = Number(rem);
    const reset = res.headers['x-ratelimit-reset']; if (reset) rate.reset = new Date(Number(reset) * 1000).toISOString();
    if (res.status === 404 || res.status === 409) return null; // 409: an empty repository
    if ((res.status === 403 || res.status === 429) && (rate.remaining === 0 || /rate limit/i.test(res.text))) throw Object.assign(new Error('GitHub’s hourly limit is used up.'), { rateLimited: true });
    if (res.status === 401) throw new Error('GitHub did not accept the token. Check it in Settings, or remove it.');
    if (res.status < 200 || res.status >= 300) throw new Error(`GitHub answered ${res.status}`);
    return JSON.parse(res.text);
  }
  async function raw(owner, repo, ref, file) {
    try {
      const res = await get(`https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${file.split('/').map(encodeURIComponent).join('/')}`, { 'user-agent': UA }, 20000);
      if (res.status !== 200) return null; return res.text.length > 400000 ? res.text.slice(0, 400000) : res.text;
    } catch { return null; }
  }
  async function rateLimit() {
    try { const r = await getRetry('https://api.github.com/rate_limit', { 'user-agent': UA, ...(token ? { authorization: `Bearer ${token}` } : {}) }); const j = JSON.parse(r.text); rate.remaining = j.resources?.core?.remaining ?? null; rate.reset = j.resources?.core?.reset ? new Date(j.resources.core.reset * 1000).toISOString() : null; } catch { }
    return rate;
  }
  return { api, raw, rateLimit, rate, log };
}

const GUESS = { // when the file list can't be fetched, try the usual dependency file for the main language
  JavaScript: ['package.json'], TypeScript: ['package.json'], Vue: ['package.json'], Svelte: ['package.json'], Python: ['requirements.txt', 'pyproject.toml'], 'Jupyter Notebook': ['requirements.txt'],
  Go: ['go.mod'], Rust: ['Cargo.toml'], Dart: ['pubspec.yaml'], Java: ['pom.xml', 'build.gradle'], Kotlin: ['build.gradle.kts', 'build.gradle'], Ruby: ['Gemfile'], PHP: ['composer.json'],
};
const monthsSince = iso => Math.max(0, (Date.now() - Date.parse(iso || 0)) / (30.4 * 864e5));

/**
 * Reads one repository. Returns { name, owner, url, description, pushedAt, stars, sizeKB, fork, languages: {name: bytes},
 * evidence: [{ skill, kind, detail, weight }] } where kind is language | package | file | topic | readme.
 */
export async function readRepo(gh, r, { deep }) {
  const owner = r.owner?.login || r.owner, name = r.name, ref = r.default_branch || 'HEAD';
  const out = { name, owner, url: r.html_url || `https://github.com/${owner}/${name}`, description: (r.description || '').slice(0, 300), pushedAt: r.pushed_at || r.updated_at || null, stars: r.stargazers_count || 0, sizeKB: r.size || 0, fork: !!r.fork, topics: r.topics || [], languages: {}, evidence: [], read: deep ? 'full' : 'light' };
  const ev = (skill, kind, detail, weight) => out.evidence.push({ skill, kind, detail, weight });
  // languages: the byte counts per language when we can afford the request, else just the main one
  if (deep) { try { out.languages = (await gh.api(`/repos/${owner}/${name}/languages`)) || {}; } catch (e) { if (e.rateLimited) deep = false; } }
  if (!Object.keys(out.languages).length && r.language) out.languages = { [r.language]: 1 };
  const total = Object.values(out.languages).reduce((a, b) => a + b, 0) || 1;
  for (const [lang, bytes] of Object.entries(out.languages)) {
    const share = bytes / total; const skills = LANGUAGES[lang]; if (!skills) continue;
    if (total > 1 && (share < 0.04 || bytes < 1500)) continue; // a stray script, not a language they write
    const w = share >= 0.5 ? 0.4 : share >= 0.2 ? 0.3 : 0.15;
    for (const s of skills) ev(s, 'language', total > 1 ? `${Math.round(share * 100)}% of the code` : 'main language', s === 'Jupyter' ? 0.2 : w);
  }
  // the file list: which dependency files and tell-tale files exist
  let paths = [];
  if (deep) { try { const t = await gh.api(`/repos/${owner}/${name}/git/trees/${encodeURIComponent(ref)}?recursive=1`); paths = (t?.tree || []).filter(x => x.type === 'blob').map(x => x.path); } catch (e) { if (e.rateLimited) deep = false; } }
  const skip = p => /(^|\/)(node_modules|vendor|third_party|dist|build|\.venv|venv|site-packages|examples?|samples?|test-fixtures)\//i.test(p);
  paths = paths.filter(p => !skip(p));
  // a Flutter app carries generated android/ and ios/ projects: scaffolding, not separate Android or iOS work
  const flutterRoots = paths.filter(p => /(^|\/)pubspec\.yaml$/.test(p)).map(p => p.slice(0, -'pubspec.yaml'.length));
  if (flutterRoots.length) paths = paths.filter(p => !flutterRoots.some(r => p.startsWith(r) && /^(android|ios|macos|linux|windows|web)\//.test(p.slice(r.length))));
  for (const [skill, file] of fileSigns(paths)) ev(skill, 'file', file, 0.25);
  let manifests = paths.filter(p => isManifest(p.split('/').pop())).sort((a, b) => a.split('/').length - b.split('/').length).slice(0, 5);
  if (!paths.length) manifests = (GUESS[r.language] || []).slice(0, 2);
  const seenPkg = new Set();
  for (const file of manifests) {
    const text = await gh.raw(owner, name, ref, file); if (!text) continue;
    for (const dep of readManifest(file.split('/').pop(), text)) for (const s of skillsForPackage(dep.eco, dep.name)) {
      const key = s.toLowerCase(); if (seenPkg.has(key)) continue; seenPkg.add(key);
      ev(s, 'package', `${dep.name} in ${file}`, 0.3);
    }
  }
  // topics people tag repositories with, and the README (weak: a README can mention things it doesn't use)
  for (const t of out.topics) for (const s of extractSkills(t.replace(/-/g, ' '), '')) ev(s.name, 'topic', `topic “${t}”`, 0.12);
  const readmePath = paths.find(p => /^readme(\.md|\.rst|\.txt)?$/i.test(p)) || (paths.length ? null : 'README.md');
  if (readmePath) { const md = await gh.raw(owner, name, ref, readmePath); if (md) { out.readme = md.slice(0, 1500); for (const s of extractSkills(md.slice(0, 40000), '')) ev(s.name, 'readme', 'named in the README', 0.05); } }
  return out;
}

/**
 * Reads a GitHub account (and any extra repositories, e.g. ones a portfolio links to).
 * Returns { user, profile: { name, bio, blog, publicRepos }, repos: [...], skipped, rate, note }.
 */
export async function readGithub(target, { token = '', extraRepos = [], maxRepos = 40, onProgress = () => { }, log = () => { } } = {}) {
  const gh = githubClient({ token, log }); await gh.rateLimit();
  const user = target.user; const out = { user, profile: null, repos: [], skipped: 0, rate: gh.rate, note: '' };
  if (gh.rate.remaining !== null && gh.rate.remaining < 3) { out.note = `GitHub’s hourly limit is used up until ${gh.rate.reset ? new Date(gh.rate.reset).toLocaleTimeString() : 'later'}. Add a token in Settings to scan now.`; return out; }
  const u = await gh.api(`/users/${encodeURIComponent(user)}`);
  if (!u) { out.note = `There is no GitHub account called “${user}”.`; return out; }
  out.profile = { name: u.name || '', bio: (u.bio || '').slice(0, 300), blog: u.blog || '', company: u.company || '', publicRepos: u.public_repos || 0, createdAt: u.created_at };
  const list = [];
  for (let page = 1; page <= 3 && list.length < u.public_repos; page++) {
    const batch = await gh.api(`/users/${encodeURIComponent(user)}/repos?per_page=100&sort=pushed&type=owner&page=${page}`); if (!batch?.length) break; list.push(...batch);
  }
  // their own work first: no forks, newest first, and skip empty ones
  const own = list.filter(r => !r.fork && r.size > 0).sort((a, b) => Date.parse(b.pushed_at) - Date.parse(a.pushed_at));
  out.skipped = list.length - own.length;
  const extra = [];
  for (const x of extraRepos.slice(0, 8)) { if (x.user.toLowerCase() === user.toLowerCase() && own.some(r => r.name.toLowerCase() === String(x.repo).toLowerCase())) continue; try { const r = await gh.api(`/repos/${x.user}/${x.repo}`); if (r && !r.fork) extra.push({ ...r, viaSite: true }); } catch { } }
  const all = [...own.slice(0, maxRepos), ...extra];
  // each repository read in full costs two requests; the rest are read from their main language and files alone
  let budget = Math.max(0, (gh.rate.remaining ?? 60) - 2);
  for (let i = 0; i < all.length; i++) {
    const deep = budget >= 2 && monthsSince(all[i].pushed_at) < 48; if (deep) budget -= 2;
    onProgress({ step: 'github', done: i, total: all.length, name: all[i].name });
    try { const repo = await readRepo(gh, all[i], { deep }); if (all[i].viaSite) repo.viaSite = true; out.repos.push(repo); }
    catch (e) { if (e.rateLimited) { budget = 0; i--; continue; } log(`github: ${all[i].name}: ${e.message}`); }
  }
  if (own.length > maxRepos) out.note = `Read your ${maxRepos} most recently updated repositories of ${own.length}.`;
  out.readRepos = async refs => { // more repositories found later (linked from your site), with what is left of the hourly limit
    const more = [];
    for (const x of refs.slice(0, 8)) {
      if (out.repos.some(r => r.owner.toLowerCase() === x.user.toLowerCase() && r.name.toLowerCase() === String(x.repo).toLowerCase())) continue;
      try { const r = await gh.api(`/repos/${x.user}/${x.repo}`); if (!r || r.fork) continue; const deep = (gh.rate.remaining ?? 0) >= 4; const repo = await readRepo(gh, r, { deep }); repo.viaSite = true; out.repos.push(repo); more.push(repo); } catch (e) { if (e.rateLimited) break; }
    }
    return more;
  };
  if (out.repos.some(r => r.read === 'light')) out.note = [out.note, `${out.repos.filter(r => r.read === 'light').length} were read from their main language only, to stay within GitHub’s hourly limit${token ? '' : '; a token lifts it'}.`].filter(Boolean).join(' ');
  return out;
}
