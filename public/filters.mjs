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
export const TYPES = ['Internship', 'Full-time', 'Part-time', 'Contract', 'Apprenticeship'];
export const LEVELS = ['Intern', 'Entry', 'Mid', 'Senior', 'Senior+'];
export const VISA = ['Sponsors visa', 'No sponsorship', 'Citizens / clearance only', 'Not stated'];
export const WORK_MODES = ['Remote', 'Hybrid', 'On-site', 'Not stated'];
export const DEGREES = ["Bachelor's", "Master's", 'PhD', 'No degree required'];
export const FUND_STAGES = ['YC', 'Pre-seed / Seed', 'Series A', 'Series B+', 'Raised (undisclosed)'];

export const EMPTY_FILTERS = {
  q: '', excludeQ: '', age: 'all',
  fields: [], excludeFields: [], specialties: [], types: [], levels: [],
  expMin: null, expMax: null, expUnknown: true,
  visa: [], workModes: [], countries: [], degrees: [],
  payMin: null, payUnknown: true, terms: [],
  fundedOnly: false, fundStages: [], hasContact: false, hideTracked: false,
  sources: [], multiSource: false, skills: [], skillsAll: false, excludeCompanies: [], hideAgencies: false,
};

export function normalizeFilters(f = {}) {
  const out = { ...EMPTY_FILTERS, ...f };
  // migrate v1 keys
  if (f.remoteOnly && !out.workModes.length) out.workModes = ['Remote'];
  if (f.categories?.length && !out.specialties.length && !out.fields.length) {
    const MAP = { 'AI / ML': ['AI / ML'], Data: ['Data Science', 'Data Engineering', 'Data Analytics'], Product: ['Product'], Design: ['Design'], 'Sales / Growth': ['Sales', 'Marketing'], Operations: ['Operations', 'Finance', 'HR / Recruiting'] };
    for (const c of f.categories) { if (c === 'Engineering') out.fields = [...new Set([...out.fields, 'Software & IT'])]; else out.specialties.push(...(MAP[c] || [])); }
  }
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
  if (f.types.length) add('types', j => f.types.includes(j.type));
  if (f.levels.length) add('levels', j => f.levels.includes(j.level));
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
  if (f.hideAgencies) add('hideAgencies', j => !AGENCY.test(j.company));
  if (f.multiSource) add('sources', j => (j.sources?.length || 1) >= 2);
  if (f.sources.length) add('sources', j => j.sources.some(s => f.sources.includes(s.source)));
  if (f.excludeCompanies.length) { const ex = new Set(f.excludeCompanies.map(normCo)); add('excludeCompanies', j => !ex.has(normCo(j.company))); }
  if (f.skills.length) {
    const want = f.skills.map(skillKey);
    add('skills', j => { const have = new Set((j.skills || []).map(s => skillKey(skillName(s)))); return f.skillsAll ? want.every(s => have.has(s)) : want.some(s => have.has(s)); });
  }
  if (f.hideTracked) add('hideTracked', j => !ctx.tracking?.[j.id]);
  if (!f.showHidden) add('_hidden', j => { const t = ctx.tracking?.[j.id]; return !(t?.hidden || t?.status === 'hidden'); });
  if (ctx.blocked?.size) add('_blocked', j => !ctx.blocked.has(normCo(j.company)));
  if (f.q || f.excludeQ) {
    const clauses = textClauses(f.q); const ex = f.excludeQ.toLowerCase().split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    add('q', j => {
      const hay = hayOf(j);
      for (const raw of clauses) {
        if (raw.startsWith('-') && raw.length > 1) { if (has(hay, raw.slice(1).replace(/"/g, ''))) return false; continue; }
        const alts = raw.split('|').map(x => x.replace(/"/g, '')).filter(Boolean);
        if (alts.length && !alts.some(a => has(hay, a))) return false;
      }
      for (const raw of ex) if (has(hay, raw)) return false;
      return true;
    });
  }
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

/** Relevance score used for "Best match" sorting. Higher = more actionable. */
export function score(job, profile = {}, now = Date.now()) {
  let s = 0;
  const ageH = (now - effectiveTime(job)) / 36e5;
  s += Math.max(0, 40 - Math.log2(1 + Math.max(0, ageH)) * 6);        // freshness
  if (job.funded) s += 15;                                             // recently funded company
  if (job.level === 'Intern' || job.level === 'Entry') s += 8;
  if (job.emails?.length || job.contactCount) s += 6;                  // reachable
  s += Math.min(6, (job.sources?.length || 1) - 1) * 2;               // corroborated by several sources
  s += skillMatch(job, profile.skills || []) * 0.3;
  return s;
}

/** 0-100: share of the job's listed skills you have (weighted toward requirement coverage). */
export function skillMatch(job, mine = []) {
  if (!mine.length || !job.skills?.length) return 0;
  const have = new Set(mine.map(x => x.toLowerCase()));
  const hit = job.skills.filter(x => have.has(skillName(x).toLowerCase())).length;
  return Math.round(100 * hit / Math.min(job.skills.length, 8));
}
