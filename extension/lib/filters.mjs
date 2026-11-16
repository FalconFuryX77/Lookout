// Copied from public/filters.mjs by sync-shared.mjs. Edit the original, not this file.
import { skillInfo } from './skills.mjs';
// Shared by the browser UI and the server's alert matcher, so a saved filter set
// behaves identically in the list and in phone alerts.

export const AGE_MS = { '15m': 9e5, '1h': 36e5, '6h': 216e5, '24h': 864e5, '3d': 2592e5, '7d': 6048e5, '30d': 2592e6, all: Infinity };

export const FIELDS = {
  'Software & IT': ['AI / ML', 'Data Science', 'Data Engineering', 'Data Analytics', 'Frontend', 'Backend', 'Full-stack', 'Mobile', 'Software Engineering', 'DevOps / Cloud', 'Security', 'QA / Testing', 'Embedded / Firmware', 'IT & Support', 'Quant'],
  'Core Engineering': ['Hardware / Electrical', 'Mechanical', 'Robotics', 'Civil / Construction', 'Chemical / Materials', 'Aerospace', 'Manufacturing'],
  'Product & Design': ['Product', 'Design'],
  'Business': ['Sales', 'Marketing', 'Customer Success', 'Operations', 'Finance', 'HR / Recruiting', 'Legal'],
  'Science & Research': ['Research', 'Biotech / Life Sciences'],
  'Other': ['Other'],
};
// One either/or list instead of separate type and level filters (which were ANDed and cancelled each other out).
export const STAGES = ['Internship', 'Apprenticeship', 'Entry', 'Mid', 'Senior', 'Senior+', 'Part-time', 'Contract'];
/** Every stage tag a job carries: its career stage, plus Part-time / Contract when that applies. */
export function stagesOf(job) {
  const stage = job.type === 'Internship' || job.level === 'Intern' ? 'Internship' : job.type === 'Apprenticeship' ? 'Apprenticeship' : (job.level || 'Mid');
  return job.type === 'Part-time' || job.type === 'Contract' ? [stage, job.type] : [stage];
}
export const VISA = ['Sponsors visa', 'No sponsorship', 'Citizens / clearance only', 'Not stated'];
export const WORK_MODES = ['Remote', 'Hybrid', 'On-site', 'Not stated'];
export const DEGREES = ["Bachelor's", "Master's", 'PhD', 'No degree required'];
export const FUND_STAGES = ['YC', 'Pre-seed / Seed', 'Series A', 'Series B+', 'Raised (undisclosed)'];

export const EMPTY_FILTERS = {
  q: '', excludeQ: '', includeQ: '', age: 'all',
  fields: [], excludeFields: [], specialties: [], stages: [],
  expMin: null, expMax: null, expUnknown: true,
  visa: [], workModes: [], countries: [], degrees: [],
  payMin: null, payUnknown: true, terms: [],
  fundedOnly: false, fundStages: [], hasContact: false, hideTracked: false,
  sources: [], multiSource: false, skills: [], skillsAll: false, excludeCompanies: [], hideAgencies: false,
  // the "exclude" side of every option list (Field keeps its older name, excludeFields)
  notSpecialties: [], notStages: [], notVisa: [], notWorkModes: [], notCountries: [], notDegrees: [], notTerms: [], notFundStages: [], notSkills: [], notSources: [],
};
/** Option list -> the key holding its excluded values. Click once to include, again to exclude, again to clear. */
export const NOT_KEY = { fields: 'excludeFields', specialties: 'notSpecialties', stages: 'notStages', visa: 'notVisa', workModes: 'notWorkModes', countries: 'notCountries', degrees: 'notDegrees', terms: 'notTerms', fundStages: 'notFundStages', skills: 'notSkills', sources: 'notSources' };

