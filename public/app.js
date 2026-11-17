import { skillInfo, SKILL_GROUPS } from './skills.mjs';
import { linkRank } from './links.mjs';
import { train, learnedBoost, explain } from './rank.mjs';
const linkKind = (u, co) => ['copy', 'site', 'near', 'direct'][Math.max(0, linkRank(u, co))];
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
import { NOT_KEY, filterWords, mentionsInSummary } from './filters.mjs';
import { matches, evaluate, freshness, score, skillMatch, fit, effectiveTime, normalizeFilters, normCo, EMPTY_FILTERS, FIELDS, STAGES, stagesOf, VISA, WORK_MODES, DEGREES, FUND_STAGES, AGE_MS } from './filters.mjs';

// ───────────────────────────────────────────── utilities
const $ = s => document.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = async (url, opt = {}) => { const r = await fetch(url, { ...opt, headers: { 'content-type': 'application/json' } }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || r.statusText); return d; };
const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } } };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const fmt = n => Number(n || 0).toLocaleString();

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  kanban: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7v7M12 7v4M16 7v9"/>',
  radar: '<path d="M19.07 4.93A10 10 0 0 0 6.99 3.34"/><path d="M2.29 9.62A10 10 0 1 0 21.31 8.35"/><path d="M16.24 7.76A6 6 0 1 0 8.23 16.67"/><path d="M17.99 11.66A6 6 0 0 1 15.77 16.67"/><circle cx="12" cy="12" r="2"/><path d="m13.41 10.59 5.66-5.66"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sliders: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>', check: '<path d="M20 6 9 17l-5-5"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  eyeoff: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7l10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  arrowup: '<path d="m5 12 7-7 7 7M12 19V5"/>', globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/>',
  enter: '<path d="M9 10 4 15l5 5"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>', ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  sort: '<path d="m21 16-4 4-4-4M17 20V4M3 8l4-4 4 4M7 4v16"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
};
const ic = n => `<i data-i="${n}"><svg viewBox="0 0 24 24">${ICONS[n] || ''}</svg></i>`;
function hydrateIcons(root = document) { for (const el of $$('i[data-i]:not(:has(svg))', root)) el.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[el.dataset.i] || ''}</svg>`; }

function ago(t) {
  if (!Number.isFinite(t)) return '—';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return 'now'; if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`; if (s < 86400) return `${Math.round(s / 3600)}h`;
  const d = Math.round(s / 86400); return d < 45 ? `${d}d` : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
