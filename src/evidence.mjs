// Turns everything known about a person's skills into one strength per skill (0..1), a short reason for it,
// suggestions for skills their work shows but their profile doesn't list, and the projects found.
//
//   claims   your résumé (0.5), typed by you (0.6), your LinkedIn PDF (0.45), a profile page via the extension (0.35)
//   code     each repository that uses it: its language share, a library it depends on, a tell-tale file,
//            counted less the longer ago the repository was last updated (half as much after 18 months)
//   sites    listed under "Skills" on your site (0.4), named elsewhere on it (0.15), on another profile page (0.25)
//
// Pieces of evidence add up like independent chances: 1 - (1 - a)(1 - b)... so more evidence means stronger,
// never more than 1. Strong is 0.75 and up, working 0.45 and up, below that familiar.
import { skillInfo } from '../public/skills.mjs';

const key = n => skillInfo(n).canonical.toLowerCase();
const orAll = ws => 1 - ws.reduce((p, w) => p * (1 - Math.max(0, Math.min(0.95, w))), 1);
const monthsSince = iso => iso ? Math.max(0, (Date.now() - Date.parse(iso)) / (30.4 * 864e5)) : 0;
const recency = iso => iso ? Math.max(0.3, Math.pow(0.5, monthsSince(iso) / 18)) : 1;
export const levelOf = s => s >= 0.75 ? 'strong' : s >= 0.45 ? 'working' : 'familiar';
const CODE_KINDS = new Set(['language', 'package', 'file']);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Recomputes strength, notes, suggestions and projects for a profile. Returns the fields to store on it. */
export function weighSkills(p = {}) {
  const items = new Map(); // key -> { name, claim: [], code: Map(repo -> [w]), site: [], why: {...} }
  const get = name => { const k = key(name); if (!items.has(k)) items.set(k, { name: skillInfo(name).canonical, claim: [], code: new Map(), site: [], repos: { language: new Set(), main: new Set(), package: new Set(), file: new Set(), mention: new Set() }, hosts: new Set(), claims: new Set() }); return items.get(k); };
  const mine = new Set((p.skills || []).map(key)); const typed = new Set((p.manualSkills || []).map(key));
  const fromResume = new Set((p.resumeSkills || []).map(key)); const accepted = new Set((p.acceptedSkills || []).map(key));
  const fromLinkedin = new Set((p.linkedinSkills || []).map(key)); const fromPages = new Map((p.pageSkills || []).map(x => [key(x.name), x]));
  for (const s of p.skills || []) { const it = get(s); const k = key(s); const before = it.claim.length;
    if (typed.has(k)) { it.claim.push(0.6); it.claims.add('added by you'); }
    if (fromResume.has(k)) { it.claim.push(0.5); it.claims.add('your résumé'); }
    if (fromLinkedin.has(k)) { it.claim.push(0.45); it.claims.add('your LinkedIn'); }
    if (fromPages.has(k)) { it.claim.push(0.35); it.claims.add(`your ${fromPages.get(k).site} page`); }
    if (accepted.has(k)) { it.claim.push(0.4); it.claims.add('accepted from your links'); }
    if (it.claim.length === before) { it.claim.push(0.5); it.claims.add('your profile'); } // saved before Lookout kept track of where skills came from
  }
  for (const x of p.linkedinSkills || []) if (!mine.has(key(x))) { const it = get(x); it.site.push(0.45); it.claims.add('your LinkedIn'); }
  for (const x of p.pageSkills || []) if (!mine.has(key(x.name))) { const it = get(x.name); it.site.push(0.35); it.hosts.add(x.site); }
  const scan = p.scan || {};
  for (const r of scan.github?.repos || []) {
    const rec = recency(r.pushedAt) * (r.sizeKB < 30 ? 0.6 : 1);
    for (const e of r.evidence || []) {
      const it = get(e.skill); const list = it.code.get(r.name) || []; list.push(e.weight * rec); it.code.set(r.name, list);
      if (e.kind === 'language') { it.repos.language.add(r.name); if (/main|^([5-9]\d|100)%/.test(e.detail)) it.repos.main.add(r.name); }
      else if (CODE_KINDS.has(e.kind)) it.repos[e.kind].add(r.name); else it.repos.mention.add(r.name);
    }
  }
  for (const e of scan.sites?.evidence || []) { const it = get(e.skill); it.site.push(e.weight); it.hosts.add(e.where); }

  const strength = {}, notes = {}, suggestions = [];
  const ignored = new Set((p.ignoredSkills || []).map(key));
  for (const [k, it] of items) {
    if (!skillInfo(it.name).tech && !mine.has(k)) continue; // only technical skills are suggested
    // within one repository, kinds of evidence add up but cap at that repository's best case
    const perRepo = [...it.code.values()].map(ws => Math.min(0.6, orAll(ws)));
    const code = orAll(perRepo), site = orAll(it.site), claim = orAll(it.claim);
    const total = Math.round(orAll([claim, code, site]) * 100) / 100;
    const why = [];
    if (it.repos.main.size) why.push(`main language in ${plural(it.repos.main.size, 'repo')}`);
    else if (it.repos.language.size) why.push(`written in ${plural(it.repos.language.size, 'repo')}`);
    if (it.repos.package.size) why.push(`used as a library in ${plural(it.repos.package.size, 'repo')}`);
    if (it.repos.file.size && !it.repos.package.size) why.push(`set up in ${plural(it.repos.file.size, 'repo')}`);
    if (!it.repos.language.size && !it.repos.package.size && !it.repos.file.size && it.repos.mention.size) why.push(`mentioned in ${plural(it.repos.mention.size, 'README')}`);
    if (it.hosts.size) why.push(`on ${[...it.hosts].slice(0, 2).join(', ')}`);
    for (const c of it.claims) why.push(c === 'added by you' || c.startsWith('accepted') ? c : `on ${c}`);
    const note = why.join(' · ');
    if (mine.has(k)) { strength[k] = total; notes[k] = note; continue; }
    if (ignored.has(k)) continue;
    // suggest only what real work shows: code in a repository, a skills list, or a profile page, not a passing mention
    const solid = it.repos.language.size || it.repos.package.size || it.repos.file.size || it.site.some(w => w >= 0.35) || it.repos.mention.size >= 3;
    if (solid && total >= 0.25) suggestions.push({ name: it.name, strength: total, level: levelOf(total), why: note });
  }
  suggestions.sort((a, b) => b.strength - a.strength);

  // projects: your most substantial recent repositories, then live demos from your site
  const repoScore = r => recency(r.pushedAt) * Math.log10(10 + (r.sizeKB || 0)) * (1 + Math.log2(1 + (r.stars || 0)));
  const projects = (scan.github?.repos || []).filter(r => (r.sizeKB || 0) >= 20 || r.stars).sort((a, b) => repoScore(b) - repoScore(a)).slice(0, 8).map(r => {
    const by = new Map(); for (const e of r.evidence || []) if (CODE_KINDS.has(e.kind)) by.set(skillInfo(e.skill).canonical, Math.max(by.get(skillInfo(e.skill).canonical) || 0, e.weight));
    return { name: r.name, url: r.url, about: r.description || '', at: r.pushedAt, stack: [...by].sort((a, b) => b[1] - a[1]).map(x => x[0]).filter(n => !['Bash', 'HTML', 'CSS', 'CI/CD'].includes(n)).slice(0, 7) };
  });
  for (const d of scan.sites?.projects || []) if (d.kind === 'demo' && !projects.some(x => x.url === d.url)) projects.push({ name: d.name, url: d.url, about: 'live demo', at: null, stack: d.stack || [] });
  // strengths only change ranking once something beyond the résumé is known (a scan, LinkedIn, a profile page)
  const informed = !!(scan.at || (p.linkedinSkills || []).length || (p.pageSkills || []).length);
  return { strength: informed ? strength : {}, skillNotes: informed ? notes : {}, suggestions: suggestions.slice(0, 40), projectsFound: projects.slice(0, 12) };
}