export function normalizeFilters(f = {}) {
  const out = { ...EMPTY_FILTERS, ...f };
  // migrate v1 keys
  if (f.remoteOnly && !out.workModes.length) out.workModes = ['Remote'];
  if (f.categories?.length && !out.specialties.length && !out.fields.length) {
    const MAP = { 'AI / ML': ['AI / ML'], Data: ['Data Science', 'Data Engineering', 'Data Analytics'], Product: ['Product'], Design: ['Design'], 'Sales / Growth': ['Sales', 'Marketing'], Operations: ['Operations', 'Finance', 'HR / Recruiting'] };
    for (const c of f.categories) { if (c === 'Engineering') out.fields = [...new Set([...out.fields, 'Software & IT'])]; else out.specialties.push(...(MAP[c] || [])); }
  }
  // older saved views had separate type + level lists; fold them into the single either/or list
  const legacy = [...(f.types || []), ...(f.levels || [])].filter(x => x !== 'Full-time').map(x => x === 'Intern' ? 'Internship' : x);
  out.stages = [...new Set([...(out.stages || []), ...legacy])].filter(x => STAGES.includes(x));
  delete out.types; delete out.levels;
  delete out.remoteOnly; delete out.categories;
  for (const k of ['expMin', 'expMax', 'payMin']) { const v = out[k]; out[k] = v === '' || v === undefined || v === null || !Number.isFinite(Number(v)) ? null : Number(v); }
  return out;
}

/**
 * One freshness model for sort, labels, filters and counts:
 *  - exact source timestamp  → that time
 *  - date-only               → noon of that date (never "minutes ago")
 *  - undated, seen on a later poll → when Lookout first saw it, minus a day (ranks below dated roles)
 *  - undated, imported on a source's first pass → unknown (30 days back)
 */
export function freshness(job) {
  const p = Date.parse(job.postedAt || '');
  const f = Date.parse(job.firstSeen || '');
  if (Number.isFinite(p) && job.precision === 'minute') return { t: Math.min(p, Number.isFinite(f) ? f : p), kind: 'exact' };
  if (Number.isFinite(p)) return { t: Math.min(p + 12 * 36e5, Number.isFinite(f) ? Math.max(f, p) : p + 12 * 36e5), kind: 'date' };
  if (job.backfill) return { t: f - 30 * 864e5, kind: 'unknown' };
  return { t: f - 864e5, kind: 'seen' };
}
export const effectiveTime = job => freshness(job).t;

export function fundStageOf(job) {
  const l = job.funding?.label || '';
  if (!job.funded) return null;
  if (/^YC\b/.test(l)) return 'YC';
  if (/seed|angel/i.test(l)) return 'Pre-seed / Seed';
  if (/series a\b|pre-series/i.test(l)) return 'Series A';
  if (/series [b-f]|growth/i.test(l)) return 'Series B+';
  return 'Raised (undisclosed)';
}