const agoLong = t => { const a = ago(t); return a === 'now' ? 'just now' : /\d$/.test(a) ? a : `${a} ago`; };
// One freshness model (see filters.mjs): exact → "12m"; date-only → "today"/"Nov 14"; undated → "seen 12m".
function dayLabel(iso) {
  const d = new Date(iso); const today = new Date(); const y = new Date(Date.now() - 864e5);
  const same = (a, b) => a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
  return same(d, today) ? 'today' : same(d, y) ? 'yesterday' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
const when = j => { const { t, kind } = freshness(j); return kind === 'exact' ? ago(t) : kind === 'date' ? dayLabel(j.postedAt) : kind === 'seen' ? `seen ${ago(Date.parse(j.firstSeen))}` : 'undated'; };
const whenLong = j => { const { t, kind } = freshness(j); return kind === 'exact' ? agoLong(t) : kind === 'date' ? `${dayLabel(j.postedAt)} (date only)` : kind === 'seen' ? `Not stated · first seen ${agoLong(Date.parse(j.firstSeen))}` : 'Not stated'; };
const isHot = j => { const { t, kind } = freshness(j); return kind === 'exact' && Date.now() - t < 36e5; };
// Remember which domains have no icon so we stop requesting them (and the list stops flickering).
const logoFail = new Set(ls.get('lk2.nologo', []));
window.__logoFail = d => { logoFail.add(d); if (logoFail.size % 10 === 0) ls.set('lk2.nologo', [...logoFail].slice(-3000)); };
function logo(name, domain, cls = 'logo') {
  const l = esc((String(name || '?').match(/[A-Za-z0-9]/)?.[0] || '?').toUpperCase());
  if (!domain || logoFail.has(domain)) return `<div class="${cls}">${l}</div>`;
  return `<div class="${cls}" data-l="${l}"><img src="https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico" alt="" width="18" height="18" decoding="async" loading="lazy" onerror="__logoFail('${esc(domain)}');this.parentNode.textContent=this.parentNode.dataset.l" onload="if(this.naturalWidth<8){__logoFail('${esc(domain)}');this.parentNode.textContent=this.parentNode.dataset.l}"></div>`;
}
function locShort(j) {
  const loc = j.location || (j.country && j.country !== 'Unknown' ? j.country : '');
  const parts = loc.split(/;|\|/).map(s => s.trim()).filter(Boolean);
  return parts.length > 2 ? `${parts[0]} +${parts.length - 1}` : loc;
}
function years(j) {
  if (j.yearsMin === null || j.yearsMin === undefined) return '';
  if (j.yearsMax !== null && j.yearsMax !== undefined && j.yearsMax !== j.yearsMin) return `${j.yearsMin}–${j.yearsMax} yrs`;
  return j.yearsMin === 0 ? 'No experience needed' : `${j.yearsMin}+ yrs`;
}
// Show only pay we could parse, normalized ("$120–150K/yr"); Indian CTC strings are shown as written.
const payStr = j => {
  if (j.pay) { const { min, max } = j.pay; return `$${min}${max && max !== min ? `–${max}` : ''}K/yr`; }
  return j.salary && /(lpa|lakh|crore|₹)/i.test(j.salary) ? j.salary.replace(/\s+/g, ' ').slice(0, 24) : '';
};
const visaShort = { 'Sponsors visa': ['Sponsors visa', 'good'], 'No sponsorship': ['No sponsorship', 'warn'], 'Citizens / clearance only': ['Citizens only', 'warn'] };
const FIELD_LABEL = { 'Core Engineering': 'Hardware & physical eng.' };
const LEVEL_LABEL = { 'Senior+': 'Lead / Principal', Entry: 'Entry / new grad', Mid: 'Mid / not stated' };
const fl$ = x => FIELD_LABEL[x] || x; const lv$ = x => LEVEL_LABEL[x] || x; const st$ = lv$;
const srcName = id => S.meta?.sources.find(s => s.id === id)?.name || { ats: 'Company careers site', browser: 'Saved from your browser' }[id] || id;
const profile = () => S.meta?.settings?.profile || {};

// toasts
function toast(msg, { undo, action, live, ms = 7000 } = {}) {
  const t = document.createElement('div'); t.className = 'toast';
  const act = undo ? ['Undo', undo] : action;
  t.innerHTML = `${live ? '<span class="live-dot"></span>' : ''}<span>${esc(msg)}</span>${act ? `<button>${esc(act[0])}</button>` : ''}`;
  if (act) t.querySelector('button').onclick = () => { act[1](); t.remove(); };
  let left = ms, started = Date.now(), timer;
  const arm = () => { started = Date.now(); timer = setTimeout(() => t.remove(), left); };
  t.onmouseenter = () => { clearTimeout(timer); left -= Date.now() - started; };
  t.onmouseleave = arm;
  $('#toasts').append(t); arm();
}
// number ticker
function tickTo(el, to) {
  const from = Number(el.dataset.v || 0); el.dataset.v = to;
  if (from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), d = 420;
  const step = now => { const p = Math.min(1, (now - t0) / d); const e = 1 - Math.pow(1 - p, 3); el.textContent = fmt(Math.round(from + (to - from) * e)); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

// ───────────────────────────────────────────── state
const S = {
  jobs: [], meta: null, view: 'jobs',
  filters: normalizeFilters({}), // every launch starts with everything; saved views are one click away
  activeView: null, sort: ls.get('lk2.sort', 'new'),
  sel: null, limit: 150, pending: [], sigSeg: 'news', openSecs: new Set(ls.get('lk2.secs', ['age', 'field', 'exp', 'visa'])),
};
let blockedCache = { src: null, set: new Set() };
// "Only roles mentioning" / "Hide roles mentioning" search whole postings, which only the scanner holds.
// It answers once per word (and again for roles that arrive later); until then a role's summary is used.
const mentionCache = new Map(); // word -> { hits: Set of ids, covered: Set of ids }
const mentionsFn = (j, t) => { const e = mentionCache.get(t); return e && e.covered.has(j.id) ? e.hits.has(j.id) : mentionsInSummary(j, t); };
async function syncMentions(ids) {
  const words = new Set(filterWords(S.filters)); for (const v of S.meta?.filterSets || []) for (const w of filterWords(v.filters)) words.add(w);
  const need = ids ? [...words] : [...words].filter(w => !mentionCache.has(w));
  if (!need.length || (ids && !ids.length)) return false;
  try {
    const r = await api('/api/mentions', { method: 'POST', body: JSON.stringify({ terms: need, ...(ids ? { ids } : {}) }) });
    for (const t of need) { const e = mentionCache.get(t) || { hits: new Set(), covered: new Set() }; for (const id of r.terms[t] || []) e.hits.add(id); for (const id of r.ids) e.covered.add(id); mentionCache.set(t, e); }
    evCache = null; return true;
  } catch { return false; }
}
const ctx = () => {
  const b = S.meta?.blockedCompanies || [];
  if (blockedCache.src !== b) blockedCache = { src: b, set: new Set(b.map(normCo)) };
  return { tracking: S.meta?.tracking || {}, blocked: blockedCache.set, profile: S.meta?.settings?.profile, mentions: mentionsFn };
};
function setFilters(patch, { keepView = false } = {}) {
  S.filters = normalizeFilters({ ...S.filters, ...patch });
  if (!keepView) { const v = S.meta?.filterSets.find(x => x.id === S.activeView); if (v && JSON.stringify(normalizeFilters(v.filters)) !== JSON.stringify(S.filters)) { /* view modified */ } }
  ls.set('lk2.filters', S.filters); ls.set('lk2.view', S.activeView); S.limit = 150;
  if ($('#q').value.trim() !== (S.filters.q || '') && document.activeElement !== $('#q')) $('#q').value = S.filters.q || ''; // keep box and chip in sync
  refreshJobs();
  if (filterWords(S.filters).some(w => !mentionCache.has(w))) syncMentions().then(ok => ok && refreshJobs());
}
// List first (what the user is looking at); counters right after, off the critical path.
const deferred = debounce(() => { renderQuick(); renderViews(); }, 60);
const refreshJobs = () => { renderChips(); renderList(); deferred(); if ($('#sheet').classList.contains('open')) renderSheetDebounced(); };

// ───────────────────────────────────────────── filtering
// One cached pass gives the list and every facet count; invalidated whenever the list re-renders.
let evCache = null;
const ev = () => (evCache ||= evaluate(S.jobs, S.filters, ctx()));
// Best match learns from your pipeline; retrained only when what you saved, applied to or hid changes.
let learned = null, learnedSig = '';
function model() {
  if (!S.meta || S.meta.learn === false) return null;
  const t = S.meta.tracking || {}; const sig = `${S.jobs.length > 0}|${(profile().skills || []).length}|${Object.entries(t).map(([k, v]) => `${k}:${v.status}:${v.hidden ? 1 : 0}`).sort().join(',')}|${(S.meta.blockedCompanies || []).length}`;
  if (sig !== learnedSig) { learnedSig = sig; learned = train(S.jobs, t, profile(), S.meta.blockedCompanies || []); }
  return learned?.ready ? learned : null;
}
function filtered() {
  const out = [...ev().matched];
  if (S.sort === 'best') { const p = profile(); const now = Date.now(); const m = model(); const tr = S.meta?.tracking || {}; const done = id => { const st = tr[id]?.status; return st && st !== 'saved' ? 1000 : 0; }; const sc = new Map(out.map(j => [j.id, score(j, p, now) + learnedBoost(m, j, p) * 20 - done(j.id)])); out.sort((a, b) => sc.get(b.id) - sc.get(a.id)); }
  else out.sort((a, b) => effectiveTime(b) - effectiveTime(a));
  return out;
}
// Facet counts = jobs that match everything + jobs that fail only this facet (from the same pass).
function countsFor(key, valuesOf) {
  const { matched, nearMiss } = ev(); const m = new Map();
  for (const list of [matched, nearMiss.get(key) || []]) for (const j of list) for (const v of [].concat(valuesOf(j))) if (v !== null && v !== undefined && v !== '') m.set(v, (m.get(v) || 0) + 1);
  return m;
}
const skillN = s => (typeof s === 'string' ? s : s?.name) || '';
function activeCount(f = S.filters) {
  let n = 0;
  for (const [k, v] of Object.entries(f)) {
    if (['expUnknown', 'payUnknown', 'skillsAll'].includes(k)) continue;
    if (Array.isArray(v) ? v.length : k === 'age' ? v !== 'all' : (k === 'expMin' || k === 'expMax' || k === 'payMin') ? v !== null : typeof v === 'string' ? v.trim() : v) n++;
  }
  if (f.expMin !== null && f.expMax !== null) n--;
  return n;
}

// ───────────────────────────────────────────── chips + quick stats
const AGE_LABEL = { '15m': 'Last 15 min', '1h': 'Last hour', '6h': 'Last 6 hours', '24h': 'Last 24 hours', '3d': 'Last 3 days', '7d': 'Last 7 days', '30d': 'Last 30 days', all: 'Any time' };
function chipList(f = S.filters) {
  const out = []; const join = a => a.length > 2 ? `${a.slice(0, 2).join(', ')} +${a.length - 2}` : a.join(', ');
  // k/v are the full description (tooltips, "save view" summary); short is what the chip shows.
  const add = (id, k, v, clear, o = {}) => out.push({ id, k, v, clear, short: o.short ?? v, neg: !!o.neg });
  const arr = (id, k, map = x => x) => { if (f[id].length) add(id, k, join(f[id].map(map)), { [id]: [] }); };
  if (f.q) add('q', 'Search', f.q, { q: '' }, { short: `“${f.q}”` });
  if (f.age !== 'all') add('age', 'Posted', AGE_LABEL[f.age], { age: 'all' });
  arr('fields', 'Field', fl$);
  if (f.excludeFields.length) add('excludeFields', 'Not', join(f.excludeFields.map(fl$)), { excludeFields: [] }, { neg: true, short: `No ${join(f.excludeFields.map(fl$))}` });
  arr('specialties', 'Role'); arr('stages', 'Stage', st$);
  if (f.expMin !== null || f.expMax !== null) add('exp', 'Experience', `${f.expMin ?? 0}–${f.expMax === null ? '10+' : f.expMax} yrs${f.expUnknown ? '' : ', stated only'}`, { expMin: null, expMax: null, expUnknown: true });
  arr('visa', 'Visa'); arr('workModes', 'Mode'); arr('countries', 'Location', c => c === 'Unknown' ? 'Not stated' : c); arr('degrees', 'Degree');
  if (f.payMin !== null) add('pay', 'Pay', `≥ $${f.payMin}k/yr${f.payUnknown ? ' or unlisted' : ''}`, { payMin: null, payUnknown: true }, { short: `≥ $${f.payMin}k` });
  arr('terms', 'Term');
  if (f.fundedOnly) add('fundedOnly', 'Company', 'Recently funded', { fundedOnly: false }, { short: 'Funded' });
  arr('fundStages', 'Stage');
  if (f.skills.length) add('skills', f.skillsAll ? 'All skills' : 'Any skill', join(f.skills), { skills: [] });
  arr('sources', 'Source', srcName);
  if (f.multiSource) add('multiSource', 'Seen on', '2+ sources', { multiSource: false });
  if (f.hasContact) add('hasContact', 'Contact', 'Has email', { hasContact: false });
  if (f.hideAgencies) add('hideAgencies', 'Agencies', 'Hidden', { hideAgencies: false }, { neg: true, short: 'No agencies' });
  if (f.hideTracked) add('hideTracked', 'Tracked', 'Hidden', { hideTracked: false }, { short: 'Untracked only' });
  for (const [k, nk] of Object.entries(NOT_KEY)) {
    if (k === 'fields' || !f[nk]?.length) continue;
    const map = { stages: st$, countries: c => c === 'Unknown' ? 'Location not stated' : c, sources: srcName }[k] || (x => x);
    const label = { specialties: 'Role', stages: 'Stage', visa: 'Visa', workModes: 'Mode', countries: 'Location', degrees: 'Degree', terms: 'Term', fundStages: 'Funding', skills: 'Skill', sources: 'Source' }[k];
    add(nk, `Not ${label.toLowerCase()}`, join(f[nk].map(map)), { [nk]: [] }, { neg: true, short: `No ${join(f[nk].map(map))}` });
  }
  if (f.includeQ.trim()) add('includeQ', 'Mentions', f.includeQ, { includeQ: '' }, { short: `Has “${f.includeQ.trim().slice(0, 24)}”` });
  if (f.excludeQ.trim()) add('excludeQ', 'Exclude', f.excludeQ, { excludeQ: '' }, { neg: true, short: `No “${f.excludeQ.trim().slice(0, 24)}”` });
  if (f.excludeCompanies.length) add('excludeCompanies', 'Hidden companies', join(f.excludeCompanies), { excludeCompanies: [] }, { neg: true, short: `No ${join(f.excludeCompanies)}` });
  return out;
}
function renderChips() {
  const lit = new Set(QUICK.filter(q => q.on(S.filters)).map(q => q.key)); // already shown as a lit quick toggle
  const all = chipList(); const chips = all.filter(c => !lit.has(c.id));
  $('#chips').innerHTML = chips.map((c, i) => `<span class="chip ${c.neg ? 'neg' : ''}" title="${esc(c.k)}: ${esc(c.v)}"><span class="v">${esc(c.short)}</span><button data-chip="${i}" aria-label="Remove ${esc(c.k)} filter">${ic('x')}</button></span>`).join('')
    + (all.length ? '<button class="link clear" id="clearAll">Clear</button>' : '');
  $$('[data-chip]').forEach(b => b.onclick = () => { const c = chips[+b.dataset.chip].clear; if ('q' in c) $('#q').value = ''; setFilters(c); });
  $('#clearAll')?.addEventListener('click', () => { S.activeView = null; $('#q').value = ''; setFilters({ ...EMPTY_FILTERS }); });
  $('#fCount').textContent = activeCount() || '';
  const v = S.meta?.filterSets.find(x => x.id === S.activeView);
  $('#viewTitle').textContent = v ? v.name : 'Jobs';
}
// Toggling a time quick-filter off restores whatever window you had before.
function ageToggle(f, v) { if (f.age === v) return { age: S.prevAge && S.prevAge !== v ? S.prevAge : 'all' }; S.prevAge = f.age; return { age: v }; }
const QUICK = [
  { id: 'hour', key: 'age', label: 'Last hour', on: f => f.age === '1h', toggle: f => ageToggle(f, '1h'), test: j => isHot(j) },
  { id: 'today', key: 'age', label: 'Today', on: f => f.age === '24h', toggle: f => ageToggle(f, '24h'), test: j => { const { t, kind } = freshness(j); return kind !== 'unknown' && Date.now() - t < 864e5; } },
  { id: 'funded', key: 'fundedOnly', label: 'Funded', on: f => f.fundedOnly, toggle: f => ({ fundedOnly: !f.fundedOnly }), test: j => j.funded },
  { id: 'visa', key: 'visa', label: 'Sponsors visa', on: f => f.visa.length === 1 && f.visa[0] === 'Sponsors visa', toggle: f => ({ visa: f.visa[0] === 'Sponsors visa' && f.visa.length === 1 ? [] : ['Sponsors visa'] }), test: j => j.visa === 'Sponsors visa' },
  { id: 'remote', key: 'workModes', label: 'Remote', on: f => f.workModes.length === 1 && f.workModes[0] === 'Remote', toggle: f => ({ workModes: f.workModes[0] === 'Remote' && f.workModes.length === 1 ? [] : ['Remote'] }), test: j => j.workMode === 'Remote' },
  { id: 'contact', key: 'hasContact', label: 'Has email', on: f => f.hasContact, toggle: f => ({ hasContact: !f.hasContact }), test: j => j.emails?.length || j.contactCount },
];
function renderQuick() {
  if (!$('#quick').children.length) {
    $('#quick').innerHTML = QUICK.map(q => `<button class="qs" data-q="${q.id}"><span>${q.label}</span><b data-v="0">0</b></button>`).join('');
    $$('.qs').forEach(b => b.onclick = () => { const q = QUICK.find(x => x.id === b.dataset.q); setFilters(q.toggle(S.filters)); });
  }
  const { matched, nearMiss } = ev();
  for (const q of QUICK) {
    let n = 0; for (const l of [matched, nearMiss.get(q.key) || []]) for (const j of l) if (q.test(j)) n++;
    const b = $(`.qs[data-q="${q.id}"]`); b.classList.toggle('on', q.on(S.filters)); tickTo(b.querySelector('b'), n);
  }
}

// ───────────────────────────────────────────── list
// Small facts as pills. Comfortable rows show the first three (CSS); compact rows show all.
function pillsFor(j) {
  const p = {};
  if (j.funded) { const l = j.funding?.label || 'Funded'; p.fund = `<span class="pill ${/^YC\b/.test(l) ? '' : 'live'}">${esc(l)}</span>`; } // fresh rounds get the accent; a YC batch is neutral
  const v = visaShort[j.visa]; if (v) p.visa = `<span class="pill ${v[1]}">${v[0]}</span>`;
  const ps = payStr(j); if (ps) p.pay = `<span class="pill">${esc(ps)}</span>`;
  const y = years(j); if (y && !(j.type === 'Internship' && j.yearsMin === 0)) p.yrs = `<span class="pill">${esc(y)}</span>`;
  if (j.workMode === 'Remote' || j.workMode === 'Hybrid') p.mode = `<span class="pill">${esc(j.workMode)}</span>`;
  const order = ['fund', 'visa', 'pay', 'yrs', 'mode'];
  return order.map(k => p[k]).filter(Boolean).join('');
}
// A small progress ring: how much of what a role asks for you have.
function ring(pct, size = 26, stroke = 3) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, h = size / 2;
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${h}" cy="${h}" r="${r}" class="ring-bg" stroke-width="${stroke}"/><circle cx="${h}" cy="${h}" r="${r}" class="ring-fg" stroke-width="${stroke}" stroke-dasharray="${(c * Math.min(100, pct) / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${h} ${h})"/></svg>`;
}
/** How a role fits the open profile, or null when there is nothing to compare (no skills on either side). */
function fitOf(j) {
  const p = profile(); if (!p.skills?.length || !j.skills?.length) return null;
  const ft = fit(j, p); const n = ft.have.length + ft.missing.length; if (!n) return null;
  const thin = n < 3; // one or two skills named: too little to call it a match either way
  return { ...ft, n, thin, word: thin ? 'Names few skills' : ft.pct >= 75 ? 'Strong match' : ft.pct >= 50 ? 'Good match' : ft.pct >= 25 ? 'Partial match' : 'Few skills in common' };
}
function rowHtml(j, { arrive = false } = {}) {
  const tr = S.meta?.tracking?.[j.id]; const pills = pillsFor(j); const loc = locShort(j); const ft = fitOf(j);
  const saved = tr?.status === 'saved';
  return `<div class="row ${S.sel === j.id ? 'sel' : ''} ${isHot(j) ? 'hot' : ''} ${arrive ? 'arrive' : ''}" data-id="${j.id}" role="option">
    ${logo(j.company, j.domain)}
    <div class="r-main">
      <div class="r-title">${esc(j.title)}</div>
      <div class="r-sub"><span class="r-co">${esc(j.company)}</span>${loc ? `<span class="r-loc">${esc(loc)}</span>` : ''}</div>
      ${pills ? `<div class="r-pills">${pills}</div>` : ''}
    </div>
    <div class="r-right"><span class="t-time">${when(j)}</span>${tr?.status ? `<span class="r-flag st-${esc(tr.status)}">${esc(statusLabel(tr.status))}</span>` : ft && !ft.thin && ft.pct >= 40 ? `<span class="r-fit ${ft.pct >= 75 ? 'hi' : ''}" title="${esc(`${ft.word}: you have ${ft.have.length} of ${ft.n} skills`)}">${ring(ft.pct, 22, 2.5)}<b>${ft.pct}</b></span>` : ''}</div>
    <div class="r-acts"><button data-act="save" class="${saved ? 'on' : ''}" title="${saved ? 'Saved. Click to remove' : 'Save (S)'}" aria-label="Save">${ic('bookmark')}</button><button data-act="hide" title="Hide (X)" aria-label="Hide">${ic('eyeoff')}</button></div></div>`;
}
// Newest first is grouped by how fresh a role is, so "what came in while I was away" reads at a glance.
const GROUPS = [['hour', 'Last hour', 36e5], ['day', 'Today', 864e5], ['week', 'This week', 7 * 864e5], ['older', 'Earlier', Infinity]];
const groupOf = (j, now) => { const { t, kind } = freshness(j); const age = now - t; if (age < 36e5) return kind === 'exact' ? 'hour' : 'day'; return GROUPS.find(g => age < g[2])[0]; };
let current = [];
function renderList(arriveIds = new Set()) {
  evCache = null; current = filtered();
  $('#viewCount').textContent = fmt(current.length);
  let html = '';
  if (current.length) {
    const now = Date.now(); const grouped = S.sort === 'new'; let last = '';
    const counts = {}; if (grouped) { const bk = { hour: [], day: [], week: [], older: [] }; for (const j of current) bk[groupOf(j, now)].push(j); current = [...bk.hour, ...bk.day, ...bk.week, ...bk.older]; for (const k in bk) counts[k] = bk[k].length; }
    for (const j of current.slice(0, S.limit)) {
      if (grouped) { const g = groupOf(j, now); if (g !== last) { last = g; html += `<div class="grp" data-g="${g}"><span>${GROUPS.find(x => x[0] === g)[1]}</span><b>${fmt(counts[g])}</b></div>`; } }
      html += rowHtml(j, { arrive: arriveIds.has(j.id) });
    }
    if (current.length > S.limit) html += `<button class="btn more" id="more">Show ${fmt(Math.min(300, current.length - S.limit))} more</button>`;
  } else html = `<div class="empty"><div class="empty-in"><img src="/logo.svg" width="44" alt=""><h3>Nothing matches</h3>${chipList().length ? '<p>Loosen a filter, or clear them all.</p><button class="btn" id="emptyClear">Clear filters</button>' : '<p>New roles show up here as they’re found.</p>'}</div></div>`;
  $('#list').innerHTML = html;
  hydrateIcons($('#list'));
  $('#more')?.addEventListener('click', () => { S.limit += 300; renderList(); });
  $('#emptyClear')?.addEventListener('click', () => { S.activeView = null; $('#q').value = ''; setFilters({ ...EMPTY_FILTERS }); });
  $('#nJobs').textContent = fmt(S.jobs.length);
  S.pending = []; updatePill();
  if (!S.sel) renderBriefing();
}
const list = $('#list');
list.addEventListener('click', e => {
  const r = e.target.closest('.row'); if (!r) return;
  const a = e.target.closest('[data-act]');
  if (a) { const id = r.dataset.id; if (a.dataset.act === 'save') track(id, S.meta.tracking[id]?.status === 'saved' ? '' : 'saved'); else quickHide(id); return; }
  select(r.dataset.id, true);
});
list.addEventListener('mousemove', e => { const r = e.target.closest('.row'); if (!r) return; const b = r.getBoundingClientRect(); r.style.setProperty('--mx', `${e.clientX - b.left}px`); r.style.setProperty('--my', `${e.clientY - b.top}px`); });
list.addEventListener('mouseleave', () => $$('.row', list).forEach(r => r.style.removeProperty('--mx')));
function updatePill() { const n = S.pending.length; const p = $('#newPill'); p.classList.toggle('hidden', !n); p.innerHTML = `<span class="np-dot"></span><b>${fmt(n)} new role${n === 1 ? '' : 's'}</b><span>Show</span>`; document.title = n ? `(${n}) Lookout` : 'Lookout'; }
$('#newPill').onclick = () => {
  const ids = new Set(S.pending); renderList(ids);
  const idx = current.findIndex(j => ids.has(j.id));
  if (idx < 0) return toast('Those roles don’t match your filters any more', { ms: 3000 });
  if (idx >= S.limit) { S.limit = idx + 50; renderList(ids); }
  $(`.row[data-id="${current[idx].id}"]`, list)?.scrollIntoView({ block: 'center' });
};

// sort + search
function renderSort() { $('#sortBtn').innerHTML = `${ic('sort')}<span>${S.sort === 'best' ? 'Best match' : 'Newest'}</span>`; $('#sortBtn').title = 'Switch between newest and best match'; }
$('#sortBtn').onclick = () => {
  S.sort = S.sort === 'new' ? 'best' : 'new'; ls.set('lk2.sort', S.sort); renderSort(); renderList();
  if (S.sort === 'best' && !profile().skills?.length) toast('Add your skills to rank by fit', { action: ['Add skills', () => { location.hash = '#settings'; }] });
};
$('#q').value = S.filters.q || '';
$('#q').addEventListener('input', debounce(e => setFilters({ q: e.target.value.trim() }), 140));
$('#q').addEventListener('search', e => setFilters({ q: e.target.value.trim() })); // native clear (×) and Esc
$('#q').addEventListener('keydown', e => { if (e.key === 'Escape') { e.target.value = ''; setFilters({ q: '' }); e.target.blur(); e.stopPropagation(); } });

// ───────────────────────────────────────────── detail
const STATUSES = [['saved', 'Saved'], ['applied', 'Applied'], ['contacted', 'Contacted'], ['interview', 'Interviewing'], ['rejected', 'Closed']];
const statusLabel = s => (STATUSES.find(x => x[0] === s) || [s, s === 'hidden' ? 'Hidden' : s])[1];
function detailEmpty() { $('#detail').classList.remove('open'); S.detailJob = null; renderBriefing(); }

// ── the briefing: what the right-hand side shows while no role is open ──
const hash32 = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
/** What is left to set up, in the order that pays off soonest. */
function setupSteps() {
  const p = profile(), s = S.meta?.settings || {}, views = S.meta?.filterSets || [];
  return [
    { label: 'Import your résumé', hint: 'So every role shows which of its skills you have', done: !!p.resume || (p.skills || []).length >= 5, go: () => { location.hash = '#settings'; } },
    { label: 'Scan your GitHub or site', hint: 'Finds skills your résumé leaves out', done: !!p.scan?.at, go: () => { location.hash = '#settings'; setTimeout(() => $('#scanBox')?.scrollIntoView({ block: 'center' }), 120); } },
    { label: 'Save a view', hint: 'Set filters for the roles you want, then save them', done: views.length > 0, go: () => openSheet() },
    { label: 'Connect your phone', hint: 'Free alerts through the ntfy app', done: !!s.ntfyTopic, go: () => { location.hash = '#settings'; setTimeout(() => $('#pushForm')?.scrollIntoView({ block: 'start' }), 120); } },
    { label: 'Turn on a view’s bell', hint: 'New matches then reach your phone', done: views.some(v => v.alert), go: () => { const v = views[0]; v ? openBell(v) : openSheet(); } },
  ];
}
let briefMemo = { sig: '', data: null };
function briefingData() {
  const tr = S.meta?.tracking || {}; const p = profile();
  const sig = `${current.length}|${current[0]?.id}|${p.skills?.length || 0}|${Object.keys(p.strength || {}).length}|${Object.keys(tr).length}|${Math.floor(Date.now() / 6e4)}`;
  if (briefMemo.sig === sig) return briefMemo.data;
  const now = Date.now(); let hour = 0, day = 0; const blips = [], scored = [];
  for (const j of current) {
    const f = freshness(j); if (f.kind === 'unknown') continue; const age = now - f.t;
    if (f.kind === 'exact' && age < 36e5) { hour++; if (blips.length < 14) blips.push(j.id); }
    if (age < 864e5) day++;
  }
  for (const j of current.slice().sort((a, b) => effectiveTime(b) - effectiveTime(a)).slice(0, 1500)) {
    if (now - effectiveTime(j) > 7 * 864e5) break;
    if (tr[j.id]?.status || tr[j.id]?.hidden) continue;
    const ft = fitOf(j); if (ft && ft.n >= 4 && ft.pct >= 50 && ft.expGap < 1) scored.push([j, ft]);
  }
  scored.sort((a, b) => (b[1].pct - a[1].pct) || (b[1].have.length - a[1].have.length) || (effectiveTime(b[0]) - effectiveTime(a[0])));
  const stale = Object.entries(tr).filter(([, t]) => ['applied', 'contacted'].includes(t.status) && now - Date.parse(t.at) > 7 * 864e5).length;
  briefMemo = { sig, data: { hour, day, strong: scored.filter(x => x[1].pct >= 75).length, best: scored.slice(0, 4), blips, stale } };
  return briefMemo.data;
}
function renderBriefing() {
  const d = $('#detail'); if (S.sel || !d) return;
  if (!S.meta || !S.jobs.length) { d.innerHTML = '<div class="brief"><div class="brief-load"><span class="spin"></span></div></div>'; return; }
  const b = briefingData(); const p = profile(); const hasSkills = (p.skills || []).length > 0;
  const view = S.meta.filterSets.find(x => x.id === S.activeView); const scope = view ? view.name : activeCount() ? 'your filters' : 'everything Lookout has';
  const src = S.meta.sources || []; const boards = src.find(s => s.id === 'ats')?.boards || 0;
  const state = !S.connected ? 'Offline' : src.some(s => s.running) ? 'Scanning' : 'Live'; S.briefState = state;
  const dots = b.blips.map((id, i) => { const h = hash32(id); const a = (h % 360) * Math.PI / 180, r = 16 + ((h >>> 9) % 34); return `<i class="blip" style="left:${(50 + r * Math.cos(a)).toFixed(1)}%;top:${(50 + r * Math.sin(a)).toFixed(1)}%;animation-delay:${((i * 0.41) % 3.2).toFixed(2)}s"></i>`; }).join('');
  const steps = setupSteps(); const left = steps.filter(s => !s.done); const hideSetup = ls.get('lk2.setupHide', false);
  const headline = b.hour ? `${fmt(b.hour)} new in the last hour` : b.day ? `${fmt(b.day)} posted today` : 'Quiet right now';
  d.innerHTML = `<div class="brief">
    <header class="brief-top">
      <div class="radar ${S.connected ? 'on' : ''}" aria-hidden="true"><span class="sweep"></span><span class="rings"></span>${dots}<span class="core"></span></div>
      <div class="brief-h"><span class="eyebrow"><span class="st-dot ${S.connected ? 'on' : ''}"></span>${state}${boards ? ` · watching ${fmt(boards)} careers pages` : ''}</span>
        <h2>${headline}</h2><p>In ${esc(scope)}. New roles drop in at the top of the list as they are found.</p></div>
    </header>
    <div class="brief-stats">
      <button data-bq="hour"><b>${fmt(b.hour)}</b><span>Last hour</span></button>
      <button data-bq="day"><b>${fmt(b.day)}</b><span>Today</span></button>
      <button data-bq="best" ${hasSkills ? '' : 'disabled'}><b>${hasSkills ? fmt(b.strong) : '–'}</b><span>Strong matches this week</span></button>
    </div>
    ${hasSkills && b.best.length ? `<section class="brief-sec"><h4>Best matches for you this week<button class="link small" data-bq="best">See all</button></h4>
      <div class="mini-list">${b.best.map(([j, ft]) => `<button class="mini" data-open="${j.id}">${logo(j.company, j.domain)}<span class="mini-main"><b>${esc(j.title)}</b><span>${esc(j.company)} · ${when(j)}</span></span><span class="r-fit ${ft.pct >= 75 ? 'hi' : ''}" title="${esc(`You have ${ft.have.length} of ${ft.n} skills`)}">${ring(ft.pct, 26, 3)}<b>${ft.pct}</b></span></button>`).join('')}</div></section>`
      : !hasSkills ? `<section class="brief-sec"><div class="nudge"><div><b>See which roles fit you</b><span>Import your résumé and every role shows how many of its skills you have.</span></div><button class="btn primary" data-go="resume">Import résumé</button></div></section>` : ''}
    ${b.stale ? `<section class="brief-sec"><div class="nudge warn"><div><b>${b.stale} application${b.stale > 1 ? 's have' : ' has'} been quiet for a week</b><span>A short follow-up often gets a reply.</span></div><a class="btn" href="#pipeline">Open pipeline</a></div></section>` : ''}
    ${left.length && !hideSetup ? `<section class="brief-sec"><h4>Finish setting up<span class="muted">${steps.length - left.length} of ${steps.length} done</span><button class="link small" id="setupHide">Hide</button></h4>
      <div class="setup">${steps.map((s, i) => s.done ? '' : `<button class="setup-it" data-step="${i}"><span class="tick"></span><span><b>${esc(s.label)}</b><small>${esc(s.hint)}</small></span></button>`).join('')}</div></section>` : ''}
    <footer class="brief-keys"><span><kbd>J</kbd><kbd>K</kbd>move</span><span><kbd>Enter</kbd>apply</span><span><kbd>S</kbd>save</span><span><kbd>X</kbd>hide</span><span><kbd>F</kbd>filters</span><button class="link small" id="keysOpen"><kbd>?</kbd>all shortcuts</button></footer>
  </div>`;
  hydrateIcons(d);
  $$('[data-bq]', d).forEach(el => el.onclick = () => { const k = el.dataset.bq; if (k === 'hour') setFilters({ age: '1h' }); else if (k === 'day') setFilters({ age: '24h' }); else { S.sort = 'best'; ls.set('lk2.sort', 'best'); renderSort(); renderList(); list.scrollTop = 0; } });
  $$('[data-open]', d).forEach(el => el.onclick = () => select(el.dataset.open));
  $$('[data-step]', d).forEach(el => el.onclick = () => steps[+el.dataset.step].go());
  $('[data-go="resume"]', d)?.addEventListener('click', () => { location.hash = '#settings'; });
  $('#setupHide')?.addEventListener('click', () => { ls.set('lk2.setupHide', true); renderBriefing(); });
  $('#keysOpen')?.addEventListener('click', openKeys);
}
// Other open roles at the same company, built once per job list.
let coIndex = { src: null, map: new Map() };
function rolesAt(company) {
  if (coIndex.src !== S.jobs) { const m = new Map(); for (const j of S.jobs) { const k = normCo(j.company); if (!k) continue; (m.get(k) || m.set(k, []).get(k)).push(j); } coIndex = { src: S.jobs, map: m }; }
  return coIndex.map.get(normCo(company)) || [];
}
// A posting's text, set as headings, paragraphs and bullet lists instead of one grey block.
function formatDesc(text) {
  let html = '', inList = false; const close = () => { if (inList) { html += '</ul>'; inList = false; } };
  for (const raw of String(text).replace(/\r/g, '').split('\n')) {
    const l = raw.trim(); if (!l) { close(); continue; }
    const b = l.match(/^(?:[•·▪◦●‣➢*]|[-–](?=\s)|\d{1,2}[.)](?=\s))\s*(.+)$/);
    if (b) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${esc(b[1])}</li>`; continue; }
    close();
    const words = l.split(/\s+/).length;
    const heading = l.length <= 64 && words <= 8 && /^[A-Z0-9]/.test(l) && !/[.!?,;]$/.test(l) && (/:$/.test(l) || (l === l.toUpperCase() && /[A-Z]{3}/.test(l)) || /^(about|what |who |why |how |responsibilit|requirement|qualification|benefit|perks|the role|the team|your |our |skills|nice to have|preferred|minimum|basic|compensation|we offer|you will|you’ll|you'll|key |overview|summary|job description|duties|education|experience|must have|bonus)/i.test(l));
    if (heading) html += `<h5>${esc(l.replace(/:$/, ''))}</h5>`;
    else html += `<p>${esc(l)}</p>`;
  }
  close(); return html;
}
const durShort = ms => { const m = Math.round(ms / 6e4); return m < 1 ? 'under a minute' : m < 60 ? `${m} min` : `${Math.round(m / 6) / 10} h`; };
async function select(id, fromClick = false) {
  S.sel = id;
  $$('.row', list).forEach(r => r.classList.toggle('sel', r.dataset.id === id));
  const row = $(`.row[data-id="${id}"]`, list); if (row && !fromClick) row.scrollIntoView({ block: 'nearest' });
  const d = $('#detail'); d.classList.add('open');
  d.innerHTML = '<div class="d-skel"><i></i><i></i><i></i><i></i><i></i><i></i></div>';
  let j; try { j = await api('/api/job/' + encodeURIComponent(id)); } catch (e) { d.innerHTML = `<div class="d-body">${esc(e.message)}</div>`; return; }
  if (S.sel !== id) return;
  renderDetail(j);
}
const saveBtnHtml = saved => `<span class="bm ${saved ? 'on' : ''}">${ic('bookmark')}</span>${saved ? 'Saved' : 'Save'}`;
// Only facts the posting actually states; no "Not stated" filler.
function factsFor(j) {
  const out = []; const add = (k, v, cls = '') => { if (v) out.push(`<div class="fact"><span>${k}</span><b class="${cls}">${v}</b></div>`); };
  const fr = freshness(j);
  if (fr.kind === 'exact') {
    add('Posted', esc(agoLong(fr.t)), isHot(j) ? 'live' : '');
    // how quickly Lookout caught it, when both times are exact
    const lag = j.firstSeen && !j.backfill ? Date.parse(j.firstSeen) - fr.t : NaN;
    if (lag >= 0 && lag < 90 * 6e4) add('Found', esc(lag < 9e4 ? 'as it was posted' : `${durShort(lag)} after posting`), lag < 20 * 6e4 ? 'live' : '');
  }
  else if (fr.kind === 'date') add('Posted', esc(dayLabel(j.postedAt)));
  else if (fr.kind === 'seen') add('First seen', esc(agoLong(Date.parse(j.firstSeen))));
  add('Experience', j.yearsMin === 0 && !j.yearsMax ? 'None needed' : esc(years(j)));
  add('Pay', esc(payStr(j)));
  if (j.visa && j.visa !== 'Not stated') add('Visa', esc(j.visa), j.visa === 'Sponsors visa' ? 'good' : 'warn');
  if (j.workMode && j.workMode !== 'Not stated') add('Work mode', esc(j.workMode));
  add('Type', esc(j.type === 'Internship' ? 'Internship' : `${j.type}${j.level && j.level !== 'Mid' ? ` · ${lv$(j.level)}` : ''}`));
  if (j.specialty && j.specialty !== 'Other') add('Role', esc(j.specialty));
  add('Degree', esc((j.degrees || []).join(', ')));
  add('Term', esc((j.terms || []).join(', ')));
  if (j.funding) add('Funding', (j.funding.url ? `<a href="${esc(j.funding.url)}" target="_blank" rel="noreferrer">${esc(j.funding.label)}</a>` : esc(j.funding.label)) + (j.funding.at ? ` · ${esc(agoLong(Date.parse(j.funding.at)))}` : ''), 'live');
  if (j.teamSize) add('Team', `${fmt(j.teamSize)} people`);
  return out.join('');
}
function renderDetail(j) {
  const d = $('#detail'); const tr = S.meta.tracking[j.id] || {}; const p = profile();
  const mine = new Set((p.skills || []).map(s => s.toLowerCase()));
  const apply = j.applyUrl || j.url; const reqs = j.requirements || [];
  const loc = j.location || (j.country && j.country !== 'Unknown' ? j.country : '');
  d.innerHTML = `
  <div class="d-head">
    <div class="d-top">${logo(j.company, j.domain, 'logo lg')}
      <div class="d-id"><div class="d-co">${j.domain ? `<a href="https://${esc(j.domain)}" target="_blank" rel="noreferrer">${esc(j.company)}</a>` : esc(j.company)}</div>${loc ? `<div class="d-loc">${esc(loc)}</div>` : ''}</div>
      <button class="icon-btn" id="dClose" title="Close (Esc)">${ic('x')}</button></div>
    <h2 class="d-title">${esc(j.title)}</h2>
    ${j.middleman ? `<p class="mid">${ic('layers')}<span>Re-posted by <b>${esc(j.company)}</b>${j.middleman.employer ? ` for <b>${esc(j.middleman.employer)}</b>` : ''}. The original listing was not found, so Apply goes through them. <a class="link" href="https://www.google.com/search?q=${encodeURIComponent(`${j.middleman.employer || ''} careers "${j.title.replace(/\s*\(.*?\)\s*/g, ' ').trim()}"`)}" target="_blank" rel="noreferrer">Search for the original</a></span></p>` : ''}
    ${j.reposts?.length ? `<p class="mid ok">${ic('layers')}<span>This is the employer's own listing. Also re-posted by ${j.reposts.map(r => esc(r.company)).join(', ')}; those copies are folded in here.</span></p>` : ''}
    <div class="d-actions">
      <a class="btn primary lg" id="dApply" href="${esc(apply)}" target="_blank" rel="noreferrer" title="Open the listing (Enter)">Apply ${ic('external')}</a>
      <button class="btn lg" id="dSave" title="Save (S)">${saveBtnHtml(tr.status === 'saved')}</button>
      <button class="btn lg" id="dDraft" title="Draft an outreach email (E)">${ic('mail')}Email</button>
      <span class="spacer"></span>
      <button class="icon-btn" id="dHide" title="${tr.hidden ? 'Unhide this role' : 'Hide this role (X)'}">${ic(tr.hidden ? 'eye' : 'eyeoff')}</button>
      <button class="icon-btn" id="dHideCo" title="Block ${esc(j.company)}">${ic('ban')}</button>
    </div>
  </div>
  <div class="d-body">
    ${(() => { const ft = fitOf(j); if (!ft) return '';
      const warn = overReachNote(j, p, ft);
      return `<div class="matchcard ${ft.thin ? 'low' : ft.pct >= 75 ? 'hi' : ft.pct >= 50 ? 'mid' : 'low'}"><span class="mc-ring">${ring(ft.pct, 54, 5)}<b>${ft.pct}</b></span>
        <div class="mc-main"><b>${ft.word}</b><span>You have ${ft.have.length} of ${ft.n} skills it names${ft.strong.length ? `, ${ft.strong.length} of them backed by your own work` : ''}.</span>${warn ? `<span class="mc-warn">${esc(warn)}</span>` : ''}</div></div>`; })()}
    <div class="facts">${factsFor(j)}</div>
    ${reqs.length ? `<section class="sec"><h4>Requirements</h4><ul class="reqs ${reqs.length > 6 ? 'clamped' : ''}" id="reqs">${reqs.map(r => `<li>${esc(r)}</li>`).join('')}</ul>${reqs.length > 6 ? `<button class="link small" id="reqMore">Show all ${reqs.length}</button>` : ''}</section>` : ''}
    ${j.skills.length ? (() => {
      const ft = fit(j, p); const techN = ft.have.length + ft.missing.length; const chip = (n, cls, t) => `<span class="sk ${cls}"${t ? ` title="${esc(t)}"` : ''}>${esc(n)}</span>`;
      const note = n => (p.skillNotes || {})[skillInfo(n).canonical.toLowerCase()];
      return `<section class="sec"><h4>Skills${p.skills?.length && techN ? `<span class="match-pct">You have ${ft.have.length} of ${techN}${ft.strong.length ? ` · ${ft.strong.length} strong` : ''}</span>` : ''}</h4>${techN ? `<div class="chipset">${ft.have.map(n => ft.strong.includes(n) ? chip(n, 'hit strong', `Strong: ${note(n) || 'your own work uses it'}`) : chip(n, 'hit', note(n))).join('')}${ft.missing.map(n => chip(n, 'tech')).join('')}</div>` : ''}${ft.general.length ? `<div class="chipset gen">${ft.general.map(n => chip(n, ft.genHave.includes(n) ? 'gen hit' : 'gen')).join('')}</div>` : ''}</section>`;
    })() : ''}
    <section class="sec"><h4>Contact<button class="icon-btn sm" id="cRe" title="Check again">${ic('refresh')}</button></h4><div id="contacts"><span class="spin"></span></div></section>
    <section class="sec"><h4>Your progress<span class="muted small" id="stWhen">${tr.status && tr.at ? `${esc(statusLabel(tr.status))} ${esc(agoLong(Date.parse(tr.at)))}` : ''}</span></h4>
      <div class="stepper" id="stepper">${STATUSES.map(([v, l]) => `<button data-st="${v}" class="${v === 'rejected' ? 'end' : ''}"><i></i><span>${l}</span></button>`).join('')}</div>
      <textarea class="note" id="note" rows="2" placeholder="Notes: who you spoke to, what to follow up on">${esc(tr.note || '')}</textarea></section>
    <section class="sec srcsec"><h4>Seen on ${j.sources.length} source${j.sources.length > 1 ? 's' : ''}</h4>
      <p class="apply-note ${linkKind(apply, j.company)}">${{ direct: 'Apply opens the employer’s own listing.', near: 'Apply opens a listing one click from the employer.', site: 'Apply opens the link the source gave.', copy: 'Apply opens a job board’s copy. The employer’s own listing was not found.' }[linkKind(apply, j.company)]}</p>
      <div class="srcs">${j.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noreferrer"><b>${esc(srcName(s.source))}</b><span>${s.postedAt ? `posted ${agoLong(Date.parse(s.postedAt))}` : `seen ${agoLong(Date.parse(s.seenAt))}`}</span></a>`).join('')}${(j.urls || []).filter(u => !j.sources.some(s => s.url === u)).slice(0, 4).map(u => `<a href="${esc(u)}" target="_blank" rel="noreferrer"><b>${esc(hostOf(u))}</b><span>${{ direct: 'employer', near: 'one click away', site: 'link', copy: 'board copy' }[linkKind(u, j.company)]}${u === apply ? ' · Apply' : ''}</span></a>`).join('')}</div></section>
    ${(() => { const more = rolesAt(j.company).filter(x => x.id !== j.id).sort((a, b) => effectiveTime(b) - effectiveTime(a)); if (!more.length) return '';
      return `<section class="sec"><h4>More at ${esc(j.company)}<span class="muted small">${more.length} other role${more.length > 1 ? 's' : ''}</span></h4><div class="mini-list">${more.slice(0, 4).map(x => { const f = fitOf(x); return `<button class="mini" data-open="${x.id}"><span class="mini-main"><b>${esc(x.title)}</b><span>${esc(locShort(x) || x.type || '')} · ${when(x)}</span></span>${f && !f.thin && f.pct >= 40 ? `<span class="r-fit ${f.pct >= 75 ? 'hi' : ''}">${ring(f.pct, 22, 2.5)}<b>${f.pct}</b></span>` : ''}</button>`; }).join('')}</div>${more.length > 4 ? `<button class="link small" id="moreCo">See all ${more.length}</button>` : ''}</section>`; })()}
    ${j.description ? `<section class="sec"><h4>Full posting</h4><div class="desc">${formatDesc(j.description)}</div></section>` : ''}
  </div>`;
  paintStatus(tr.status);
  $('#dApply').onclick = () => { S.askApplied = { id: j.id, title: j.title, at: Date.now() }; };
  $$('[data-open]', d).forEach(el => el.onclick = () => { const id = el.dataset.open; if (!current.some(x => x.id === id)) $$('.row.sel', list).forEach(r => r.classList.remove('sel')); select(id); });
  $('#moreCo')?.addEventListener('click', () => { const prev = { filters: S.filters, view: S.activeView }; S.activeView = null; setFilters({ ...EMPTY_FILTERS, q: `"${j.company.toLowerCase()}"` }); $('#q').value = S.filters.q; toast(`Roles at ${j.company}`, { action: ['Back to my filters', () => { S.activeView = prev.view; setFilters(prev.filters); $('#q').value = S.filters.q || ''; }] }); });
  $('#dClose').onclick = () => { S.sel = null; $$('.row.sel', list).forEach(r => r.classList.remove('sel')); detailEmpty(); };
  $('#reqMore')?.addEventListener('click', e => { const c = $('#reqs').classList.toggle('clamped'); e.target.textContent = c ? `Show all ${reqs.length}` : 'Show fewer'; });
  $('#dSave').onclick = () => track(j.id, S.meta.tracking[j.id]?.status === 'saved' ? '' : 'saved');
  $('#dHide').onclick = () => tr.hidden ? setHidden(j.id, false).then(() => { toast('Role restored'); renderList(); select(j.id); }) : hideJob(j.id);
  $('#dHideCo').onclick = () => blockCompany(j.company);
  $$('[data-st]', d).forEach(b => b.onclick = () => track(j.id, b.classList.contains('on') ? '' : b.dataset.st));
  $('#note').onchange = e => track(j.id, S.meta.tracking[j.id]?.status || '', e.target.value, true);
  let contacts = null;
  $('#dDraft').onclick = () => draft(j, contacts);
  $('#cRe').onclick = () => { $('#contacts').innerHTML = '<span class="spin"></span>'; loadContacts(j, true).then(c => contacts = c); };
  loadContacts(j).then(c => contacts = c);
  S.detailJob = j;
}
async function loadContacts(j, refresh = false) {
  try {
    const c = await api(`/api/contacts/${encodeURIComponent(j.id)}${refresh ? '?refresh=1' : ''}`);
    if (S.sel !== j.id) return c;
    const copyBtn = e => `<button class="icon-btn sm" data-copy="${esc(e)}" title="Copy">${ic('copy')}</button>`;
    const out = [];
    for (const e of c.emails) out.push(`<div class="contact"><div class="c-main"><div class="em">${esc(e.email)}</div><div class="via">${esc(e.role)} · <a href="${esc(e.url)}" target="_blank" rel="noreferrer">${esc(e.source)}</a></div></div>${e.confidence === 'published' ? '' : '<span class="tag">Other domain</span>'}${copyBtn(e.email)}</div>`);
    if (c.founders?.length) out.push('<div class="sub-h">Founders</div>' + c.founders.map(f => `<div class="person">${logo(f.name, '')}<div><div>${esc(f.name)} <small>${esc(f.role || '')}</small></div><div>${f.linkedin ? `<a href="${esc(f.linkedin)}" target="_blank" rel="noreferrer">LinkedIn</a>` : ''}${f.x ? `<a href="${esc(f.x)}" target="_blank" rel="noreferrer">X</a>` : ''}</div></div></div>`).join(''));
    for (const g of c.guesses || []) out.push(`<div class="contact guess"><div class="c-main"><div class="em">${esc(g.email)}</div><div class="via">${esc(g.name)}${g.alt?.length ? ` · or ${g.alt.map(esc).join(', ')}` : ''}</div></div><span class="tag warn" title="A common address pattern, not verified">Guess</span>${copyBtn(g.email)}</div>`);
    const soc = Object.entries(c.socials || {}).map(([k, u]) => `<a class="link" href="${esc(u)}" target="_blank" rel="noreferrer">${esc({ linkedin: 'LinkedIn', x: 'X', github: 'GitHub', instagram: 'Instagram' }[k] || k)}</a>`).join(' · ');
    $('#contacts').innerHTML = (out.join('') || '<p class="muted" style="margin:0">No published email found.</p>') + (soc ? `<p class="fine">${soc}</p>` : '');
    hydrateIcons($('#contacts'));
    $$('[data-copy]', $('#contacts')).forEach(b => b.onclick = () => { navigator.clipboard?.writeText(b.dataset.copy); toast(`Copied ${b.dataset.copy}`, { ms: 2500 }); });
    return c;
  } catch (e) { if (S.sel === j.id) $('#contacts').innerHTML = `<span class="muted small">Couldn’t check: ${esc(e.message)}</span>`; return null; }
}
function draft(j, c) {
  const p = profile();
  const to = c?.emails?.[0]?.email || j.emails?.[0] || c?.guesses?.[0]?.email || '';
  const first = c?.founders?.[0]?.name?.split(' ')[0];
  const mine = new Set((p.skills || []).map(s => s.toLowerCase()));
  const overlap = fit(j, p).have.slice(0, 4);
  const subject = `${j.title}${p.name ? ` · ${p.name}` : ''}`;
  const body = [`Hi ${first || `${j.company} team`},`, '',
    `I saw ${j.company} is hiring for ${j.title}${j.funding?.at ? ` (and congrats on the ${j.funding.label})` : ''}. I’d love to be considered.`, '',
    p.pitch || '[Two lines about you: what you built and what you’re great at]', '',
    overlap.length ? `I’ve worked hands-on with ${overlap.join(', ')}, which maps directly to the role.` : '[One line tying you to a requirement in the post]',
    p.link ? `\nWork: ${p.link}` : '', '', 'Open to a 15-minute chat this week?', '', 'Thanks,', p.name || '[Your name]'].join('\n').replace(/\n{3,}/g, '\n\n');
  navigator.clipboard?.writeText(`To: ${to}\nSubject: ${subject}\n\n${body}`).catch(() => { });
  location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const tracked = S.meta.tracking[j.id]?.status;
  toast(to ? `Draft for ${to} opened and copied` : 'Draft opened and copied. Add a recipient.', tracked ? {} : { action: ['Mark contacted', () => track(j.id, 'contacted')], ms: 9000 });
}
async function setHidden(id, hidden) {
  const r = await api('/api/track', { method: 'POST', body: JSON.stringify({ id, hidden }) });
  if (r) S.meta.tracking[id] = r; else delete S.meta.tracking[id];
}
async function track(id, status, note, quiet) {
  const prev = S.meta.tracking[id] ? { ...S.meta.tracking[id] } : null;
  const r = await api('/api/track', { method: 'POST', body: JSON.stringify({ id, status, ...(note !== undefined ? { note } : {}) }) });
  if (r) S.meta.tracking[id] = r; else delete S.meta.tracking[id];
  const j = S.jobs.find(x => x.id === id);
  const row = $(`.row[data-id="${id}"]`, list); if (row && j) row.outerHTML = rowHtml(j);
  hydrateIcons(list);
  if (S.sel === id && S.detailJob) { paintStatus(status); const w = $('#stWhen'); if (w) w.textContent = status ? `${statusLabel(status)} just now` : ''; const sb = $('#dSave'); if (sb) sb.innerHTML = saveBtnHtml(status === 'saved'); }
  briefMemo.sig = '';
  renderNav(); if (S.view === 'pipeline') renderPipeline();
  if (!quiet && status && status !== 'hidden') toast(`${statusLabel(status)}: ${j?.title || ''}`, { undo: () => track(id, prev?.status || '', prev?.note, true) });
}
// The progress stepper: steps before the current one read as done.
function paintStatus(status) {
  const order = ['saved', 'applied', 'contacted', 'interview']; const i = order.indexOf(status);
  $$('#stepper [data-st]').forEach(b => { const k = order.indexOf(b.dataset.st); b.classList.toggle('on', b.dataset.st === status); b.classList.toggle('done', i >= 0 && k >= 0 && k < i); });
}
function overReachNote(j, p, ft) {
  if (ft.expGap >= 1) return `Asks for ${j.yearsMin}+ years of experience; your profile has ${p.yearsExp ?? 0}.`;
  if (j.visa === 'Citizens / clearance only') return 'Open to citizens or people with security clearance only.';
  if (j.visa === 'No sponsorship') return 'Says it does not sponsor visas.';
  return '';
}
// Hide from the list's hover button: stays where you are instead of opening the next role.
function quickHide(id) {
  const idx = current.findIndex(j => j.id === id); const wasOpen = S.sel === id;
  setHidden(id, true).then(() => { const top = list.scrollTop; if (wasOpen) selectNextAfter(idx); else renderList(); list.scrollTop = top; toast('Role hidden', { undo: () => setHidden(id, false).then(() => renderList()) }); });
}
// Coming back from the employer's page: one click to record that you applied.
window.addEventListener('focus', () => {
  const a = S.askApplied; if (!a || Date.now() - a.at < 5000) return; S.askApplied = null;
  if (['applied', 'contacted', 'interview', 'rejected'].includes(S.meta?.tracking?.[a.id]?.status)) return;
  toast(`Did you apply to ${a.title.slice(0, 60)}?`, { action: ['Mark applied', () => track(a.id, 'applied')], ms: 14000 });
});
function selectNextAfter(idx) { renderList(); const next = current[Math.min(idx, current.length - 1)]; if (next) select(next.id); else { S.sel = null; detailEmpty(); } }
function hideJob(id) {
  const idx = current.findIndex(j => j.id === id);
  setHidden(id, true).then(() => { selectNextAfter(idx); toast('Role hidden', { undo: () => setHidden(id, false).then(() => renderList()) }); });
}
async function blockCompany(name) {
  const idx = current.findIndex(j => j.id === S.sel);
  const r = await api('/api/block', { method: 'POST', body: JSON.stringify({ company: name, block: true }) });
  S.meta.blockedCompanies = r.blockedCompanies; selectNextAfter(idx); renderQuick(); renderViews();
  toast(`Blocked ${name}. Manage in Settings.`, { undo: async () => { const u = await api('/api/block', { method: 'POST', body: JSON.stringify({ company: name, block: false }) }); S.meta.blockedCompanies = u.blockedCompanies; refreshJobs(); } });
}

// ───────────────────────────────────────────── filter sheet
function openSheet() { $('#sheet').classList.add('open'); $('#sheetBg').classList.remove('hidden'); renderSheet(); }
function closeSheet() { $('#sheet').classList.remove('open'); $('#sheetBg').classList.add('hidden'); }
$('#openFilters').onclick = openSheet; $('#closeSheet').onclick = closeSheet; $('#sheetBg').onclick = closeSheet; $('#sheetDone').onclick = closeSheet;
$('#resetFilters').onclick = () => { S.activeView = null; setFilters({ ...EMPTY_FILTERS }); };
$('#sheetSave').onclick = () => openSaveView();

// Every option cycles: click once to include it, again to exclude it, once more to clear it.
const triOf = (key, v) => S.filters[key]?.includes(v) ? 'inc' : S.filters[NOT_KEY[key]]?.includes(v) ? 'exc' : '';
const opt = (key, value, label, n) => { const st = triOf(key, value); return `<div class="opt ${st} ${n === 0 && !st ? 'zero' : ''}" data-k="${key}" data-v="${esc(value)}" role="checkbox" tabindex="0" aria-checked="${st === 'inc' ? 'true' : st === 'exc' ? 'mixed' : 'false'}" title="${st === 'inc' ? 'Included. Click to exclude' : st === 'exc' ? 'Excluded. Click to clear' : 'Click to include'}"><span class="box">${st === 'exc' ? '–' : ''}</span><span class="lbl">${esc(label ?? value)}</span>${n !== undefined ? `<span class="n">${fmt(n)}</span>` : ''}</div>`; };
const triNames = (key, map = x => x) => [...S.filters[key].map(map), ...S.filters[NOT_KEY[key]].map(v => `not ${map(v)}`)].join(', ');
const triSum = key => { const i = S.filters[key].length, x = S.filters[NOT_KEY[key]].length; return [i && `${i} in`, x && `${x} out`].filter(Boolean).join(', '); };
const sec = (id, title, sum, body) => `<details class="fs" data-sec="${id}" ${S.openSecs.has(id) ? 'open' : ''}><summary>${title}${sum ? `<span class="sum">${esc(sum)}</span>` : ''}</summary><div class="fs-body">${body}</div></details>`;
function renderSheet() {
  const f = S.filters; const open = id => S.openSecs.has(id);
  const scroll = $('#sheetBody').scrollTop;
  // The inner lists (skills, countries, roles) scroll on their own; remember where each one was.
  const listScroll = Object.fromEntries($$('[data-list]', $('#sheetBody')).map(l => [l.dataset.list, l.scrollTop]));
  // Preserve typing state across re-renders: search boxes, focus and caret.
  const searches = Object.fromEntries($$('[data-search]', $('#sheetBody')).map(i => [i.dataset.search, i.value]));
  const ae = document.activeElement; const focusKey = ae && $('#sheetBody').contains(ae) ? (ae.dataset.search ? `[data-search="${ae.dataset.search}"]` : ae.id ? `#${ae.id}` : null) : null;
  const caret = focusKey && 'selectionStart' in ae ? [ae.selectionStart, ae.selectionEnd] : null;
  $('#sheetCount').textContent = '';
  const parts = ['<p class="tri-help sheet-help">Click an option to include it, again to exclude it, once more to clear it.</p>'];
  // posted
  parts.push(sec('age', 'Posted', f.age !== 'all' ? AGE_LABEL[f.age] : '', `<div class="seg full" data-seg="age">${Object.keys(AGE_MS).map(a => `<button data-v="${a}" class="${f.age === a ? 'on' : ''}">${a === 'all' ? 'Any' : a}</button>`).join('')}</div>`));
  // field (tri-state)
  { const counts = open('field') ? countsFor('fields', j => j.field, ['fields', 'excludeFields']) : new Map();
    parts.push(sec('field', 'Field', [f.fields.length && `${f.fields.length} in`, f.excludeFields.length && `${f.excludeFields.length} out`].filter(Boolean).join(', '),
      Object.keys(FIELDS).map(fl => { const st = f.fields.includes(fl) ? 'inc' : f.excludeFields.includes(fl) ? 'exc' : ''; return `<div class="tri ${st}" data-field="${esc(fl)}" role="checkbox" tabindex="0" aria-checked="${st === 'inc' ? 'true' : st === 'exc' ? 'mixed' : 'false'}" aria-label="${esc(fl$(fl))}${st === 'exc' ? ' (excluded)' : ''}"><span class="st">${st === 'inc' ? '✓' : st === 'exc' ? '–' : ''}</span><span class="lbl">${esc(fl$(fl))}</span><span class="n">${fmt(counts.get(fl) || 0)}</span></div>`; }).join(''))); }
  // specialty
  { const counts = open('spec') ? countsFor('specialties', j => j.specialty) : new Map();
    const fieldsShown = f.fields.length ? f.fields : Object.keys(FIELDS).filter(x => !f.excludeFields.includes(x));
    parts.push(sec('spec', 'Role', triSum('specialties'), `<input class="fs-search" data-search="spec" placeholder="Filter roles…"><div class="scroll-opts" data-list="spec">${fieldsShown.map(fl => `<div class="sub-group">${esc(fl)}</div>` + FIELDS[fl].map(s => opt('specialties', s, s, counts.get(s) || 0, f.specialties.includes(s))).join('')).join('')}</div>`)); }
  // experience
  { const lo = f.expMin ?? 0, hi = f.expMax ?? 10; const stc = open('exp') ? countsFor('stages', stagesOf) : new Map();
    parts.push(sec('exp', 'Experience', [triNames('stages', st$), (f.expMin !== null || f.expMax !== null) ? `${lo}–${hi === 10 ? '10+' : hi} yrs` : ''].filter(Boolean).join(' · '), `<p class="tri-help">Pick any: a role shows up if it matches one of them, unless it matches one you excluded.</p><div class="opts" style="grid-template-columns:1fr 1fr;gap:1px 10px">${STAGES.map(t => opt('stages', t, st$(t), stc.get(t) || 0, f.stages.includes(t))).join('')}</div><div class="sub-group" style="padding:14px 0 6px 8px">Years asked for</div><div class="presets"><button data-exp="0,1">New grad</button><button data-exp="0,2">0–2</button><button data-exp="2,5">2–5</button><button data-exp="5,10">5+</button><button data-exp="">Any</button></div>
      <div class="range"><div class="range-vals"><span>Asks for <b id="expLo">${lo}</b> to <b id="expHi">${hi === 10 ? '10+' : hi}</b> years</span></div>
      <div class="dual"><div class="track"></div><div class="fill" id="expFill"></div><input type="range" min="0" max="10" step="1" value="${lo}" id="expMinR"><input type="range" min="0" max="10" step="1" value="${hi}" id="expMaxR"></div>
      <div class="ticks"><span>0</span><span>2</span><span>4</span><span>6</span><span>8</span><span>10+</span></div></div>
      <label class="mini-check"><input type="checkbox" id="expUnknown" ${f.expUnknown ? 'checked' : ''}>Include roles that don’t say</label>`)); }
  // visa
  { const c = open('visa') ? countsFor('visa', j => j.visa || 'Not stated') : new Map();
    parts.push(sec('visa', 'Visa', triNames('visa'), `<div class="presets"><button data-visa="need" title="Keeps roles that sponsor or don’t say. Drops no-sponsorship and citizens-only roles.">I need sponsorship</button><button data-visa="sponsor">Confirmed sponsors</button><button data-visa="">Any</button></div><div class="opts">${VISA.map(v => opt('visa', v, v, c.get(v) || 0, f.visa.includes(v))).join('')}</div>`)); }
  // work mode
  { const c = open('mode') ? countsFor('workModes', j => j.workMode || 'Not stated') : new Map();
    parts.push(sec('mode', 'Work mode', triNames('workModes'), `<div class="opts">${WORK_MODES.map(v => opt('workModes', v, v, c.get(v) || 0, f.workModes.includes(v))).join('')}</div>`)); }
  // location
  { const c = open('loc') ? countsFor('countries', j => j.country) : new Map();
    const list = [...c].sort((a, b) => (a[0] === 'Unknown') - (b[0] === 'Unknown') || b[1] - a[1]); for (const x of [...f.countries, ...f.notCountries]) if (!c.has(x)) list.push([x, 0]);
    parts.push(sec('loc', 'Location', triNames('countries', x => x === 'Unknown' ? 'not stated' : x), `<input class="fs-search" data-search="loc" placeholder="Filter countries…"><div class="scroll-opts opts" data-list="loc">${list.map(([v, n]) => opt('countries', v, v === 'Unknown' ? 'Location not stated' : v, n, f.countries.includes(v))).join('')}</div>`)); }
  // pay
  { const v = f.payMin ?? 0;
    parts.push(sec('pay', 'Pay', f.payMin !== null ? `≥ $${f.payMin}k` : '', `<div class="range"><div class="range-vals"><span>At least <b id="payV">${v ? `$${v}k` : 'any'}</b> a year</span></div>
      <div class="dual"><div class="track"></div><div class="fill" id="payFill" style="left:0;width:${v / 3}%"></div><input type="range" min="0" max="300" step="10" value="${v}" id="payR"></div><div class="ticks"><span>$0</span><span>$100k</span><span>$200k</span><span>$300k</span></div></div>
      <label class="mini-check"><input type="checkbox" id="payUnknown" ${f.payUnknown ? 'checked' : ''}>Include unlisted pay</label>`)); }
  // degree + term
  { const dc = open('deg') ? countsFor('degrees', j => j.degrees || []) : new Map(); const tc = open('deg') ? countsFor('terms', j => j.terms || []) : new Map();
    const SEASON_END = { Winter: 2, Spring: 5, Summer: 8, Fall: 11 }; const notPast = t => { const [se, y] = t.split(' '); return new Date(+y, SEASON_END[se] || 11, 28) >= new Date() || f.terms.includes(t); };
    const termKey = t => { const [se, y] = t.split(' '); return +y * 12 + (SEASON_END[se] || 11); };
    const terms = [...tc].filter(([t]) => notPast(t)).sort((a, b) => termKey(a[0]) - termKey(b[0])).slice(0, 12);
    parts.push(sec('deg', 'Degree & term', [triNames('degrees'), triNames('terms')].filter(Boolean).join(', '), `<div class="sub-group" style="padding:0 0 4px 8px">Accepts</div><div class="opts">${DEGREES.map(v => opt('degrees', v, v, dc.get(v) || 0, f.degrees.includes(v))).join('')}</div>${terms.length ? `<div class="sub-group" style="padding:10px 0 4px 8px">Internship term</div><div class="opts">${terms.map(([v, n]) => opt('terms', v, v, n, f.terms.includes(v))).join('')}</div>` : ''}`)); }
  // company
  { const sc = open('co') ? countsFor('fundStages', j => j.fundStage) : new Map();
    parts.push(sec('co', 'Company', [f.fundedOnly && 'funded', triNames('fundStages'), f.excludeCompanies.length && `${f.excludeCompanies.length} hidden`].filter(Boolean).join(', '), `<label class="mini-check" style="margin:0 0 8px"><input type="checkbox" data-bool="fundedOnly" ${f.fundedOnly ? 'checked' : ''}>Recently funded only</label><div class="opts">${FUND_STAGES.map(v => opt('fundStages', v, v, sc.get(v) || 0, f.fundStages.includes(v))).join('')}</div>
      ${f.excludeCompanies.length ? `<div class="sub-group" style="padding:10px 0 4px 6px">Hidden companies</div><div class="tokens" style="margin:0">${f.excludeCompanies.map(c => `<span class="chip"><span class="v">${esc(c)}</span><button data-unhide="${esc(c)}">${ic('x')}</button></span>`).join('')}</div>` : ''}`)); }
  // skills
  { const c = open('skills') ? countsFor('skills', j => j.skills.map(skillN)) : new Map();
    const list = [...c].sort((a, b) => b[1] - a[1]).slice(0, 300); for (const x of [...f.skills, ...f.notSkills]) if (!c.has(x)) list.unshift([x, 0]);
    // Technical skills first, grouped; general words ("Sales", "Operations") sit at the bottom, quieter.
    const all = [...c].sort((a, b) => b[1] - a[1]); for (const x of [...f.skills, ...f.notSkills]) if (!c.has(x)) all.unshift([x, 0]);
    const groups = new Map(SKILL_GROUPS.map(g => [g, []]));
    for (const [v, n] of all) { const gi = skillInfo(v).group; const g = groups.get(gi) || groups.get('Tools & practices'); if (g.length < (gi === 'General' ? 30 : 60) || f.skills.includes(v) || f.notSkills.includes(v)) g.push([v, n]); }
    const mineN = (profile().skills || []).length;
    parts.push(sec('skills', 'Skills', [f.skills.length && `${f.skills.length} · ${f.skillsAll ? 'all' : 'any'}`, f.notSkills.length && `${f.notSkills.length} out`].filter(Boolean).join(', '), `<div class="seg full" data-seg="skillsAll" style="margin-bottom:8px"><button data-v="any" class="${!f.skillsAll ? 'on' : ''}">Has any</button><button data-v="all" class="${f.skillsAll ? 'on' : ''}">Has all</button></div><div class="presets"><button data-myskills title="${mineN ? 'Tick every technical skill on your profile' : 'Add skills to your profile first (Settings)'}">My skills</button><button data-noskills>Clear</button></div><input class="fs-search" data-search="skills" placeholder="Filter skills…"><div class="scroll-opts opts" data-list="skills">${[...groups].filter(([, l]) => l.length).map(([g, l]) => `<div class="sub-group${g === 'General' ? ' gen' : ''}">${g === 'General' ? 'General, not technical' : esc(g)}</div>` + l.map(([v, n]) => opt('skills', v, v, n, f.skills.includes(v))).join('')).join('')}</div>`)); }
  // sources
  { const c = open('src') ? countsFor('sources', j => j.sources.map(s => s.source)) : new Map();
    const srcs = (S.meta?.sources || []).filter(s => s.kind === 'jobs');
    parts.push(sec('src', 'Source', triSum('sources') || (f.multiSource ? '2+ sources' : ''), `<label class="mini-check" style="margin:0 0 8px"><input type="checkbox" data-bool="multiSource" ${f.multiSource ? 'checked' : ''}>Seen on 2+ sources</label><div class="opts">${srcs.map(s => opt('sources', s.id, s.name, c.get(s.id) || 0, f.sources.includes(s.id))).join('')}</div>`)); }
  // keywords + misc
  parts.push(sec('kw', 'More', [(f.includeQ || f.excludeQ) && 'keywords', f.hideAgencies && 'no agencies', f.hasContact && 'has email', f.hideTracked && 'hide tracked'].filter(Boolean).join(', '), `<label class="kw-label">Only roles mentioning<textarea id="inQ" rows="2" placeholder="python, react">${esc(f.includeQ)}</textarea></label>
    <label class="kw-label">Hide roles mentioning<textarea id="exQ" rows="2" placeholder="senior, staff, clearance">${esc(f.excludeQ)}</textarea></label>
    <p class="tri-help" style="margin:-6px 0 12px 2px">Separate words with commas. Both read the whole posting, and a word also finds its plurals (“citizen” finds citizens, citizenship). Words can’t tell “required” from “not required”: for citizenship or clearance, exclude <b>Citizens / clearance only</b> under Visa instead.</p>
    <label class="mini-check"><input type="checkbox" data-bool="hideAgencies" ${f.hideAgencies ? 'checked' : ''}>Hide recruiters and re-posted roles</label>
    <label class="mini-check"><input type="checkbox" data-bool="hasContact" ${f.hasContact ? 'checked' : ''}>Has a contact email</label>
    <label class="mini-check"><input type="checkbox" data-bool="hideTracked" ${f.hideTracked ? 'checked' : ''}>Not in my pipeline yet</label>`));

  $('#sheetBody').innerHTML = parts.join(''); hydrateIcons($('#sheetBody'));
  $('#sheetBody').scrollTop = scroll;
  wireSheet(); syncExpFill();
  for (const [k, v] of Object.entries(searches)) { const inp = $(`[data-search="${k}"]`, $('#sheetBody')); if (inp && v) { inp.value = v; inp.dispatchEvent(new Event('input')); } }
  for (const [k, v] of Object.entries(listScroll)) { const l = $(`[data-list="${k}"]`, $('#sheetBody')); if (l && v) l.scrollTop = v; }
  if (focusKey) { const el = $(focusKey, $('#sheetBody')); if (el) { el.focus({ preventScroll: true }); if (caret && 'setSelectionRange' in el) try { el.setSelectionRange(...caret); } catch { } } }
  $('#sheetDone').textContent = `Show ${fmt(current.length)}`;
}
const renderSheetDebounced = debounce(renderSheet, 120);
function wireSheet() {
  const body = $('#sheetBody');
  // Re-render only when the user opens a section that wasn't open (re-inserting <details open> fires toggle too).
  $$('details.fs', body).forEach(d => d.addEventListener('toggle', () => {
    const id = d.dataset.sec; const was = S.openSecs.has(id);
    if (d.open === was) return;
    d.open ? S.openSecs.add(id) : S.openSecs.delete(id); ls.set('lk2.secs', [...S.openSecs]);
    if (d.open) renderSheetDebounced();
  }));
  const cycle = el => { const k = el.dataset.k, v = el.dataset.v, nk = NOT_KEY[k], f = S.filters;
    if (f[k].includes(v)) setFilters({ [k]: f[k].filter(x => x !== v), [nk]: [...f[nk], v] });          // included -> excluded
    else if (f[nk].includes(v)) setFilters({ [nk]: f[nk].filter(x => x !== v) });                       // excluded -> cleared
    else setFilters({ [k]: [...f[k], v] }); };                                                            // cleared  -> included
  $$('[data-k]', body).forEach(el => { el.onclick = () => cycle(el); el.onkeydown = e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); cycle(el); } }; });
  $('#inQ')?.addEventListener('input', debounce(e => setFilters({ includeQ: e.target.value }), 350));
  $$('input[data-bool]', body).forEach(cb => cb.onchange = () => setFilters({ [cb.dataset.bool]: cb.checked }));
  $$('[data-seg="age"] button', body).forEach(b => b.onclick = () => setFilters({ age: b.dataset.v }));
  $$('[data-seg="skillsAll"] button', body).forEach(b => b.onclick = () => setFilters({ skillsAll: b.dataset.v === 'all' }));
  $$('.tri', body).forEach(t => t.onkeydown = e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); t.click(); } });
  $$('.tri', body).forEach(t => t.onclick = () => {
    const fl = t.dataset.field; const f = S.filters;
    if (f.fields.includes(fl)) setFilters({ fields: f.fields.filter(x => x !== fl), excludeFields: [...f.excludeFields, fl] });
    else if (f.excludeFields.includes(fl)) setFilters({ excludeFields: f.excludeFields.filter(x => x !== fl) });
    else setFilters({ fields: [...f.fields, fl], excludeFields: f.excludeFields.filter(x => x !== fl) });
  });
  $$('[data-search]', body).forEach(inp => inp.oninput = () => {
    const q = inp.value.toLowerCase(); const listEl = $(`[data-list="${inp.dataset.search}"]`, body);
    $$('.opt', listEl).forEach(o => o.classList.toggle('hidden', !o.textContent.toLowerCase().includes(q)));
    // hide group headers whose options are all filtered out
    $$('.sub-group', listEl).forEach(h => { let n = h.nextElementSibling, any = false; while (n && !n.classList.contains('sub-group')) { if (!n.classList.contains('hidden')) any = true; n = n.nextElementSibling; } h.classList.toggle('hidden', !any); });
  });
  // light up the preset that matches the current filters
  const f = S.filters;
  $$('[data-exp]', body).forEach(b => { const [lo, hi] = (b.dataset.exp || ',').split(',').map(x => x === '' ? null : Number(x)); const want = b.dataset.exp ? [lo || null, hi >= 10 ? null : hi] : [null, null]; b.classList.toggle('on', f.expMin === want[0] && f.expMax === want[1]); });
  $$('[data-visa]', body).forEach(b => { const v = b.dataset.visa; const on = v === 'need' ? f.visa.length === 2 && f.visa.includes('Sponsors visa') && f.visa.includes('Not stated') : v === 'sponsor' ? f.visa.length === 1 && f.visa[0] === 'Sponsors visa' : !f.visa.length; b.classList.toggle('on', on); });
  $$('[data-exp]', body).forEach(b => b.onclick = () => { if (!b.dataset.exp) return setFilters({ expMin: null, expMax: null }); const [lo, hi] = b.dataset.exp.split(',').map(Number); setFilters({ expMin: lo || null, expMax: hi >= 10 ? null : hi }); });
  const mn = $('#expMinR'), mx = $('#expMaxR');
  const expInput = () => { let lo = +mn.value, hi = +mx.value; if (lo > hi) [lo, hi] = [hi, lo]; $('#expLo').textContent = lo; $('#expHi').textContent = hi === 10 ? '10+' : hi; syncExpFill(); };
  const expCommit = () => { let lo = +mn.value, hi = +mx.value; if (lo > hi) [lo, hi] = [hi, lo]; setFilters({ expMin: lo === 0 ? null : lo, expMax: hi === 10 ? null : hi }); };
  if (mn) { mn.oninput = mx.oninput = expInput; mn.onchange = mx.onchange = expCommit; }
  $('#expUnknown')?.addEventListener('change', e => setFilters({ expUnknown: e.target.checked }));
  const pr = $('#payR');
  if (pr) { pr.oninput = () => { $('#payV').textContent = +pr.value ? `$${pr.value}k` : 'any'; $('#payFill').style.width = `${pr.value / 3}%`; }; pr.onchange = () => setFilters({ payMin: +pr.value || null }); }
  $('#payUnknown')?.addEventListener('change', e => setFilters({ payUnknown: e.target.checked }));
  $$('[data-visa]', body).forEach(b => b.onclick = () => setFilters({ visa: b.dataset.visa === 'need' ? ['Sponsors visa', 'Not stated'] : b.dataset.visa === 'sponsor' ? ['Sponsors visa'] : [], notVisa: [] }));
  $('#exQ')?.addEventListener('input', debounce(e => setFilters({ excludeQ: e.target.value }), 350));
  $$('[data-unhide]', body).forEach(b => b.onclick = () => setFilters({ excludeCompanies: S.filters.excludeCompanies.filter(c => c !== b.dataset.unhide) }));
}
function syncExpFill() { const mn = $('#expMinR'), mx = $('#expMaxR'), fill = $('#expFill'); if (!mn || !fill) return; const lo = Math.min(+mn.value, +mx.value), hi = Math.max(+mn.value, +mx.value); fill.style.left = `${lo * 10}%`; fill.style.width = `${(hi - lo) * 10}%`; }

