// "Best match" learns what you go for. Roles you saved, applied to, contacted or interviewed for count for;
// roles you hid (and roles at companies you blocked) count against. A small logistic model is trained here,
// in your browser, whenever your pipeline changes: nothing leaves this computer, and it is cheap to redo.
//
// It looks at what a role is (field, stage, remote or not, visa, pay listed, funded company, how well your
// skills fit, years asked for), never at when it was posted, so it can't learn "I only save old roles".
import { fit, stagesOf, FIELDS } from './filters.mjs';

const SOFTWARE = FIELDS['Software & IT'];
const TOP = Object.keys(FIELDS);
const STAGE_KEYS = ['Internship', 'Entry', 'Mid', 'Senior', 'Part-time', 'Contract'];
export const FEATURES = [
  ['fit', 'roles that use more of your skills'], ['strong', 'roles that use skills your own work shows'], ['missing', 'roles that ask for many skills you don’t list'],
  ['funded', 'recently funded companies'], ['remote', 'remote roles'], ['hybrid', 'hybrid roles'], ['onsite', 'on-site roles'],
  ['sponsor', 'roles that sponsor visas'], ['noSponsor', 'roles that don’t sponsor visas'], ['citizens', 'citizens-only roles'], ['pay', 'roles that list pay'],
  ['years', 'roles that ask for more years of experience'], ['email', 'roles with a contact email'], ['corroborated', 'roles posted in several places'],
  ...STAGE_KEYS.map(s => [`stage:${s}`, { Internship: 'internships', Entry: 'entry-level roles', Mid: 'mid-level roles', Senior: 'senior roles', 'Part-time': 'part-time roles', Contract: 'contract roles' }[s]]),
  ...TOP.map(f => [`field:${f}`, `${f} roles`]), ...SOFTWARE.map(s => [`spec:${s}`, `${s} roles`]),
];
const INDEX = new Map(FEATURES.map(([k], i) => [k, i]));

export function features(j, profile) {
  const x = new Float64Array(FEATURES.length); const set = (k, v = 1) => { const i = INDEX.get(k); if (i !== undefined) x[i] = v; };
  const ft = fit(j, profile); const techN = ft.have.length + ft.missing.length;
  set('fit', ft.pct / 100); set('strong', ft.have.length ? ft.strong.length / ft.have.length : 0); set('missing', Math.min(1, ft.missing.length / 10));
  if (j.funded) set('funded');
  if (j.workMode === 'Remote') set('remote'); else if (j.workMode === 'Hybrid') set('hybrid'); else if (j.workMode === 'On-site') set('onsite');
  if (j.visa === 'Sponsors visa') set('sponsor'); else if (j.visa === 'No sponsorship') set('noSponsor'); else if (j.visa === 'Citizens / clearance only') set('citizens');
  if (j.pay || j.salary) set('pay');
  if (typeof j.yearsMin === 'number') set('years', Math.min(1, j.yearsMin / 6));
  if (j.emails?.length || j.contactCount) set('email');
  if ((j.sources?.length || 1) > 1) set('corroborated');
  for (const s of stagesOf(j)) set(`stage:${s === 'Apprenticeship' ? 'Internship' : s === 'Senior+' ? 'Senior' : s}`);
  if (j.field) set(`field:${j.field}`);
  if (j.specialty && SOFTWARE.includes(j.specialty)) set(`spec:${j.specialty}`);
  void techN; return x;
}

const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
const POSITIVE = new Set(['saved', 'applied', 'contacted', 'interview', 'rejected']);

/**
 * Trains on your actions. Returns null until there is enough to learn from (5 roles you went for, 15 actions in all),
 * else { w, b, pos, neg, confidence }.
 */
export function train(jobs, tracking = {}, profile = {}, blocked = []) {
  const byId = new Map(jobs.map(j => [j.id, j])); const rows = [];
  let pos = 0, neg = 0;
  for (const [id, t] of Object.entries(tracking)) {
    const j = byId.get(id); if (!j) continue;
    if (t.hidden) { rows.push([features(j, profile), 0, 1]); neg++; }
    else if (POSITIVE.has(t.status)) { rows.push([features(j, profile), 1, 1]); pos++; }
  }
  const blockedSet = new Set(blocked.map(b => String(b).toLowerCase()));
  if (blockedSet.size) for (const j of jobs) { if (neg >= pos * 2 + 10) break; if (blockedSet.has(String(j.company).toLowerCase()) && !tracking[j.id]) { rows.push([features(j, profile), 0, 0.5]); neg++; } }
  if (pos < 5 || pos + neg < 15) return { pos, neg, ready: false };
  // roles you never touched are mostly roles you passed over: a few of them count lightly against
  const want = Math.max(0, Math.min(400, pos * 3 - neg));
  if (want) { const pool = jobs.filter(j => !tracking[j.id]).sort((a, b) => hash(a.id) - hash(b.id)).slice(0, want); for (const j of pool) rows.push([features(j, profile), 0, 0.15]); }
  const F = FEATURES.length; const w = new Float64Array(F); let b = 0; const lr = 0.4, l2 = 0.02;
  const totalW = rows.reduce((a, r) => a + r[2], 0);
  for (let it = 0; it < 400; it++) {
    const gw = new Float64Array(F); let gb = 0;
    for (const [x, y, sw] of rows) { let z = b; for (let i = 0; i < F; i++) z += w[i] * x[i]; const p = 1 / (1 + Math.exp(-z)); const e = (p - y) * sw; for (let i = 0; i < F; i++) gw[i] += e * x[i]; gb += e; }
    for (let i = 0; i < F; i++) w[i] -= lr * (gw[i] / totalW + l2 * w[i]); b -= lr * gb / totalW;
  }
  return { ready: true, w: [...w], b, pos, neg, confidence: Math.min(1, (pos + neg) / 60) };
}

/** -1..1: how much more (or less) like the roles you go for this one is, scaled by how much there is to go on. */
export function learnedBoost(model, j, profile) {
  if (!model?.ready) return 0; const x = features(j, profile); let z = model.b; for (let i = 0; i < x.length; i++) z += model.w[i] * x[i];
  return (2 / (1 + Math.exp(-z)) - 1) * model.confidence;
}

/** What it has learned, in words: the strongest leanings either way. */
export function explain(model) {
  if (!model?.ready) return { toward: [], away: [] };
  const ranked = FEATURES.map(([k, label], i) => ({ k, label, w: model.w[i] })).filter(x => Math.abs(x.w) >= 0.25);
  return { toward: ranked.filter(x => x.w > 0).sort((a, b) => b.w - a.w).slice(0, 4).map(x => x.label), away: ranked.filter(x => x.w < 0).sort((a, b) => a.w - b.w).slice(0, 3).map(x => x.label) };
}
