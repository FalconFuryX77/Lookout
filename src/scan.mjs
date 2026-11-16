// "Scan my links": reads your GitHub, your site and your other links, and returns what it found.
// Nothing here changes your profile; the caller stores the result and works out strengths and suggestions.
import { readGithub, githubTarget } from './github.mjs';
import { readSites } from './sites.mjs';
import { pickBrowser, openBrowser } from './browser.mjs';

const clean = u => { const s = String(u || '').trim(); if (!s) return ''; const w = /^https?:\/\//i.test(s) ? s : `https://${s}`; try { return new URL(w).href; } catch { return ''; } };

/** Sorts a pile of links into the boxes they belong in. */
export function sortLinks(list = []) {
  const out = { github: '', linkedin: '', portfolio: '', other: [] };
  for (const raw of list) {
    const u = clean(raw); if (!u) continue; const h = new URL(u).hostname.replace(/^www\./, '');
    if (h === 'github.com' && !out.github && githubTarget(u) && !githubTarget(u).repo) out.github = u.replace(/\/$/, '');
    else if (/(^|\.)linkedin\.com$/.test(h) && /\/in\//.test(u) && !out.linkedin) out.linkedin = u.replace(/[?#].*$/, '').replace(/\/$/, '');
    else if (!out.portfolio && !/(^|\.)(github\.com|linkedin\.com|leetcode\.com|kaggle\.com|huggingface\.co|stackoverflow\.com|medium\.com|dev\.to|behance\.net|dribbble\.com|devpost\.com|gitlab\.com|x\.com|twitter\.com|instagram\.com|youtube\.com|codeforces\.com|codechef\.com|hackerrank\.com)$/.test(h)) out.portfolio = u;
    else if (!out.other.includes(u)) out.other.push(u);
  }
  return out;
}

/**
 * Reads everything. Returns { at, browser, github: { user, profile, repos, note } | null, sites: { pages, evidence, projects, notes } | null,
 * foundLinks: { portfolio?, linkedin?, github? }, notes: [] }.
 */
export async function scanLinks(p, { token = '', browserChoice = 'auto', onProgress = () => { }, log = () => { } } = {}) {
  const res = { at: new Date().toISOString(), browser: null, github: null, sites: null, foundLinks: {}, notes: [] };
  let browser = null, browserFailed = false;
  const getBrowser = async () => {
    if (browser || browserFailed) return browser;
    const b = await pickBrowser(browserChoice);
    if (!b) { browserFailed = true; res.notes.push(browserChoice === 'none' ? 'Pages that need JavaScript were read without a browser, as set in Settings.' : 'No browser Lookout can use was found, so pages that need JavaScript were read as plain downloads.'); return null; }
    try { browser = await openBrowser(b, { log }); res.browser = b.name; } catch (e) { browserFailed = true; res.notes.push(e.message); }
    return browser;
  };
  try {
    // 1. GitHub: your repositories, and the website on your GitHub profile if you didn't give one
    const target = githubTarget(p.github);
    let gh = null;
    if (target) {
      onProgress({ step: 'github', done: 0, total: 1, name: target.user });
      try { gh = await readGithub(target, { token, onProgress, log }); } catch (e) { res.notes.push(`GitHub: ${e.message}`); }
      if (gh?.note) res.notes.push(gh.note);
      if (gh?.profile?.blog && !p.portfolio) res.foundLinks.portfolio = clean(gh.profile.blog);
    } else if (p.github) res.notes.push('The GitHub link should look like github.com/your-name.');
    // 2. your site and other links
    const portfolio = clean(p.portfolio) || res.foundLinks.portfolio || '';
    const targets = [...(portfolio ? [{ url: portfolio, kind: 'portfolio' }] : []), ...(p.otherLinks || []).map(clean).filter(Boolean).map(url => ({ url, kind: 'other' }))];
    if (targets.length) {
      const s = await readSites(targets, { getBrowser, onProgress, log });
      res.sites = { pages: s.pages, evidence: s.evidence, projects: s.projects, notes: s.notes };
      res.notes.push(...s.notes);
      if (s.socials.linkedin && !p.linkedin) res.foundLinks.linkedin = s.socials.linkedin;
      if (s.socials.github && !p.github) res.foundLinks.github = s.socials.github;
      // repositories your site links to that aren't in your own account
      if (gh?.readRepos && s.repos.length) { onProgress({ step: 'github', done: 0, total: s.repos.length, name: 'projects from your site' }); await gh.readRepos(s.repos); }
    }
    if (gh) { const { readRepos, rate, ...rest } = gh; res.github = { ...rest, rateLeft: rate?.remaining ?? null, rateReset: rate?.reset ?? null }; for (const r of res.github.repos) delete r.readme; }
  } finally { await browser?.close(); }
  return res;
}