// ───────────────────────────────────────────── saved views
function renderViews() {
  const c = ctx(); const sets = S.meta?.filterSets || [];
  $('#views').innerHTML = sets.length ? sets.map(v => {
    const m = evaluate(S.jobs, v.filters, c).matched; const n = m.length; let fresh = 0;
    for (const j of m) if (isHot(j)) fresh++;
    return `<div class="vw ${S.activeView === v.id ? 'on' : ''} ${v.alert ? 'alerting' : ''}" data-id="${v.id}" title="${esc(v.name)} · ${fmt(n)} roles${fresh ? `, ${fresh} in the last hour` : ''}${v.alert ? ` · alerts to ${v.channel ? esc(v.channel) : 'my phone'}` : ''}"><span class="dot"></span><span class="nm">${esc(v.name)}</span><span class="ct">${fresh ? `<b class="new">+${fresh}</b> ` : ''}${fmt(n)}</span>
      <span class="acts"><button class="icon-btn sm ${v.alert ? 'on' : ''}" data-bell title="${v.alert ? `Alerts go to ${v.channel ? esc(v.channel) : 'my phone'}. Click to change` : 'Set up alerts for this view'}">${ic('bell')}</button><button class="icon-btn sm" data-del title="Delete view">${ic('trash')}</button></span></div>`;
  }).join('') : '<div class="empty-views">Set filters, then save them here.</div>';
  $$('.vw').forEach(el => {
    const v = S.meta.filterSets.find(x => x.id === el.dataset.id);
    el.onclick = () => applyView(v);
    el.querySelector('[data-bell]').onclick = e => { e.stopPropagation(); openBell(v); };
    el.querySelector('[data-del]').onclick = async e => { e.stopPropagation(); const copy = { ...v }; await api('/api/filter-sets/' + v.id, { method: 'DELETE' }); S.meta.filterSets = S.meta.filterSets.filter(x => x.id !== v.id); if (S.activeView === v.id) { S.activeView = null; ls.set('lk2.view', null); } renderViews(); renderChips();
      toast(`Deleted “${v.name}”`, { undo: async () => { const r = await api('/api/filter-sets', { method: 'POST', body: JSON.stringify({ ...copy, id: undefined }) }); S.meta.filterSets.push(r); renderViews(); } }); };
  });
}
function applyView(v) {
  S.activeView = v.id; ls.set('lk2.view', v.id);
  S.filters = normalizeFilters(v.filters); ls.set('lk2.filters', S.filters); $('#q').value = S.filters.q || '';
  $('#viewTitle').textContent = v.name; location.hash = '#jobs'; refreshJobs(); closeSide();
}
// Alerts for one view: off, my phone (the channel in Settings), or a channel of its own for someone else.
let bellView = null;
function openBell(v) {
  bellView = v; const form = $('#bellForm'); const topic = S.meta.settings.ntfyTopic;
  $('#bellName').textContent = `“${v.name}”`; $('#bellMsg').textContent = '';
  $('#bellDefault').textContent = topic ? `My phone (${topic})` : 'My phone (not connected yet, set it up in Settings)';
  form.mode.value = !v.alert ? 'off' : v.channel ? 'custom' : 'default'; form.channel.value = v.channel || '';
  syncBell(); $('#bellDlg').showModal();
}
function syncBell() { const form = $('#bellForm'); const custom = form.mode.value === 'custom'; $('#bellCustom').hidden = !custom; form.channel.required = custom; $('#bellTest').hidden = form.mode.value === 'off'; }
$('#bellForm').addEventListener('change', syncBell);
$('#bellCancel').onclick = () => $('#bellDlg').close('cancel');
$('#bellTest').onclick = async () => {
  const form = $('#bellForm'); const custom = form.mode.value === 'custom';
  if (custom && !form.channel.value.trim()) return void ($('#bellMsg').textContent = 'Enter a channel first');
  $('#bellMsg').textContent = 'Sending…';
  try { const r = await api('/api/test-push', { method: 'POST', body: JSON.stringify({ channel: custom ? form.channel.value.trim() : '', name: bellView.name }) }); $('#bellMsg').textContent = `Sent to ${r.channel}`; }
  catch (e) { $('#bellMsg').textContent = e.message; }
};
$('#bellDlg').addEventListener('close', async () => {
  if ($('#bellDlg').returnValue !== 'ok' || !bellView) return;
  const form = $('#bellForm'); const v = bellView; const mode = form.mode.value;
  try {
    const rec = await api('/api/filter-sets', { method: 'POST', body: JSON.stringify({ ...v, alert: mode !== 'off', channel: mode === 'custom' ? form.channel.value.trim() : '' }) });
    const i = S.meta.filterSets.findIndex(x => x.id === rec.id); if (i >= 0) S.meta.filterSets[i] = rec; // meta may have been reloaded while the dialog was open
    renderViews();
    if (mode === 'default' && !S.meta.settings.ntfyTopic) toast(`Alerts on for “${v.name}”, but no phone is connected yet`, { action: ['Connect phone', () => { location.hash = '#settings'; }] });
    else toast(mode === 'off' ? `Alerts off for “${v.name}”` : `“${v.name}” alerts go to ${rec.channel || 'your phone'}`, { live: mode !== 'off' });
  } catch (e) { toast(e.message, { ms: 5000 }); }
});
function describe(f) { return chipList(f).map(c => `${c.k}: ${c.v}`).join(' · ') || 'All roles'; }
function openSaveView() {
  const v = S.meta.filterSets.find(x => x.id === S.activeView); const form = $('#viewForm');
  const phone = !!S.meta.settings.ntfyTopic;
  form.name.value = v?.name || ''; form.alert.checked = v ? v.alert : phone;
  $('#alertLabel').textContent = phone ? 'Alert my phone on new matches' : 'Alert my phone (connect it in Settings first)';
  $('#viewSummary').textContent = describe(S.filters);
  $('#viewDlg').showModal(); setTimeout(() => form.name.select(), 30);
}
$('#saveView').onclick = openSaveView;
$('#viewCancel').onclick = () => $('#viewDlg').close('cancel');
$('#viewDlg').addEventListener('close', async () => {
  if ($('#viewDlg').returnValue !== 'ok') return;
  const form = $('#viewForm'); const v = S.meta.filterSets.find(x => x.id === S.activeView);
  const rec = await api('/api/filter-sets', { method: 'POST', body: JSON.stringify({ id: v && v.name === form.name.value ? v.id : undefined, name: form.name.value, alert: form.alert.checked, channel: v && v.name === form.name.value ? v.channel || '' : '', filters: S.filters }) });
  const i = S.meta.filterSets.findIndex(x => x.id === rec.id); if (i >= 0) S.meta.filterSets[i] = rec; else S.meta.filterSets.push(rec);
  S.activeView = rec.id; ls.set('lk2.view', rec.id); $('#viewTitle').textContent = rec.name; renderViews();
  toast(`Saved “${rec.name}”${rec.alert ? ' · phone alerts on' : ''}`, { live: rec.alert });
});