// Tokens: "exact phrase", -not, a|b (spaces around | allowed).
function textClauses(q) {
  return (q.toLowerCase().replace(/\s*\|\s*/g, '|').match(/-?"[^"]+"(?:\|"[^"]+"|\|\S+)*|\S+/g) || []);
}
const skillName = s => (typeof s === 'string' ? s : s?.name) || '';
// Same haystack on server (alerts) and client (list): never the full description, which the client doesn't have.
const hayCache = new WeakMap();
function hayOf(job) { let h = hayCache.get(job); if (!h) { h = buildHay(job); hayCache.set(job, h); } return h; }
function buildHay(job) { return ` ${job.title} ${job.company} ${job.location} ${job.specialty} ${(job.skills || []).map(skillName).join(' ')} ${job.snippet ?? (job.description || '').slice(0, 220)} `.toLowerCase(); }
const reCache = new Map();
function wordRe(term) {
  let re = reCache.get(term);
  if (!re) { const e = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); re = new RegExp(`(?:^|[^a-z0-9+#])${e}(?:s|es|ship|ships|ing|ed|er|ers|al)?(?![a-z0-9+#])`, 'i'); reCache.set(term, re); if (reCache.size > 500) reCache.clear(); }
  return re;
}
const has = (hay, term) => wordRe(term).test(hay);
/** Does this text mention the word (also its plural and -ing/-ed/-ship forms)? */
export const mentionsIn = (text, term) => wordRe(term).test(String(text || ''));
/** The same check against what the list has for a role: title, company, place, role, skills and the opening lines. */
export const mentionsInSummary = (job, term) => has(hayOf(job), term);
const wordsOf = s => String(s || '').toLowerCase().split(/[,\n]/).map(x => x.trim()).filter(Boolean);
/** Every word a filter set searches whole postings for, for fetching full-text matches ahead of time. */
export const filterWords = f => [...new Set([...wordsOf(f?.excludeQ), ...wordsOf(f?.includeQ)])];
const SKILL_ALIAS = { golang: 'go', js: 'javascript', ts: 'typescript', k8s: 'kubernetes', postgres: 'postgresql', 'node': 'node.js', nodejs: 'node.js', reactjs: 'react', 'react.js': 'react', py: 'python', llm: 'llms', 'gcp': 'gcp', 'ml': 'machine learning' };
const skillKey = s => { const k = String(s).toLowerCase().trim(); return SKILL_ALIAS[k] || k; };
export const normCo = s => String(s || '').toLowerCase().replace(/\b(inc|llc|ltd|corp|co|gmbh|pvt|limited)\b\.?/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// Staffing agencies / talent marketplaces: no direct line to the hiring team.
export const AGENCY = /\b(raydar|weekday|fuku|clera|jobgether|crossover|turing|toptal|braintrust|andela|cybercoders|robert half|randstad|adecco|insight global|teksystems|kforce|apex systems|jobot|dice|hired|lensa|talentify|recruiting from scratch|launch potato|mercor|outlier|dataannotation|remotehunter|haystack)\b/i;

/** Each check knows which filter key it implements, so facet counts can be computed in one pass. */
function checks(f, ctx) {
  const now = ctx.now || Date.now(); const out = [];
  const add = (key, test) => out.push([key, test]);
  if (f.age && f.age !== 'all') {
    const win = AGE_MS[f.age] ?? Infinity;
    add('age', j => {
      const { t, kind } = freshness(j);
      if (win <= 216e5) return kind === 'exact' && now - t <= win;          // short windows need an exact timestamp
      if (kind === 'unknown') return false;
      return now - t <= win;
    });
  }
  if (f.fields.length) add('fields', j => f.fields.includes(j.field));
  if (f.excludeFields.length) add('fields', j => !f.excludeFields.includes(j.field));
  if (f.specialties.length) add('specialties', j => f.specialties.includes(j.specialty));
  if (f.stages.length) add('stages', j => stagesOf(j).some(s => f.stages.includes(s)));
  if (f.expMin !== null || f.expMax !== null) add('exp', j => {
    if (j.yearsMin === null || j.yearsMin === undefined) return f.expUnknown;
    if (f.expMax !== null && j.yearsMin > f.expMax) return false;                  // asks for more than I have
    if (f.expMin !== null && (j.yearsMax ?? j.yearsMin) < f.expMin) return false;  // too junior for what I want
    return true;
  });
  if (f.visa.length) add('visa', j => f.visa.includes(j.visa || 'Not stated'));
  if (f.workModes.length) add('workModes', j => f.workModes.includes(j.workMode || 'Not stated'));
  if (f.countries.length) add('countries', j => f.countries.includes(j.country) || (f.countries.includes('Remote (global)') && j.workMode === 'Remote' && (j.country === 'Remote (global)' || j.country === 'Unknown')));
  if (f.degrees.length) add('degrees', j => !j.degrees?.length || j.degrees.some(d => f.degrees.includes(d)));
  if (f.payMin !== null) add('pay', j => !j.pay ? f.payUnknown : (j.pay.max ?? j.pay.min) >= f.payMin);
  if (f.terms.length) add('terms', j => (j.terms || []).some(t => f.terms.includes(t)));
  if (f.fundedOnly) add('fundedOnly', j => !!j.funded);
  if (f.fundStages.length) add('fundStages', j => f.fundStages.includes(fundStageOf(j)));
  if (f.hasContact) add('hasContact', j => !!(j.emails?.length || j.contactCount));
  if (f.hideAgencies) add('hideAgencies', j => !j.middleman && !AGENCY.test(j.company));
  if (f.multiSource) add('sources', j => (j.sources?.length || 1) >= 2);
  if (f.sources.length) add('sources', j => j.sources.some(s => f.sources.includes(s.source)));
  if (f.excludeCompanies.length) { const ex = new Set(f.excludeCompanies.map(normCo)); add('excludeCompanies', j => !ex.has(normCo(j.company))); }
  if (f.skills.length) {
    const want = f.skills.map(skillKey);
    add('skills', j => { const have = new Set((j.skills || []).map(s => skillKey(skillName(s)))); return f.skillsAll ? want.every(s => have.has(s)) : want.some(s => have.has(s)); });
  }
  // Excluded options. Single-valued facets drop a role that has the value; multi-valued ones (degree, term,
  // source) drop it only when every value it has is excluded, since the role is still open to you otherwise.
  { const not = k => new Set(f[k] || []);
    if (f.notSpecialties.length) { const x = not('notSpecialties'); add('specialties', j => !x.has(j.specialty)); }
    if (f.notStages.length) { const x = not('notStages'); add('stages', j => !stagesOf(j).some(s => x.has(s))); }
    if (f.notVisa.length) { const x = not('notVisa'); add('visa', j => !x.has(j.visa || 'Not stated')); }
    if (f.notWorkModes.length) { const x = not('notWorkModes'); add('workModes', j => !x.has(j.workMode || 'Not stated')); }
    if (f.notCountries.length) { const x = not('notCountries'); add('countries', j => !x.has(j.country)); }
    if (f.notDegrees.length) { const x = not('notDegrees'); add('degrees', j => !(j.degrees?.length && j.degrees.every(d => x.has(d)))); }
    if (f.notTerms.length) { const x = not('notTerms'); add('terms', j => !(j.terms?.length && j.terms.every(t => x.has(t)))); }
    if (f.notFundStages.length) { const x = not('notFundStages'); add('fundStages', j => !x.has(fundStageOf(j))); }
    if (f.notSkills.length) { const x = new Set(f.notSkills.map(skillKey)); add('skills', j => !(j.skills || []).some(s => x.has(skillKey(skillName(s))))); }
    if (f.notSources.length) { const x = not('notSources'); add('sources', j => !(j.sources?.length && j.sources.every(s => x.has(s.source)))); } }
  if (f.hideTracked) add('hideTracked', j => !ctx.tracking?.[j.id]);
  if (!f.showHidden) add('_hidden', j => { const t = ctx.tracking?.[j.id]; return !(t?.hidden || t?.status === 'hidden'); });
  if (ctx.blocked?.size) add('_blocked', j => !ctx.blocked.has(normCo(j.company)));
  if (ctx.profile && ctx.profile.strictFit !== false && typeof ctx.profile.yearsExp === 'number') add('_fit', j => !overReach(j, ctx.profile));
  if (f.q) {
    const clauses = textClauses(f.q);
    add('q', j => {
      const hay = hayOf(j);
      for (const raw of clauses) {
        if (raw.startsWith('-') && raw.length > 1) { if (has(hay, raw.slice(1).replace(/"/g, ''))) return false; continue; }
        const alts = raw.split('|').map(x => x.replace(/"/g, '')).filter(Boolean);
        if (alts.length && !alts.some(a => has(hay, a))) return false;
      }
      return true;
    });
  }
  // Words to require or rule out are looked for in the whole posting. The server can read every description;
  // the app is handed those answers as ctx.mentions, and falls back to the role's summary for anything newer.
  { const ex = wordsOf(f.excludeQ), inc = wordsOf(f.includeQ); const said = ctx.mentions || mentionsInSummary;
    if (ex.length || inc.length) add('words', j => (!inc.length || inc.some(t => said(j, t))) && !ex.some(t => said(j, t))); }
  return out;
}

export function matches(job, f, ctx = {}) {
  for (const [, test] of checks(normalizeFilters(f), ctx)) if (!test(job)) return false;
  return true;
}

/**
 * One pass over all jobs: the matching list, plus for each filter key the jobs that would match
 * if that key alone were cleared (what facet counts need).
 */
export function evaluate(jobs, f, ctx = {}) {
  const cs = checks(normalizeFilters(f), ctx);
  const matched = []; const nearMiss = new Map(); // key -> jobs failing only that key
  for (const j of jobs) {
    let failKey = null, fails = 0;
    for (const [key, test] of cs) {
      if (failKey === key) continue;           // same key already failed (e.g. fields include + exclude)
      if (!test(j)) { fails++; if (fails > 1) break; failKey = key; }
    }
    if (!fails) matched.push(j);
    else if (fails === 1) { let a = nearMiss.get(failKey); if (!a) nearMiss.set(failKey, a = []); a.push(j); }
  }
  return { matched, nearMiss };
}

/**
 * A role that plainly wants more experience than the profile has: it states a minimum more than a year
 * above yours, or states none but is titled senior. Applied to every view and alert unless switched off.
 */
export function overReach(job, profile) {
  const y = profile?.yearsExp; if (typeof y !== 'number') return false;
  if (typeof job.yearsMin === 'number') return job.yearsMin > y + 1;
  if (job.level === 'Senior+') return y < 5;
  if (job.level === 'Senior') return y < 3;
  return false;
}

/** Relevance score used for "Best match" sorting. Higher = more actionable. */
export function score(job, profile = {}, now = Date.now()) {
  let s = 0;
  const ageH = (now - effectiveTime(job)) / 36e5;
  s += Math.max(0, 40 - Math.log2(1 + Math.max(0, ageH)) * 6);        // freshness
  if (job.funded) s += 15;                                             // recently funded company
  if (job.level === 'Intern' || job.level === 'Entry') s += 8;
  if (job.emails?.length || job.contactCount) s += 6;                  // reachable
  s += Math.min(6, (job.sources?.length || 1) - 1) * 2;               // corroborated by several sources
  const ft = fit(job, profile);
  s += ft.pct * 0.3;
  s -= Math.min(20, ft.expGap * 6);                                    // asks for more years than you have
  return s;
}

/**
 * How a role lines up with a profile. Technical skills decide the match; general ones ("Sales",
 * "Operations") only count when a role lists nothing technical.
 */
const mineCache = new WeakMap();
const canon = n => skillKey(skillInfo(n).canonical);
export function fit(job, profile = {}) {
  const list = profile.skills || []; let mine = mineCache.get(list);
  if (!mine) { mine = new Set(list.map(canon)); mineCache.set(list, mine); }
  const tech = [], general = [];
  for (const s of job.skills || []) { const n = skillName(s); (skillInfo(n).tech ? tech : general).push(n); }
  const has = n => mine.has(canon(n));
  const have = tech.filter(has), missing = tech.filter(n => !has(n)), genHave = general.filter(has);
  // After "Scan my links", skills your own work shows count fully; ones only listed count a little less.
  const str = profile.strength && Object.keys(profile.strength).length ? profile.strength : null;
  const weight = n => { if (!str) return 1; const v = str[canon(n)]; return v == null ? 0.9 : v >= 0.75 ? 1 : v >= 0.45 ? 0.9 : 0.75; };
  const strong = str ? have.filter(n => (str[canon(n)] ?? 0) >= 0.75) : [];
  let pct = 0;
  if (mine.size && tech.length) pct = Math.round(100 * Math.min(1, have.reduce((a, n) => a + weight(n), 0) / Math.min(tech.length, 8)));
  else if (mine.size && general.length) pct = Math.round(60 * Math.min(1, genHave.length / Math.min(general.length, 8)));
  const y = profile.yearsExp, need = job.yearsMin;
  const expGap = typeof y === 'number' && typeof need === 'number' ? Math.max(0, need - y) : 0;
  return { pct, have, missing, general, genHave, expGap, strong };
}
/** 0-100: how much of what the role asks for you have. */
export function skillMatch(job, mine = []) { return fit(job, { skills: mine }).pct; }