// ───────────────────────────────────────────── command palette
let palItems = [], palSel = 0;
function openPalette() { $('#palBg').classList.remove('hidden'); $('#palInput').value = ''; renderPalette(); setTimeout(() => $('#palInput').focus(), 10); }
function closePalette() { $('#palBg').classList.add('hidden'); }
$('#openPalette').onclick = openPalette;
$('#palBg').addEventListener('mousedown', e => { if (e.target === $('#palBg')) closePalette(); });
function paletteCommands() {
  const go = h => () => { location.hash = h; };
  const cmds = [
    { g: 'Go to', l: 'Jobs', i: 'inbox', run: go('#jobs') }, { g: 'Go to', l: 'Hiring signals', i: 'zap', run: go('#signals') },
    { g: 'Go to', l: 'Pipeline', i: 'kanban', run: go('#pipeline') }, { g: 'Go to', l: 'Sources & discovery', i: 'radar', run: go('#sources') }, { g: 'Go to', l: 'Settings', i: 'settings', run: go('#settings') },
    ...(S.meta?.filterSets || []).map(v => ({ g: 'Saved views', l: v.name, i: 'layers', r: v.alert ? (v.channel ? `alerts → ${v.channel}` : 'alerts on') : '', run: () => applyView(v) })),
    { g: 'Filter', l: 'Software & IT only', i: 'sliders', run: () => setFilters({ fields: ['Software & IT'], excludeFields: [] }) },
    { g: 'Filter', l: 'AI / ML roles', i: 'sliders', run: () => setFilters({ specialties: ['AI / ML'] }) },
    { g: 'Filter', l: 'Data science & analytics', i: 'sliders', run: () => setFilters({ specialties: ['Data Science', 'Data Analytics', 'Data Engineering'] }) },
    { g: 'Filter', l: 'Hide core engineering (mechanical, civil, electrical…)', i: 'sliders', run: () => setFilters({ excludeFields: [...new Set([...S.filters.excludeFields, 'Core Engineering'])], fields: S.filters.fields.filter(x => x !== 'Core Engineering') }) },
    { g: 'Filter', l: 'Internships', i: 'sliders', run: () => setFilters({ stages: ['Internship'] }) },
    { g: 'Filter', l: 'Internships or new grad', i: 'sliders', run: () => setFilters({ stages: ['Internship', 'Apprenticeship', 'Entry'] }) },
    { g: 'Filter', l: 'New grad: 0–1 years', i: 'sliders', run: () => setFilters({ expMin: null, expMax: 1 }) },
    { g: 'Filter', l: 'I need visa sponsorship', i: 'sliders', run: () => setFilters({ visa: ['Sponsors visa', 'Not stated'] }) },
    { g: 'Filter', l: 'Remote only', i: 'sliders', run: () => setFilters({ workModes: ['Remote'] }) },
    { g: 'Filter', l: 'India', i: 'sliders', run: () => setFilters({ countries: ['India'] }) },
    { g: 'Filter', l: 'Posted in the last hour', i: 'sliders', run: () => setFilters({ age: '1h' }) },
    { g: 'Filter', l: 'Recently funded startups', i: 'sliders', run: () => setFilters({ fundedOnly: true }) },
    { g: 'Filter', l: 'Has a contact email', i: 'sliders', run: () => setFilters({ hasContact: true }) },
    { g: 'Actions', l: 'Open all filters', i: 'sliders', r: 'F', run: openSheet },
    { g: 'Actions', l: 'Save current filters as view', i: 'plus', run: openSaveView },
    { g: 'Actions', l: 'Clear all filters', i: 'x', run: () => { S.activeView = null; setFilters({ ...EMPTY_FILTERS }); } },
    { g: 'Actions', l: 'Scan every source now', i: 'refresh', run: async () => { await api('/api/scan', { method: 'POST' }); toast('Polling every source now', { live: true }); } },
    { g: 'Actions', l: 'Sort by ' + (S.sort === 'new' ? 'best match' : 'newest'), i: 'sliders', run: () => $('#sortBtn')?.click() },
    { g: 'Look', l: 'Toggle light / dark', i: 'moon', run: toggleTheme },
    { g: 'Look', l: 'Keyboard shortcuts', i: 'layers', r: '?', run: () => openKeys() },
    { g: 'Look', l: document.documentElement.dataset.density === 'compact' ? 'Comfortable spacing' : 'Compact spacing', i: 'layers', run: () => setDensity(document.documentElement.dataset.density === 'compact' ? 'comfortable' : 'compact') },
  ];
  return cmds;
}
function renderPalette() {
  const q = $('#palInput').value.trim().toLowerCase();
  let items = paletteCommands().filter(c => !q || c.l.toLowerCase().includes(q) || c.g.toLowerCase().includes(q));
  if (q.length >= 2) {
    const raw = $('#palInput').value.trim();
    const skill = [...new Set(S.jobs.flatMap(j => j.skills.map(skillN)))].find(sk => sk.toLowerCase() === q);
    if (skill) items.unshift({ g: 'Filter', l: `Skill: ${skill}`, i: 'sliders', run: () => setFilters({ skills: [...new Set([...S.filters.skills, skill])] }) });
    items.unshift({ g: 'Search', l: `Search roles for “${raw}”`, i: 'search', run: () => { $('#q').value = raw; setFilters({ q: raw }); location.hash = '#jobs'; } });
  }
  if (q.length >= 2) {
    const jobs = S.jobs.filter(j => `${j.title} ${j.company}`.toLowerCase().includes(q)).sort((a, b) => effectiveTime(b) - effectiveTime(a)).slice(0, 8);
    items = [...items, ...jobs.map(j => ({ g: 'Jobs', l: `${j.title} · ${j.company}`, job: j, r: when(j), run: () => { location.hash = '#jobs'; select(j.id); } }))]; // commands first
  }
  palItems = items; palSel = 0;
  let lastG = '';
  $('#palList').innerHTML = items.length ? items.map((it, i) => { const head = it.g !== lastG ? `<div class="pal-g">${esc(it.g)}</div>` : ''; lastG = it.g; return head + `<div class="pal-it ${i === 0 ? 'on' : ''}" data-i="${i}">${it.job ? logo(it.job.company, it.job.domain) : ic(it.i)}<span class="pl">${esc(it.l)}</span>${it.r ? `<span class="pr">${esc(it.r)}</span>` : ''}</div>`; }).join('')
    : '<div class="pal-g" style="padding:18px 10px">No matches</div>';
  hydrateIcons($('#palList'));
  $$('.pal-it').forEach(el => { el.onmousemove = () => setPal(+el.dataset.i); el.onclick = () => runPal(+el.dataset.i); });
}
function setPal(i) { palSel = Math.max(0, Math.min(palItems.length - 1, i)); $$('.pal-it').forEach(el => el.classList.toggle('on', +el.dataset.i === palSel)); $(`.pal-it[data-i="${palSel}"]`)?.scrollIntoView({ block: 'nearest' }); }
function runPal(i) { const it = palItems[i]; closePalette(); it?.run(); }
$('#palInput').addEventListener('input', renderPalette);
$('#palInput').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); setPal(palSel + 1); } else if (e.key === 'ArrowUp') { e.preventDefault(); setPal(palSel - 1); }
  else if (e.key === 'Enter') { e.preventDefault(); runPal(palSel); } else if (e.key === 'Escape') closePalette();
});


// ───────────────────────────────────────────── appearance
function setTheme(t) { if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t; ls.set('lk2.theme', t === 'system' ? null : t); syncAppearance(); }
function setDensity(d) { document.documentElement.dataset.density = d; ls.set('lk2.density', d); syncAppearance(); }
function syncAppearance() {
  const t = document.documentElement.dataset.theme || 'system', d = document.documentElement.dataset.density || 'comfortable';
  $$('#themeSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === t));
  $$('#densitySeg button').forEach(b => b.classList.toggle('on', b.dataset.v === d));
}
$$('#themeSeg button').forEach(b => b.onclick = () => setTheme(b.dataset.v));
$$('#densitySeg button').forEach(b => b.onclick = () => setDensity(b.dataset.v));
syncAppearance();


// ───────────────────────────────────────────── keyboard
document.addEventListener('keydown', e => {
  const ae = document.activeElement;
  const typing = /INPUT|TEXTAREA|SELECT/.test(ae?.tagName) || ae?.isContentEditable;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#palBg').classList.contains('hidden') ? openPalette() : closePalette(); return; }
  if (e.key === 'Escape') {
    if (!$('#palBg').classList.contains('hidden')) return closePalette();
    if ($('#sheet').classList.contains('open')) return closeSheet();
    if (typing) return ae.blur();
    if (S.sel) { S.sel = null; $$('.row.sel', list).forEach(r => r.classList.remove('sel')); detailEmpty(); }
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]') || !$('#palBg').classList.contains('hidden') || $('#sheet').classList.contains('open')) return;
  if (e.key === '?') { e.preventDefault(); return openKeys(); }
  // G then a letter jumps between screens, from anywhere
  if (S.gAt && Date.now() - S.gAt < 1200) { const to = { j: 'jobs', s: 'signals', p: 'pipeline', o: 'sources', t: 'settings' }[e.key.toLowerCase()]; S.gAt = 0; if (to) { e.preventDefault(); location.hash = '#' + to; return; } }
  if (e.key.toLowerCase() === 'g') { S.gAt = Date.now(); return; }
  if (S.view !== 'jobs') return;
  if ((e.key === ' ' || e.key === 'Enter') && /^(BUTTON|A|SUMMARY)$/.test(ae?.tagName)) return; // let the focused control handle it
  const k = e.key.toLowerCase();
  if (k === 'f') { e.preventDefault(); return openSheet(); }
  if (e.key === '/') { e.preventDefault(); return $('#q').focus(); }
  const idx = current.findIndex(j => j.id === S.sel);
  if ((k === 'j' || e.key === 'ArrowDown')) { e.preventDefault(); const n = current[Math.min(current.length - 1, idx + 1)]; if (n) { if (idx + 1 >= S.limit) { S.limit += 300; renderList(); } select(n.id); } }
  else if ((k === 'k' || e.key === 'ArrowUp')) { e.preventDefault(); const n = current[Math.max(0, idx - 1)]; if (n) select(n.id); }
  else if (e.key === 'Enter' && S.detailJob && S.sel) { S.askApplied = { id: S.detailJob.id, title: S.detailJob.title, at: Date.now() }; window.open(S.detailJob.applyUrl || S.detailJob.url, '_blank', 'noopener'); }
  else if (k === 's' && S.sel) track(S.sel, S.meta.tracking[S.sel]?.status === 'saved' ? '' : 'saved');
  else if (k === 'x' && S.sel) hideJob(S.sel);
  else if (k === 'e' && S.sel) $('#dDraft')?.click();
});

// ───────────────────────────────────────────── signals
async function renderSignals() {
  const { companies } = await api('/api/signals');
  const f = S.sigSeg;
  const rows = companies.filter(c => f === 'all' || (f === 'news' && c.funding.at) || (f === 'yc' && c.yc) || (f === 'open' && c.openJobs)).slice(0, 500);
  const board = c => c.ats ? `<span class="state ok" title="${esc(c.ats.provider)}">Watching</span>` : c.atsCheckedAt ? '<span class="state">None found</span>' : '<span class="state wait">Looking</span>';
  $('#sigTable').innerHTML = `<thead><tr><th>Company</th><th>Raised</th><th>When</th><th>Careers page</th><th class="num">Roles</th></tr></thead><tbody>${rows.map(c => `<tr>
    <td><div class="co">${logo(c.name, c.website ? c.website.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] : '')}<div><b>${esc(c.name)}</b><small>${esc(c.oneLiner || c.industry || '')}</small></div></div></td>
    <td>${c.funding.url ? `<a class="u" href="${esc(c.funding.url)}" target="_blank" rel="noreferrer">${esc(c.funding.label)}</a>` : esc(c.funding.label)}${c.funding.publisher ? `<div class="muted small">${esc(c.funding.publisher)}</div>` : ''}</td>
    <td class="mono muted">${c.funding.at ? agoLong(Date.parse(c.funding.at)) : '—'}</td>
    <td>${board(c)}</td>
    <td class="num">${c.openJobs ? `<button class="btn" data-co="${esc(c.name)}" style="height:28px;padding:0 12px">${c.openJobs}</button>` : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody>`;
  $$('[data-co]').forEach(b => b.onclick = () => {
    const prev = { filters: S.filters, view: S.activeView };
    S.activeView = null; setFilters({ ...EMPTY_FILTERS, q: `"${b.dataset.co.toLowerCase()}"` }); $('#q').value = S.filters.q; location.hash = '#jobs';
    toast(`Roles at ${b.dataset.co}`, { action: ['Back to my filters', () => { S.activeView = prev.view; setFilters(prev.filters); $('#q').value = S.filters.q || ''; }] });
  });
  $('#nSignals').textContent = fmt(companies.length);
}
$$('#sigSeg button').forEach(b => b.onclick = () => { S.sigSeg = b.dataset.v; $$('#sigSeg button').forEach(x => x.classList.toggle('on', x === b)); renderSignals(); });

// ───────────────────────────────────────────── pipeline
// A board you can drag roles across. Cards say how long they have sat in a stage; applied or contacted
// for a week with no move gets a nudge to follow up.
function renderPipeline() {
  const byId = new Map(S.jobs.map(j => [j.id, j])); const now = Date.now();
  const all = Object.entries(S.meta.tracking).map(([id, t]) => ({ id, t, j: byId.get(id) })).filter(x => x.j);
  const shown = all.filter(x => x.t.status && x.t.status !== 'hidden' && !x.t.hidden);
  const hidden = all.filter(x => x.t.hidden || x.t.status === 'hidden');
  const n = st => shown.filter(x => x.t.status === st).length;
  const week = shown.filter(x => ['applied', 'contacted', 'interview'].includes(x.t.status) && now - Date.parse(x.t.at) < 7 * 864e5).length;
  $('#pipeStats').innerHTML = shown.length ? `<span><b>${shown.length}</b> tracked</span><span><b>${week}</b> moved forward this week</span>${n('interview') ? `<span class="live"><b>${n('interview')}</b> interviewing</span>` : ''}` : '';
  const hint = { saved: 'Press <kbd>S</kbd> on a role, or drag one here', applied: 'Drag a role here once you apply', contacted: 'Roles where you wrote to someone', interview: 'Fingers crossed', rejected: 'Closed or turned down' };
  const card = ({ id, t, j }) => {
    const days = (now - Date.parse(t.at)) / 864e5; const stale = ['applied', 'contacted'].includes(t.status) && days > 7;
    return `<article class="pcard ${stale ? 'stale' : ''}" draggable="true" data-id="${id}" tabindex="0">
      <div class="pc-top">${logo(j.company, j.domain)}<div class="pc-main"><b>${esc(j.title)}</b><span>${esc(j.company)}${locShort(j) ? ` · ${esc(locShort(j))}` : ''}</span></div></div>
      ${t.note ? `<p class="pc-note">${esc(t.note.slice(0, 140))}</p>` : ''}
      <div class="pc-foot"><span>${esc(statusLabel(t.status))} ${esc(agoLong(Date.parse(t.at)))}</span>${stale ? '<span class="tag warn">Follow up?</span>' : ''}</div></article>`;
  };
  $('#kanban').innerHTML = shown.length || hidden.length ? STATUSES.map(([st, label]) => {
    const items = shown.filter(x => x.t.status === st).sort((a, b) => Date.parse(b.t.at) - Date.parse(a.t.at));
    return `<section class="col" data-st="${st}"><header class="col-h"><span class="col-dot st-${st}"></span>${label}<span>${items.length}</span></header><div class="col-body">${items.map(card).join('') || `<div class="none">${hint[st]}</div>`}</div></section>`;
  }).join('') : `<div class="empty pipe-empty"><div class="empty-in"><img src="/logo.svg" width="44" alt=""><h3>Nothing tracked yet</h3><p>Save a role with <kbd>S</kbd> and it lands here. Drag it along as you apply, hear back and interview.</p><a class="btn primary" href="#jobs">Browse roles</a></div></div>`;
  $('#pipeHidden').innerHTML = hidden.length ? `<details class="hid"><summary>${hidden.length} hidden role${hidden.length > 1 ? 's' : ''}</summary><div class="hid-list">${hidden.map(({ id, j }) => `<div class="hid-row"><span><b>${esc(j.title)}</b> · ${esc(j.company)}</span><button class="btn sm ghost" data-unhide="${id}">Unhide</button></div>`).join('')}</div></details>` : '';
  hydrateIcons($('#v-pipeline'));
  const open = id => { location.hash = '#jobs'; setTimeout(() => select(id), 30); };
  $$('#kanban .pcard').forEach(el => {
    el.onclick = () => open(el.dataset.id); el.onkeydown = e => { if (e.key === 'Enter') open(el.dataset.id); };
    el.ondragstart = e => { e.dataTransfer.setData('text/plain', el.dataset.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('drag'); $('#kanban').classList.add('dragging'); };
    el.ondragend = () => { el.classList.remove('drag'); $('#kanban').classList.remove('dragging'); $$('#kanban .col.over').forEach(c => c.classList.remove('over')); };
  });
  $$('#kanban .col').forEach(col => {
    col.ondragover = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.classList.add('over'); };
    col.ondragleave = e => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); };
    col.ondrop = e => { e.preventDefault(); col.classList.remove('over'); const id = e.dataTransfer.getData('text/plain'); if (id && S.meta.tracking[id] && S.meta.tracking[id].status !== col.dataset.st) track(id, col.dataset.st); };
  });
  $$('[data-unhide]').forEach(b => b.onclick = () => setHidden(b.dataset.unhide, false).then(() => { renderPipeline(); toast('Role restored'); }));
}
function openKeys() { $('#keysDlg').showModal(); }
$('#keysClose').onclick = () => $('#keysDlg').close();
$('#keysDlg').addEventListener('click', e => { if (e.target === $('#keysDlg')) $('#keysDlg').close(); });
// Settings: a section list on the left that follows what you are reading
function buildSettingsNav() {
  const nav = $('#setNav'), scroll = $('#setScroll'); if (nav.dataset.built) return; nav.dataset.built = '1';
  const cards = () => $$('[data-nav]', scroll).filter(c => !c.hidden);
  const paint = () => { nav.innerHTML = cards().map(c => `<button data-to="${c.id}">${esc(c.dataset.nav)}</button>`).join(''); $$('button', nav).forEach(b => b.onclick = () => { $('#' + b.dataset.to).scrollIntoView({ behavior: document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); $$('button', nav).forEach(x => x.classList.toggle('on', x === b)); }); spy(); };
  const spy = () => { if (!scroll.clientHeight) { $$('button', nav).forEach((b, i) => b.classList.toggle('on', i === 0)); return; } const top = scroll.getBoundingClientRect().top + 24; let cur = cards()[0]; for (const c of cards()) if (c.getBoundingClientRect().top <= top) cur = c; if (scroll.clientHeight && scroll.scrollHeight > scroll.clientHeight + 40 && scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 4) cur = cards().at(-1); $$('button', nav).forEach(b => b.classList.toggle('on', b.dataset.to === cur?.id)); const on = $('button.on', nav); if (on && nav.scrollWidth > nav.clientWidth) on.scrollIntoView({ block: 'nearest', inline: 'center' }); };
  scroll.addEventListener('scroll', spy, { passive: true }); S.paintSetNav = paint; paint();
}
function renderNav() { $('#nPipeline').textContent = Object.values(S.meta?.tracking || {}).filter(t => t.status && t.status !== 'hidden').length || ''; }

// ───────────────────────────────────────────── sources & discovery
const TIER_COLORS = { '1 min': 'var(--live)', '2 min': '#9ad62a', '3 min': '#6fb52a', '10 min': '#a1a1aa', '15 min': '#7c7c86', '30 min': '#56565f', '60 min': '#3f3f46', 'backing off': 'var(--bad)' };
async function renderSources() {
  const d = await api('/api/discovery'); S.discovery = d;
  const atsAdded = S.meta?.sources.find(s => s.id === 'ats')?.totalAdded || 0;
  const totalUnique = d.yield.reduce((n, y) => n + y.unique, 0) + atsAdded;
  const today = d.log.filter(l => Date.now() - Date.parse(l.at) < 864e5).length;
  if (!$('#discTiles').children.length) $('#discTiles').innerHTML = ['Sources', 'Company boards', 'Found today', 'Roles found'].map((t, i) => `<div class="tile"><span>${t}</span><b data-t="${i}" data-v="0">0</b><small id="tileSub${i}"></small></div>`).join('');
  const vals = [d.sourceCount, d.boards, today, totalUnique];
  $$('#discTiles b').forEach((b, i) => tickTo(b, vals[i]));
  $('#tileSub0').textContent = `${d.lists.filter(l => !l.disabled).length} found automatically`;
  $('#tileSub1').textContent = { saver: 'checked every 30 min–2 h', slow: 'checked every 6–24 h' }[d.pace] || 'checked every 1–60 min';
  $('#tileSub2').textContent = 'new boards and lists'; $('#tileSub2').className = today ? 'up' : '';
  $('#tileSub3').textContent = 'duplicates removed';
  const tiers = Object.entries(d.tiers).filter(([, n]) => n);
  $('#tierBar').innerHTML = tiers.map(([k, n]) => `<div style="flex:${n};background:${TIER_COLORS[k]}" title="${k}: ${n}"></div>`).join('');
  $('#tierLegend').innerHTML = tiers.map(([k, n]) => `<span><i style="background:${TIER_COLORS[k]}"></i>${d.tierLabels?.[k] || k} · ${fmt(n)}</span>`).join('');
  const via = Object.entries(d.byVia).sort((a, b) => b[1] - a[1]); const max = Math.max(1, ...via.map(v => v[1]));
  $('#viaList').innerHTML = via.map(([k, n]) => `<div class="barrow"><span>${esc(k)}</span><div class="bt"><div style="width:${100 * n / max}%"></div></div><b>${fmt(n)}</b></div>`).join('');
  $('#discLog').innerHTML = d.log.length ? d.log.map(l => `<li><time>${ago(Date.parse(l.at))}</time><div><span class="k ${l.kind}">${l.kind === 'board' ? 'board' : l.kind === 'source' ? 'new list' : 'retired'}</span>${esc(l.text)} <small>via ${esc(l.via)}</small></div></li>`).join('') : '<li><time></time><div class="muted">Discoveries will appear here.</div></li>';
  // sources table
  const yieldOf = id => d.yield.find(y => y.id === id) || { seen: 0, unique: 0 };
  const srcRows = (S.meta?.sources || []).map(s => { const y = yieldOf(s.id); const pct = y.seen ? Math.round(100 * y.unique / y.seen) : 0; const state = s.running ? '<span class="state live">Polling</span>' : s.ok === false ? `<span class="state bad" title="${esc(s.error || '')}">Error</span>` : s.at ? '<span class="state ok">OK</span>' : '<span class="state">Queued</span>';
    return `<tr class="${s.off ? 'src-off' : ''}" title="${esc(s.trust || '')}"><td>${s.id === 'ats' || s.kind !== 'jobs' ? '' : `<input type="checkbox" class="switch" data-src="${esc(s.id)}" ${s.off ? '' : 'checked'} title="${s.off ? 'Switched off' : 'Checking'}">`}</td><td>${s.home ? `<a class="u" href="${esc(s.home)}" target="_blank" rel="noreferrer">${esc(s.name)}</a>` : esc(s.name)}${s.dynamic ? ' <span class="tag good" title="Lookout found this list on its own">auto</span>' : ''}</td><td>${state}</td><td class="mono muted">${s.every >= 3600 ? Math.round(s.every / 3600) + 'h' : s.every >= 60 ? Math.round(s.every / 60) + 'm' : s.every + 's'}</td><td class="mono muted">${s.at ? ago(Date.parse(s.at)) : '—'}</td><td class="num">${s.id === 'ats' || s.id === 'funding' ? fmt(s.totalAdded || s.added || 0) : `<span class="yieldbar"><span style="width:${pct}%"></span></span>${fmt(y.unique)}`}</td></tr>`; }).join('');
  $('#srcTable').innerHTML = `<thead><tr><th style="width:44px">On</th><th>Source</th><th>Status</th><th>Every</th><th>Last check</th><th class="num">Roles found first</th></tr></thead><tbody>${srcRows}</tbody>`;
  $('#watchList').innerHTML = (S.meta?.watch || []).map(w => `<span class="chip"><span class="k">${esc(w.provider)}</span><span class="v">${esc(w.name)}</span><button data-unwatch="${w.id}">${ic('x')}</button></span>`).join('');
  hydrateIcons($('#v-sources'));
  $$('[data-src]').forEach(c => c.onchange = async () => { await api('/api/sources/toggle', { method: 'POST', body: JSON.stringify({ id: c.dataset.src, on: c.checked }) }); await loadMeta(); renderSources(); });
  $$('[data-unwatch]').forEach(b => b.onclick = async () => { await api('/api/watch/' + b.dataset.unwatch, { method: 'DELETE' }); await loadMeta(); renderSources(); });
  $('#nSources').textContent = fmt(d.boards);
}
$('#watchForm').onsubmit = async e => {
  e.preventDefault(); const f = e.target; $('#watchMsg').innerHTML = '<span class="spin"></span>';
  try { const w = await api('/api/watch', { method: 'POST', body: JSON.stringify({ name: f.name.value, url: f.url.value }) }); $('#watchMsg').textContent = `Watching ${w.name}.`; f.reset(); await loadMeta(); renderSources(); }
  catch (err) { $('#watchMsg').textContent = err.message; }
};

// ───────────────────────────────────────────── settings
function renderSettings() {
  const s = S.meta.settings; const f = $('#pushForm');
  f.ntfyTopic.value = s.ntfyTopic || ''; f.ntfyServer.value = s.ntfyServer || 'https://ntfy.sh'; f.ntfyToken.value = s.hasToken ? '••••' : ''; f.quietHours.value = s.quietHours || ''; f.desktopNotify.checked = !!s.desktopNotify;
  if (document.activeElement !== $('#liForm').searches) $('#liForm').searches.value = (s.linkedinSearches || []).map(x => [x.keywords, x.location || 'Worldwide', x.remote ? 'remote' : ''].filter(Boolean).join(' | ')).join('\n');
  if (!$('#topicIdea').textContent) $('#topicIdea').textContent = 'lookout-' + crypto.getRandomValues(new Uint32Array(2)).reduce((a, n) => a + n.toString(36), '');
  renderProfile(); renderSourcesCard(); renderAccess(); renderReadCard(); renderLearn();
  $('#alertNote').textContent = s.ntfyTopic ? '' : 'Phone not connected yet'; syncAppearance();
  const bl = S.meta.blockedCompanies || [];
  $('#blockedList').innerHTML = bl.length ? bl.map(c => `<span class="chip"><span class="v">${esc(c)}</span><button data-unblock="${esc(c)}" title="Unblock">${ic('x')}</button></span>`).join('') : '<span class="muted small">None</span>';
  $$('[data-unblock]').forEach(b => b.onclick = async () => { const r = await api('/api/block', { method: 'POST', body: JSON.stringify({ company: b.dataset.unblock, block: false }) }); S.meta.blockedCompanies = r.blockedCompanies; renderSettings(); refreshJobs(); });
  const allAlerts = S.meta.alerts; const shown = S.showAllAlerts ? allAlerts : allAlerts.slice(0, 8);
  setTimeout(() => {
    const log = $('#alertLog'); $$('.alert-row', log).forEach((r, i) => { r.style.cursor = 'pointer'; r.onclick = () => { location.hash = '#jobs'; setTimeout(() => select(shown[i].jobId), 30); }; });
    if (allAlerts.length > 8 && !S.showAllAlerts) { const b = document.createElement('button'); b.className = 'link small'; b.style.marginTop = '8px'; b.textContent = `Show all ${allAlerts.length}`; b.onclick = () => { S.showAllAlerts = true; renderSettings(); }; log.append(b); }
  });
  $('#alertLog').innerHTML = allAlerts.length ? shown.map(a => `<div class="alert-row"><span>${esc(a.company)} · ${esc(a.title)}<small>${esc(a.sets.join(', '))}</small></span><span class="mono muted">${ago(Date.parse(a.at))}</span></div>`).join('') : '<p class="muted" style="margin:0">None yet.</p>';
}
$('#pushForm').onsubmit = async e => {
  e.preventDefault(); const f = e.target;
  await api('/api/settings', { method: 'POST', body: JSON.stringify({ ntfyTopic: f.ntfyTopic.value, ntfyServer: f.ntfyServer.value, ntfyToken: f.ntfyToken.value, quietHours: f.quietHours.value, desktopNotify: f.desktopNotify.checked }) });
  if (f.desktopNotify.checked && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  $('#pushMsg').textContent = 'Saved'; await loadMeta();
};
$('#testPush').onclick = async () => { $('#pushMsg').textContent = 'Sending…'; try { await api('/api/test-push', { method: 'POST' }); $('#pushMsg').textContent = 'Sent'; } catch (e) { $('#pushMsg').textContent = e.message; } };
$('#liForm').onsubmit = async e => {
  e.preventDefault(); const f = e.target;
  const linkedinSearches = f.searches.value.split('\n').map(l => l.split('|').map(x => x.trim())).filter(p => p[0]).map(p => ({ keywords: p[0], location: p[1] || 'Worldwide', remote: /^remote$/i.test(p[2] || '') }));
  await api('/api/settings', { method: 'POST', body: JSON.stringify({ linkedinSearches }) });
  $('#liMsg').textContent = linkedinSearches.length ? `Saved. Checking ${linkedinSearches.length} search${linkedinSearches.length > 1 ? 'es' : ''} now` : 'Saved. LinkedIn is off'; await loadMeta();
};
// ───────────────────────────────────────────── profile, résumé, profiles
const P = { dirty: false, skills: [], manual: [], resumeSkills: [], resume: null, for: null }; // the profile being edited
// Sorts links into the GitHub / LinkedIn / site / other boxes (the server does the same for old profiles).
const NOT_SITE = /(^|\.)(github\.com|linkedin\.com|leetcode\.com|kaggle\.com|huggingface\.co|stackoverflow\.com|medium\.com|dev\.to|behance\.net|dribbble\.com|devpost\.com|gitlab\.com|x\.com|twitter\.com|instagram\.com|youtube\.com|codeforces\.com|codechef\.com|hackerrank\.com)$/;
function sortLinks(list) {
  const out = { github: '', linkedin: '', portfolio: '', other: [] };
  for (const raw of list) { let u; try { u = new URL(/^https?:/i.test(raw) ? raw : `https://${raw}`); } catch { continue; } const h = u.hostname.replace(/^www\./, ''); const s = u.href.replace(/\/$/, '');
    if (h === 'github.com' && u.pathname.split('/').filter(Boolean).length === 1 && !out.github) out.github = s;
    else if (/(^|\.)linkedin\.com$/.test(h) && /\/in\//.test(u.pathname) && !out.linkedin) out.linkedin = s.replace(/[?#].*$/, '');
    else if (!NOT_SITE.test(h) && !out.portfolio) out.portfolio = s;
    else if (!out.other.includes(s)) out.other.push(s); }
  return out;
}
const lvlOf = v => v >= 0.75 ? 'strong' : v >= 0.45 ? 'working' : 'familiar';
const eduLine = e => [e.degree, e.school !== e.degree ? e.school : '', [e.start, e.end].filter(Boolean).join('–'), e.grade].filter(Boolean).join(', ');
function renderProfile() {
  const list = S.meta.profiles || []; const active = list.find(x => x.active) || list[0] || { id: 'p1', label: 'Me' };
  $('#profSel').innerHTML = list.map(x => `<option value="${esc(x.id)}" ${x.active ? 'selected' : ''}>${esc(x.label)}</option>`).join('');
  $('#profDel').disabled = list.length < 2;
  const p = profile(); const f = $('#profileForm');
  if (!P.dirty || P.for !== active.id) {
    P.for = active.id; P.dirty = false; P.skills = [...(p.skills || [])]; P.manual = [...(p.manualSkills || [])]; P.resumeSkills = [...(p.resumeSkills || [])]; P.resume = p.resume || null; P.linkedin = null;
    for (const k of ['name', 'headline', 'email', 'pitch', 'degree', 'github', 'linkedin', 'portfolio']) f[k].value = p[k] || '';
    f.otherLinks.value = (p.otherLinks || []).join('\n'); f.rescan.checked = !!p.rescan;
    f.yearsExp.value = p.yearsExp ?? ''; f.gradYear.value = p.gradYear ?? '';
    f.education.value = (p.education || []).join('\n'); f.experience.value = (p.experience || []).join('\n');
    f.projects.value = (p.projects || []).join('\n'); f.strictFit.checked = p.strictFit !== false;
  }
  $('#cvNote').textContent = P.resume ? `Last read: ${P.resume.file || 'pasted text'}, ${agoLong(Date.parse(P.resume.at))}` : '';
  renderSkillChips(); renderScan();
}
function renderSkillChips() {
  const sorted = [...P.skills].sort((a, b) => skillInfo(b).tech - skillInfo(a).tech);
  const tech = sorted.filter(s => skillInfo(s).tech).length;
  const p = profile(); const str = p.strength || {}; const notes = p.skillNotes || {}; const k = s => skillInfo(s).canonical.toLowerCase();
  const scanned = Object.keys(str).length > 0;
  $('#skillChips').innerHTML = sorted.map(s => { const v = str[k(s)]; const lv = scanned && v != null ? lvlOf(v) : '';
    return `<span class="chip ${skillInfo(s).tech ? 'tech' : 'gen'} ${lv ? `lv-${lv}` : ''}" ${notes[k(s)] ? `title="${esc(`${lv[0]?.toUpperCase() + lv.slice(1)}: ${notes[k(s)]}`)}"` : ''}>${lv ? `<i class="lv" aria-label="${lv}"></i>` : ''}<span class="v">${esc(s)}</span><button type="button" data-rm="${esc(s)}" title="Remove">${ic('x')}</button></span>`; }).join('') || '<span class="muted small">None yet. Import a résumé or type below.</span>';
  const counts = scanned ? ['strong', 'working', 'familiar'].map(l => [l, P.skills.filter(s => str[k(s)] != null && lvlOf(str[k(s)]) === l).length]).filter(x => x[1]) : [];
  $('#skillCount').textContent = P.skills.length ? `${tech} technical${P.skills.length - tech ? `, ${P.skills.length - tech} general` : ''}${counts.length ? ` · ${counts.map(([l, n]) => `${n} ${l}`).join(', ')}` : ''}` : '';
  $$('[data-rm]', $('#skillChips')).forEach(b => b.onclick = () => { P.skills = P.skills.filter(s => s !== b.dataset.rm); P.manual = P.manual.filter(s => s !== b.dataset.rm); P.dirty = true; renderSkillChips(); });
}
function addSkills(raw, byHand = false) {
  const have = new Set(P.skills.map(s => skillInfo(s).canonical.toLowerCase())); let n = 0;
  for (const t of String(raw).split(/[,;\n]/).map(s => s.trim()).filter(Boolean)) { const c = skillInfo(t).canonical; if (c.length > 40 || have.has(c.toLowerCase())) continue; have.add(c.toLowerCase()); P.skills.push(c); if (byHand) P.manual.push(c); n++; }
  if (n) { P.dirty = true; renderSkillChips(); } return n;
}
$('#skillAdd').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addSkills(e.target.value, true); e.target.value = ''; } });
$('#skillAdd').addEventListener('blur', e => { if (e.target.value.trim()) { addSkills(e.target.value, true); e.target.value = ''; } });
$('#profileForm').addEventListener('input', () => { P.dirty = true; });
async function saveProfile(msg = 'Saved') {
  const f = $('#profileForm'); const lines = v => v.split('\n').map(s => s.trim()).filter(Boolean);
  if (f.skillAdd.value.trim()) { addSkills(f.skillAdd.value, true); f.skillAdd.value = ''; }
  const body = { name: f.name.value, headline: f.headline.value, link: '', email: f.email.value, pitch: f.pitch.value, degree: f.degree.value, yearsExp: f.yearsExp.value, gradYear: f.gradYear.value, education: lines(f.education.value), experience: lines(f.experience.value), projects: lines(f.projects.value), strictFit: f.strictFit.checked, skills: P.skills, manualSkills: P.manual, resumeSkills: P.resumeSkills, resume: P.resume,
    github: f.github.value.trim(), linkedin: f.linkedin.value.trim(), portfolio: f.portfolio.value.trim(), otherLinks: lines(f.otherLinks.value), rescan: f.rescan.checked, ...(P.linkedin ? { linkedinSkills: P.linkedin.skills, linkedinPdf: P.linkedin.pdf } : {}) };
  await api('/api/settings', { method: 'POST', body: JSON.stringify({ profile: body }) });
  P.dirty = false; $('#profileMsg').textContent = msg; await loadMeta(); renderProfile(); evCache = null; renderList();
}
$('#profileForm').onsubmit = e => { e.preventDefault(); saveProfile().catch(err => { $('#profileMsg').textContent = err.message; }); };

// Résumé: read on this computer by the scanner, then merged into the profile being edited.
async function importResume(src) {
  const say = t => { $('#cvMsg').textContent = t; $('#welcomeMsg').textContent = t; };
  say('Reading…');
  try {
    const r = typeof src === 'string'
      ? await api('/api/resume', { method: 'POST', body: JSON.stringify({ text: src }) })
      : await fetch(`/api/resume?name=${encodeURIComponent(src.name)}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: src }).then(async x => { const d = await x.json().catch(() => ({})); if (!x.ok) throw new Error(d.error || 'That file could not be read.'); return d; });
    const d = r.parsed; const f = $('#profileForm');
    if (!S.meta.profiles) await loadMeta();
    renderProfile();
    const fill = (k, v) => { if (v && !f[k].value.trim()) f[k].value = v; };
    fill('name', d.name); fill('headline', d.headline); fill('email', d.email); fill('pitch', d.summary);
    { const s = sortLinks(d.links || []); fill('github', s.github); fill('linkedin', s.linkedin); fill('portfolio', s.portfolio);
      const have = new Set(f.otherLinks.value.split('\n').map(x => x.trim()).filter(Boolean)); for (const u of s.other) have.add(u); f.otherLinks.value = [...have].join('\n'); }
    if (d.education.length) f.education.value = d.education.map(eduLine).join('\n');
    if (d.experience.length) f.experience.value = d.experience.map(x => `${x.title} (${x.from} – ${x.to}${x.internship ? `, ${x.months} month${x.months > 1 ? 's' : ''}` : ''})`).join('\n');
    if (d.projects?.length) f.projects.value = d.projects.map(x => `${x.name}${x.year ? ` (${x.year})` : ''}${x.stack.length ? ` · ${x.stack.join(', ')}` : ''}`).join('\n');
    f.yearsExp.value = d.yearsExp; // internships are listed above but do not count as years
    if (d.degree) f.degree.value = d.degree; if (d.gradYear) f.gradYear.value = d.gradYear;
    // A new résumé replaces what the last one gave; only skills you typed in yourself carry over.
    P.skills = [...P.manual];
    const added = addSkills(d.skills.map(s => s.name).join('\n'));
    P.resumeSkills = d.skills.map(s => skillInfo(s.name).canonical);
    P.resume = { file: r.file || '', at: new Date().toISOString(), chars: d.chars }; P.dirty = true;
    const tech = d.skills.filter(s => s.tech).length;
    const found = [`${tech} technical skill${tech === 1 ? '' : 's'}`, d.education.length && `${d.education.length} education entr${d.education.length > 1 ? 'ies' : 'y'}`, d.experience.length && `${d.experience.length} role${d.experience.length > 1 ? 's' : ''} (${d.experience.filter(x => x.internship).length} internship${d.experience.filter(x => x.internship).length === 1 ? '' : 's'}, ${d.yearsExp} years of full-time work)`, d.projects?.length && `${d.projects.length} projects`].filter(Boolean).join(', ');
    await saveProfile('Saved');
    say(`Found ${found}. Saved to this profile; check it over below.`);
    return true;
  } catch (e) { say(e.message); return false; }
}
// LinkedIn's "Save to PDF": adds to the profile (skills, roles, links) instead of replacing what the résumé gave
async function importLinkedIn(file) {
  const say = t => { $('#scanMsg').textContent = t; };
  say('Reading your LinkedIn PDF…');
  try {
    const r = await fetch(`/api/resume?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file }).then(async x => { const d = await x.json().catch(() => ({})); if (!x.ok) throw new Error(d.error || 'That file could not be read.'); return d; });
    const d = r.parsed; const f = $('#profileForm');
    if (d.source !== 'linkedin') { say('That doesn’t look like the PDF LinkedIn makes. On your LinkedIn profile choose More → Save to PDF, then pick that file. If it is your résumé, use Import your résumé above.'); return; }
    const fill = (k, v) => { if (v && !f[k].value.trim()) f[k].value = v; };
    fill('name', d.name); fill('headline', d.headline); fill('email', d.email); fill('pitch', d.summary);
    const s = sortLinks(d.links || []); fill('linkedin', s.linkedin); fill('github', s.github); fill('portfolio', s.portfolio);
    const roles = f.experience.value.split('\n').map(x => x.trim()).filter(Boolean); const known = new Set(roles.map(x => x.toLowerCase().slice(0, 24)));
    let addedRoles = 0; for (const x of d.experience) { const line = `${x.title} (${x.from} – ${x.to}${x.internship ? `, ${x.months} month${x.months > 1 ? 's' : ''}` : ''})`; if (!known.has(line.toLowerCase().slice(0, 24))) { roles.push(line); addedRoles++; } }
    f.experience.value = roles.join('\n');
    if (!f.education.value.trim() && d.education.length) f.education.value = d.education.map(eduLine).join('\n');
    // profiles from before Lookout noted where each skill came from: what is there now came from the résumé (or was typed)
    if (!P.resumeSkills.length && P.resume) P.resumeSkills = P.skills.filter(s => !P.manual.includes(s));
    const names = d.skills.map(x => skillInfo(x.name).canonical); const before = P.skills.length; addSkills(names.join('\n'));
    P.linkedin = { skills: names, pdf: { file: file.name, at: new Date().toISOString() } }; P.dirty = true;
    await saveProfile('Saved');
    say(`From LinkedIn: ${names.length} skill${names.length === 1 ? '' : 's'} (${P.skills.length - before} new), ${addedRoles} role${addedRoles === 1 ? '' : 's'} added. Check them over below.`);
  } catch (e) { say(e.message); }
}
$('#liPick').onclick = () => $('#liFile').click();
$('#liFile').onchange = async e => { const file = e.target.files[0]; e.target.value = ''; if (file) await importLinkedIn(file); };
$('#cvPick').onclick = () => $('#cvFile').click();
$('#cvFile').onchange = async e => { const file = e.target.files[0]; e.target.value = ''; if (file) await importResume(file); };
{ const drop = $('#cvDrop'); for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); });
  drop.addEventListener('drop', e => { const file = e.dataTransfer?.files?.[0]; if (file) importResume(file); }); }
let pasteThen = null;
const openPaste = then => { pasteThen = then || null; $('#cvText').value = ''; $('#cvDlg').showModal(); };
$('#cvPaste').onclick = () => openPaste();
$('#cvCancel').onclick = () => $('#cvDlg').close('cancel');
$('#cvDlg').addEventListener('close', async () => { if ($('#cvDlg').returnValue !== 'ok') return; const ok = await importResume($('#cvText').value); pasteThen?.(ok); });
// ── "Scan my links": progress, suggested skills, projects found ───────────────────────────────────────
function scanProgressText(st) {
  const pr = st?.progress; if (!pr) return 'Starting…';
  if (pr.step === 'github') return `Reading GitHub${pr.total > 1 ? ` (${pr.done + 1} of ${pr.total})` : ''}${pr.name ? `: ${pr.name}` : ''}…`;
  if (pr.step === 'sites') return `Reading ${pr.name || 'your site'}…`;
  if (pr.step === 'demos') return `Checking a live demo: ${pr.name}…`;
  return 'Starting…';
}
function renderScan() {
  const p = profile(); const sc = p.scan; const st = S.meta?.scanState; const out = $('#scanOut'); if (!out) return;
  const running = st?.running && st.profileId === (S.meta.profiles || []).find(x => x.active)?.id;
  $('#scanBtn').disabled = !!running; $('#scanBtn').textContent = running ? 'Scanning…' : sc ? 'Scan again' : 'Scan my links';
  if (running) $('#scanMsg').textContent = scanProgressText(st);
  else if (sc) {
    const pages = (sc.pages || []).filter(x => x.ok).length;
    $('#scanMsg').textContent = `Last scanned ${agoLong(Date.parse(sc.at))}: ${[sc.github ? `${sc.github.repos} GitHub repositor${sc.github.repos === 1 ? 'y' : 'ies'}` : '', pages ? `${pages} page${pages > 1 ? 's' : ''}` : ''].filter(Boolean).join(' and ') || 'nothing could be read'}${sc.browser ? ` (pages that needed JavaScript were read with ${sc.browser}, hidden)` : ''}.`;
  } else $('#scanMsg').textContent = st?.error ? `The last scan failed: ${st.error}` : '';
  const sug = (p.suggestions || []).filter(s => !P.skills.some(x => skillInfo(x).canonical.toLowerCase() === s.name.toLowerCase()));
  const found = Object.entries(sc?.foundLinks || {}).filter(([k, u]) => u && !$('#profileForm')[k]?.value.trim());
  const projects = (p.projectsFound || []);
  const have = new Set($('#profileForm').projects.value.toLowerCase().split('\n').map(l => l.split(/[(·]/)[0].trim()));
  out.innerHTML = `
    ${found.length ? `<div class="scan-sec"><div class="lab">Found while scanning</div>${found.map(([k, u]) => `<div class="found-link"><span>${esc({ portfolio: 'Your site', linkedin: 'LinkedIn', github: 'GitHub' }[k])}: <a href="${esc(u)}" target="_blank" rel="noreferrer">${esc(u.replace(/^https?:\/\//, ''))}</a></span><button type="button" class="btn sm" data-uselink="${esc(k)}" data-url="${esc(u)}">Use it</button></div>`).join('')}</div>` : ''}
    ${sug.length ? `<div class="scan-sec"><div class="lab">Your work shows these, but your profile doesn’t list them <button type="button" class="link small" id="sugAll">Add all ${sug.length}</button></div>
      <div class="chipset">${sug.map(s => `<span class="chip sug lv-${s.level}" title="${esc(`${s.level[0].toUpperCase() + s.level.slice(1)}: ${s.why}`)}"><i class="lv"></i><span class="v">${esc(s.name)}</span><button type="button" data-acc="${esc(s.name)}" title="Add to my skills">${ic('plus')}</button><button type="button" data-ign="${esc(s.name)}" title="Not mine, don’t suggest it again">${ic('x')}</button></span>`).join('')}</div>
      <p class="fine">Hover a skill to see where it was found. Strong means your own code uses it recently; familiar means it shows up once or long ago.</p></div>` : sc ? '<p class="fine">Nothing new to suggest: your profile already lists what your links show.</p>' : ''}
    ${projects.length ? `<div class="scan-sec"><div class="lab">Projects found</div>${projects.map((x, i) => `<div class="proj"><div><a href="${esc(x.url)}" target="_blank" rel="noreferrer">${esc(x.name)}</a>${x.at ? `<span class="muted small"> · updated ${agoLong(Date.parse(x.at))}</span>` : ''}${x.about ? `<div class="muted small">${esc(x.about)}</div>` : ''}${x.stack.length ? `<div class="chipset">${x.stack.map(s => `<span class="sk">${esc(s)}</span>`).join('')}</div>` : ''}</div>${have.has(x.name.toLowerCase()) ? '<span class="muted small">In your projects</span>' : `<button type="button" class="btn sm ghost" data-proj="${i}">Add to projects</button>`}</div>`).join('')}</div>` : ''}
    ${(sc?.notes || []).length ? `<ul class="scan-notes">${sc.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`;
  const after = async r => { if (r?.profile) { const a = S.meta.profiles.find(x => x.active); S.meta.settings.profile = r.profile; } renderSkillChips(); renderScan(); evCache = null; renderList(); };
  $$('[data-acc]', out).forEach(b => b.onclick = async () => { const n = b.dataset.acc; addSkills(n); await after(await api('/api/profile/skills', { method: 'POST', body: JSON.stringify({ accept: [n] }) })); });
  $$('[data-ign]', out).forEach(b => b.onclick = async () => after(await api('/api/profile/skills', { method: 'POST', body: JSON.stringify({ ignore: [b.dataset.ign] }) })));
  $('#sugAll')?.addEventListener('click', async () => { const names = sug.map(s => s.name); addSkills(names.join('\n')); await after(await api('/api/profile/skills', { method: 'POST', body: JSON.stringify({ accept: names }) })); });
  $$('[data-uselink]', out).forEach(b => b.onclick = () => { $('#profileForm')[b.dataset.uselink].value = b.dataset.url; P.dirty = true; saveProfile('Saved. Scan again to read it.').catch(e => { $('#profileMsg').textContent = e.message; }); });
  $$('[data-proj]', out).forEach(b => b.onclick = () => { const x = projects[+b.dataset.proj]; const f = $('#profileForm'); f.projects.value = [f.projects.value.trim(), `${x.name}${x.at ? ` (${new Date(x.at).getFullYear()})` : ''}${x.stack.length ? ` · ${x.stack.join(', ')}` : ''}`].filter(Boolean).join('\n'); P.dirty = true; renderScan(); $('#profileMsg').textContent = 'Added to Projects. Save to keep it.'; });
}
$('#scanBtn').onclick = async () => {
  try {
    if (P.dirty || ['github', 'portfolio', 'linkedin', 'otherLinks'].some(k => $('#profileForm')[k].value.trim() !== (Array.isArray(profile()[k]) ? profile()[k].join('\n') : profile()[k] || ''))) await saveProfile('Saved');
    await api('/api/profile/scan', { method: 'POST', body: '{}' });
    S.meta.scanState = { running: true, profileId: (S.meta.profiles || []).find(x => x.active)?.id, progress: null }; renderScan();
  } catch (e) { $('#scanMsg').textContent = e.message; }
};
function renderReadCard() {
  api('/api/browsers').then(r => {
    const sel = $('#browserSel'); const usable = r.browsers.filter(b => b.usable);
    sel.innerHTML = `<option value="auto">Automatic${r.choice === 'auto' && r.using ? ` (${esc(r.using.name)})` : ''}</option>${usable.map(b => `<option value="${esc(b.id)}">${esc(b.name)}${b.isDefault ? ' (your default)' : ''}${b.auto ? '' : ' (only if picked)'}</option>`).join('')}<option value="none">Don’t use a browser</option>`;
    sel.value = [...sel.options].some(o => o.value === r.choice) ? r.choice : 'auto';
    const ff = r.browsers.find(b => b.engine === 'firefox');
    $('#readStatus').textContent = r.using ? `Using ${r.using.name}` : 'No browser found';
    $('#browserNote').textContent = !usable.length ? 'No Chrome, Edge, Brave, Vivaldi, Chromium or Opera was found, so JavaScript-heavy pages are read as plain downloads. GitHub and most sites still work.'
      : `Found ${usable.map(b => b.name).join(', ')}.${ff ? ' Firefox was found too, but Lookout can’t drive it yet.' : ''}`;
    $('#readForm').githubToken.value = S.meta.settings.hasGithubToken ? '••••' : '';
  }).catch(() => { });
}
$('#readForm').onsubmit = async e => { e.preventDefault(); const f = e.target; await api('/api/settings', { method: 'POST', body: JSON.stringify({ browser: f.browser.value, githubToken: f.githubToken.value }) }); await loadMeta(); renderReadCard(); $('#readMsg').textContent = 'Saved'; };
function renderLearn() {
  const on = S.meta?.learn !== false; $('#learnToggle').checked = on;
  if (!on) { $('#learnMsg').textContent = 'Off: Best match ranks by freshness and skill fit only.'; return; }
  model(); const m = learned || { pos: 0, neg: 0 };
  if (!m.ready) { $('#learnMsg').textContent = `It starts once you have saved or applied to 5 roles and acted on 15 in all (so far ${m.pos} saved or applied, ${m.neg} hidden).`; return; }
  const ex = explain(m); const list = a => a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a.at(-1)}` : a[0] || '';
  $('#learnMsg').textContent = `Learning from ${m.pos} role${m.pos === 1 ? '' : 's'} you went for and ${m.neg} you passed on.${ex.toward.length ? ` It leans toward ${list(ex.toward)}.` : ''}${ex.away.length ? ` Away from ${list(ex.away)}.` : ''}`;
}
$('#learnToggle').onchange = async e => { await api('/api/settings', { method: 'POST', body: JSON.stringify({ learn: e.target.checked }) }); await loadMeta(); learnedSig = ''; renderLearn(); evCache = null; renderList(); };
$('#browserAgain').onclick = async () => { $('#readMsg').textContent = 'Looking…'; await api('/api/browsers?again=1'); renderReadCard(); $('#readMsg').textContent = ''; };
$('#rankNow').onclick = () => { S.sort = 'best'; ls.set('lk2.sort', 'best'); renderSort(); location.hash = '#jobs'; renderList(); };

// Profiles: each has its own résumé, skills, saved views, pipeline and blocked companies.
function renderWho() {
  const list = S.meta?.profiles || []; const a = list.find(x => x.active); if (!a) return;
  $('#whoName').textContent = a.label; $('#whoAv').textContent = (a.label.trim()[0] || '?').toUpperCase();
}
async function profileAction(body) {
  await api('/api/profiles', { method: 'POST', body: JSON.stringify(body) });
  if (body.action === 'rename') { await loadMeta(); renderProfile(); return; }
  // a different person: their views and filters, not the last ones used in this window
  try { localStorage.removeItem('lk2.filters'); localStorage.removeItem('lk2.view'); } catch { }
  location.hash = body.action === 'create' ? '#settings' : location.hash; location.reload();
}
let nameThen = null;
function askName(title, value, hint, then) { $('#nameTitle').textContent = title; $('#nameHint').textContent = hint; $('#nameForm').label.value = value; nameThen = then; $('#nameDlg').showModal(); $('#nameForm').label.select(); }
$('#nameCancel').onclick = () => $('#nameDlg').close('cancel');
$('#nameDlg').addEventListener('close', () => { const v = $('#nameForm').label.value.trim(); if ($('#nameDlg').returnValue === 'ok' && v) nameThen?.(v); });
const newProfile = () => askName('New profile', '', 'A separate résumé, skills, saved views and pipeline. Use one per person, or one per kind of role you are going for.', label => profileAction({ action: 'create', label }).catch(e => toast(e.message)));
$('#profNew').onclick = newProfile;
$('#profRename').onclick = () => { const a = S.meta.profiles.find(x => x.active); askName('Rename profile', a.label, '', label => profileAction({ action: 'rename', id: a.id, label }).catch(e => toast(e.message))); };
$('#profDel').onclick = () => { const a = S.meta.profiles.find(x => x.active); toast(`Delete the profile “${a.label}” with its views and pipeline?`, { action: ['Delete', () => profileAction({ action: 'delete', id: a.id }).catch(e => toast(e.message))], ms: 9000 }); };
$('#profSel').onchange = e => profileAction({ action: 'switch', id: e.target.value }).catch(err => toast(err.message));
$('#who').onclick = () => {
  const list = S.meta.profiles || [];
  $('#whoList').innerHTML = list.map(x => `<button type="button" class="who-row ${x.active ? 'on' : ''}" data-id="${esc(x.id)}"><span class="who-av">${esc((x.label.trim()[0] || '?').toUpperCase())}</span><span>${esc(x.label)}</span>${x.active ? '<small>Open now</small>' : ''}</button>`).join('');
  $$('.who-row', $('#whoList')).forEach(b => b.onclick = () => { $('#whoDlg').close(); if (!b.classList.contains('on')) profileAction({ action: 'switch', id: b.dataset.id }).catch(e => toast(e.message)); });
  $('#whoDlg').showModal();
};
$('#whoNew').onclick = () => { $('#whoDlg').close(); newProfile(); };
$('#whoEdit').onclick = () => { $('#whoDlg').close(); location.hash = '#settings'; };
$('#whoClose').onclick = () => $('#whoDlg').close();

// First look at an empty profile: offer the résumé once.
function maybeWelcome() {
  const a = (S.meta.profiles || []).find(x => x.active); const p = profile();
  if (!a || p.skills?.length || p.resume || ls.get(`lk2.welcomed.${a.id}`, false)) return;
  $('#welcomeTitle').textContent = (S.meta.profiles || []).length > 1 ? `Set up ${a.label}` : 'Start with your résumé'; $('#welcomeMsg').textContent = ''; $('#welcomeDlg').showModal();
}
{ const done = () => { const a = (S.meta.profiles || []).find(x => x.active); if (a) ls.set(`lk2.welcomed.${a.id}`, true); };
  const finish = ok => { if (!ok) return; done(); $('#welcomeDlg').close(); location.hash = '#settings'; };
  $('#welcomeDlg').addEventListener('close', done);
  $('#welcomeSkip').onclick = () => $('#welcomeDlg').close();
  $('#welcomePick').onclick = () => $('#welcomeFile').click();
  $('#welcomeFile').onchange = async e => { const file = e.target.files[0]; e.target.value = ''; if (file) finish(await importResume(file)); };
  $('#welcomePaste').onclick = () => openPaste(finish); }

// "My skills" / "Clear" in the Skills filter
$('#sheetBody').addEventListener('click', e => {
  if (e.target.closest('[data-noskills]')) return setFilters({ skills: [], notSkills: [] });
  if (!e.target.closest('[data-myskills]')) return;
  const mine = (profile().skills || []).filter(s => skillInfo(s).tech);
  if (!mine.length) { toast('Your profile has no skills yet', { action: ['Add them', () => { closeSheet(); location.hash = '#settings'; }] }); return; }
  setFilters({ skills: mine, skillsAll: false });
});

// ───────────────────────────────────────────── browser extension and other devices
let access = null, keyShown = false;
async function renderAccess() {
  try { access = await api('/api/access'); } catch { return; }
  $('#extFolder').textContent = access.extFolder;
  $('#extKey').textContent = keyShown ? access.extKey : '•'.repeat(24);
  $('#extStatus').textContent = access.extSeen ? `Paired · last used ${agoLong(Date.parse(access.extSeen))}` : 'Not paired yet';
  $('#devCard').hidden = !access.lan;
  $('#devLinks').innerHTML = access.deviceLinks.map(u => `<span class="chip"><span class="v" style="max-width:none">${esc(u.replace(/key=.*/, 'key=…'))}</span><button data-copylink="${esc(u)}" title="Copy link">${ic('copy')}</button></span>`).join('') || '<span class="muted small">No network address found.</span>';
  hydrateIcons($('#devCard'));
  $$('[data-copylink]').forEach(b => b.onclick = () => { navigator.clipboard?.writeText(b.dataset.copylink); toast('Link copied. Open it on your phone', { ms: 3000 }); });
}
$('#extShow').onclick = () => { keyShown = !keyShown; $('#extShow').textContent = keyShown ? 'Hide' : 'Show'; renderAccess(); };
$('#extCopy').onclick = async () => { if (!access) await renderAccess(); navigator.clipboard?.writeText(access.extKey); $('#extMsg').textContent = 'Pairing key copied. Paste it into the extension’s options.'; };
$('#extRotate').onclick = async () => { await api('/api/access/rotate', { method: 'POST', body: JSON.stringify({ which: 'ext' }) }); $('#extMsg').textContent = 'New key made. Paste it into the extension again.'; renderAccess(); };
$('#devRotate').onclick = async () => { await api('/api/access/rotate', { method: 'POST', body: JSON.stringify({ which: 'device' }) }); toast('New link made. Devices that used the old one are signed out.'); renderAccess(); };

// ───────────────────────────────────────────── sources: discovery, pace, shared lists
const PACE_NOTE = {
  auto: 'Busy boards every 1 to 3 minutes, quiet ones up to hourly. Best for applying in the first hour.',
  saver: 'Every 30 minutes to 2 hours. Far fewer requests and less battery, but you hear about roles later, and LinkedIn alerts (only sent for roles under 2 hours old) become rare.',
  slow: 'Every 6 to 24 hours: a daily round-up. Phone alerts will mostly arrive too late to be first.',
};
function renderSourcesCard() {
  const s = S.meta.settings; const info = S.meta.sourceInfo || {};
  $('#discoverToggle').checked = s.discover !== false;
  $$('#paceSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === (s.pace || 'auto')));
  $('#paceNote').textContent = PACE_NOTE[s.pace || 'auto'];
  $('#srcSummary').textContent = `${fmt(info.boards || 0)} boards · ${fmt(info.lists || 0)} lists`;
  const st = info.starter;
  $('#starterRow').hidden = !st;
  if (st) { const left = st.boards - st.have; $('#starterNote').textContent = left > 0 ? `${fmt(st.boards)} boards and ${st.lists} lists that were posting roles recently${st.have ? `; you have ${fmt(st.have)} of them` : ''}` : `All ${fmt(st.boards)} boards are already in yours`; $('#starterAdd').disabled = left <= 0; }
}
const srcSay = t => { $('#srcMsg').textContent = t; };
const added = r => `${r.name === 'starter list' ? 'Starter list' : `“${r.name}”`}: added ${fmt(r.added)} board${r.added === 1 ? '' : 's'}${r.lists ? ` and ${r.lists} list${r.lists === 1 ? '' : 's'}` : ''}${r.had ? `, ${fmt(r.had)} you already had` : ''}${r.skipped ? `, ${r.skipped} not understood` : ''}.`;
$('#discoverToggle').onchange = async e => { await api('/api/settings', { method: 'POST', body: JSON.stringify({ discover: e.target.checked }) }); await loadMeta(); renderSourcesCard(); srcSay(e.target.checked ? 'Lookout will add new boards and lists as it finds them.' : 'Lookout will only use the boards and lists you have now, plus any you add.'); };
$$('#paceSeg button').forEach(b => b.onclick = async () => { await api('/api/settings', { method: 'POST', body: JSON.stringify({ pace: b.dataset.v }) }); await loadMeta(); renderSourcesCard(); });
$('#starterAdd').onclick = async () => { srcSay('Adding…'); try { const r = await api('/api/sources/starter', { method: 'POST', body: '{}' }); await loadMeta(); renderSourcesCard(); srcSay(added(r)); } catch (e) { srcSay(e.message); } };
$('#importBtn').onclick = () => $('#importFile').click();
$('#importFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  if (file.size > 8e6) return srcSay('That file is too large to be a sources list.');
  srcSay('Adding…');
  try { const r = await api('/api/sources/import', { method: 'POST', body: JSON.stringify({ text: await file.text() }) }); await loadMeta(); renderSourcesCard(); srcSay(added(r)); } catch (err) { srcSay(err.message); }
};
$('#exportBtn').onclick = () => { $('#exportAll').textContent = `${fmt(S.meta.sourceInfo?.boards || 0)} boards and ${S.meta.sourceInfo?.lists || 0}`; $('#exportDlg').showModal(); };
$('#exportCancel').onclick = () => $('#exportDlg').close('cancel');
$('#exportDlg').addEventListener('close', async () => {
  if ($('#exportDlg').returnValue !== 'ok') return;
  const f = $('#exportForm'); const name = f.name.value.trim() || 'My Lookout sources';
  try {
    const data = await api(`/api/sources/export?scope=${f.scope.value}&name=${encodeURIComponent(name)}`);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    a.download = `${name.replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'lookout-sources'}.json`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    srcSay(`Saved ${fmt(data.boards.length)} boards and ${data.lists.length} lists to ${a.download}.`);
  } catch (e) { srcSay(e.message); }
});
$('#resetBtn').onclick = () => { $('#resetCount').textContent = `${fmt(S.meta.sourceInfo?.boards || 0)} boards and ${S.meta.sourceInfo?.lists || 0} lists`; $('#resetDlg').showModal(); };
$('#resetCancel').onclick = () => $('#resetDlg').close('cancel');
$('#resetDlg').addEventListener('close', async () => {
  if ($('#resetDlg').returnValue !== 'ok') return;
  try { const r = await api('/api/sources/reset', { method: 'POST', body: JSON.stringify({ stopDiscovery: $('#resetForm').stop.checked }) }); await loadMeta(); renderSourcesCard(); srcSay(`Removed ${fmt(r.removed)} boards and ${r.lists} lists.${r.kept ? ` Kept ${r.kept} you watch by hand.` : ''} Add the starter list or import one to begin again.`); } catch (e) { srcSay(e.message); }
});

// ───────────────────────────────────────────── theme, routing, sidebar
function toggleTheme() { const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); const next = cur === 'light' ? 'dark' : 'light'; setTheme(next); }
{ const t = ls.get('lk2.theme', null); if (t) document.documentElement.dataset.theme = t; }
function route() {
  let v = (location.hash || '#jobs').slice(1);
  if (v.startsWith('job:')) { const id = decodeURIComponent(v.slice(4)); v = 'jobs'; history.replaceState(null, '', '#jobs'); if (S.meta) setTimeout(() => select(id), 50); else S.openOnLoad = id; }
  const prev = S.view;
  S.view = ['jobs', 'signals', 'pipeline', 'sources', 'settings'].includes(v) ? v : 'jobs';
  const swap = () => {
    $$('.view').forEach(el => el.classList.toggle('hidden', el.id !== 'v-' + S.view));
    $$('.nav a, .tabbar a').forEach(a => a.classList.toggle('on', a.dataset.view === S.view));
  };
  // a soft cross-fade between screens where the browser supports it
  if (prev !== S.view && S.meta && !document.hidden && document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) { try { const vt = document.startViewTransition(swap); for (const p of [vt.ready, vt.finished, vt.updateCallbackDone]) p?.catch(() => { }); } catch { swap(); } } else swap();
  closeSide(); if (!S.meta) return;
  if (S.view === 'signals') renderSignals(); if (S.view === 'pipeline') renderPipeline(); if (S.view === 'sources') renderSources(); if (S.view === 'settings') { renderSettings(); buildSettingsNav(); S.paintSetNav?.(); setTimeout(() => S.paintSetNav?.(), 80); }
}
window.addEventListener('hashchange', route);
const openSide = () => $('#side').classList.add('open'); const closeSide = () => $('#side').classList.remove('open');
$('#menu').onclick = e => { e.stopPropagation(); openSide(); }; $$('[data-menu]').forEach(b => b.onclick = e => { e.stopPropagation(); openSide(); });
document.addEventListener('click', e => { if ($('#side').classList.contains('open') && !e.target.closest('#side')) closeSide(); });

// ───────────────────────────────────────────── live engine
function renderEngine() {
  const src = S.meta?.sources || []; const busy = src.some(s => s.running);
  const last = Math.max(0, ...src.map(s => Date.parse(s.at || 0)).filter(Number.isFinite));
  const boards = src.find(s => s.id === 'ats')?.boards || 0;
  $('#engine').classList.toggle('live-on', !!S.connected);
  const engState = !S.connected ? 'Offline' : busy ? 'Scanning' : 'Live'; $('#engState').textContent = engState;
  if (!S.sel && S.briefState && S.briefState !== engState && $('#detail .brief .eyebrow')) { const eb = $('#detail .brief .eyebrow'); eb.firstElementChild?.classList.toggle('on', !!S.connected); $('#detail .brief .radar')?.classList.toggle('on', !!S.connected); for (const nd of eb.childNodes) if (nd.nodeType === 3 && nd.nodeValue.trim()) { nd.nodeValue = nd.nodeValue.replace(S.briefState, engState); break; } S.briefState = engState; }
  $('#engMeta').textContent = boards ? `${fmt(boards)} boards` : '';
  $('#engine').title = `${Math.max(0, src.length - 2)} feeds and ${fmt(boards)} company boards. Last check ${last ? agoLong(last) : 'pending'}.`;
}
setInterval(renderEngine, 5000);
// The live feed can silently die (sleep, network change, a long time in the background). Detect it,
// reconnect, and pull the full list again so nothing that arrived meanwhile is missed.
let es = null, lastBeat = 0, lastSync = Date.now(), syncing = false, sawPing = false;
async function resync() {
  if (syncing) return; syncing = true;
  try {
    const [{ jobs }] = await Promise.all([api('/api/jobs'), loadMeta()]);
    const had = new Set(S.jobs.map(j => j.id)); S.jobs = jobs; lastSync = Date.now(); evCache = null;
    if (mentionCache.size) await syncMentions(jobs.filter(j => !had.has(j.id)).map(j => j.id));
    const c = ctx(); const fresh = jobs.filter(j => !had.has(j.id) && matches(j, S.filters, c)).map(j => j.id);
    const pend = [...new Set([...S.pending, ...fresh])];
    if (S.view === 'jobs' && list.scrollTop < 20 && !$('#sheet').classList.contains('open')) renderList(new Set(pend.slice(0, 40)));
    else { S.pending = pend; updatePill(); }
    renderQuick(); renderViews(); renderEngine();
  } catch { /* scanner unreachable; the watchdog tries again */ } finally { syncing = false; }
}
setInterval(() => {
  if (sawPing && Date.now() - lastBeat > 80e3) { connect(); resync(); }           // feed went quiet: reconnect
  else if (!document.hidden && Date.now() - lastSync > 5 * 60e3) resync();       // safety net every 5 minutes
}, 20e3);
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastSync > 60e3) resync(); });
function connect() {
  es?.close(); es = new EventSource('/api/events'); lastBeat = Date.now(); let wasDown = false;
  es.onopen = () => { S.connected = true; lastBeat = Date.now(); renderEngine(); if (wasDown) resync(); wasDown = false; };
  es.onerror = () => { S.connected = false; wasDown = true; renderEngine(); };
  es.addEventListener('ping', () => { lastBeat = Date.now(); sawPing = true; });
  es.addEventListener('jobs', e => {
    const { added } = JSON.parse(e.data); const ids = new Set(S.jobs.map(j => j.id));
    const fresh = added.filter(j => !ids.has(j.id)); if (!fresh.length) return;
    S.jobs = [...fresh, ...S.jobs];
    if (mentionCache.size) syncMentions(fresh.map(j => j.id)).then(ok => { if (ok) { renderList(); deferred(); } });
    const c = ctx(); const visible = fresh.filter(j => matches(j, S.filters, c)).map(j => j.id);
    S.pending.push(...visible);
    if (S.view === 'jobs' && list.scrollTop < 20 && S.pending.length && S.pending.length < 25 && !$('#sheet').classList.contains('open')) { const set = new Set(S.pending); renderList(set); }
    else updatePill();
    renderQuick(); renderViews();
  });
  es.addEventListener('alert', e => {
    const items = JSON.parse(e.data);
    if (S.meta?.settings?.desktopNotify && 'Notification' in window && Notification.permission === 'granted')
      for (const a of items.slice(0, 3)) { const n = new Notification(`${a.company}: ${a.title}`, { body: `Matched ${a.sets.join(', ')}`, icon: '/logo.svg', tag: a.id }); n.onclick = () => { window.focus(); location.hash = '#jobs'; select(a.id); }; }
    toast(`${items.length} new match${items.length > 1 ? 'es' : ''}: ${items[0].company}, ${items[0].title}`, { live: true, ms: 6000 });
  });
  es.addEventListener('status', e => { const st = JSON.parse(e.data); const s = S.meta?.sources.find(x => x.id === st.id); if (s) Object.assign(s, st); renderEngine(); });
  es.addEventListener('funding', () => { if (S.view === 'signals') renderSignals(); });
  es.addEventListener('profile', async () => { await loadMeta(); if (S.view === 'settings' && !P.dirty) renderProfile(); evCache = null; renderList(); }); // the extension added skills
  es.addEventListener('scan', async e => {
    const st = JSON.parse(e.data); if (!S.meta) return; const was = S.meta.scanState?.running; S.meta.scanState = st;
    if (was && !st.running) { await loadMeta(); if (S.view === 'settings') renderProfile(); evCache = null; renderList(); }
    else if (S.view === 'settings') renderScan();
  });
}
async function loadMeta() { S.meta = await api('/api/meta'); renderNav(); renderWho(); syncMentions().then(ok => ok && S.jobs.length && refreshJobs()); }

async function init() {
  hydrateIcons();
  $('#list').innerHTML = Array.from({ length: 10 }, () => '<div class="skel"></div>').join('');
  detailEmpty(); renderSort();
  await loadMeta();
  const v = S.meta.filterSets.find(x => x.id === S.activeView); if (v) $('#viewTitle').textContent = v.name; else S.activeView = null;
  const { jobs } = await api('/api/jobs'); S.jobs = jobs;
  refreshJobs(); route(); renderEngine(); connect(); maybeWelcome();
  if (S.openOnLoad) { select(S.openOnLoad); S.openOnLoad = null; }
  api('/api/signals').then(r => $('#nSignals').textContent = fmt(r.companies.length)).catch(() => { });
  api('/api/discovery').then(d => $('#nSources').textContent = fmt(d.boards)).catch(() => { });
  setInterval(async () => { try { await loadMeta(); renderViews(); if (S.view === 'sources') renderSources(); } catch { /* scanner unreachable; the watchdog reconnects */ } }, 30000);
  setInterval(() => { if (S.view === 'jobs') $$('.row .t-time', list).forEach(el => { const j = S.jobs.find(x => x.id === el.closest('.row').dataset.id); if (j) el.textContent = when(j); }); }, 60000);
}
init().catch(e => { $('#list').innerHTML = `<div class="empty"><div class="empty-in"><h3>Can’t reach the scanner</h3><p>${esc(e.message)}. Start it with <code>npm start</code>.</p></div></div>`; });
