import { matches, evaluate, freshness, score, skillMatch, effectiveTime, normalizeFilters, normCo, EMPTY_FILTERS, FIELDS, TYPES, LEVELS, VISA, WORK_MODES, DEGREES, FUND_STAGES, AGE_MS } from './filters.mjs';

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
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  slides: '<path d="M2 5v14"/><rect width="12" height="18" x="6" y="3" rx="2"/><path d="M22 5v14"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
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
const LEVEL_LABEL = { 'Senior+': 'Lead / Principal', Entry: 'Entry / new grad' };
const fl$ = x => FIELD_LABEL[x] || x; const lv$ = x => LEVEL_LABEL[x] || x;
const srcName = id => S.meta?.sources.find(s => s.id === id)?.name || id;
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
  filters: normalizeFilters(ls.get('lk2.filters', { age: '7d', fields: ['Software & IT'] })),
  activeView: ls.get('lk2.view', null), sort: ls.get('lk2.sort', 'new'),
  mode: ls.get('lk2.mode', 'list'), // 'list' or 'slides'
  sel: null, limit: 150, pending: [], sigSeg: 'news', openSecs: new Set(ls.get('lk2.secs', ['age', 'field', 'exp', 'visa'])),
};
let blockedCache = { src: null, set: new Set() };
const ctx = () => {
  const b = S.meta?.blockedCompanies || [];
  if (blockedCache.src !== b) blockedCache = { src: b, set: new Set(b.map(normCo)) };
  return { tracking: S.meta?.tracking || {}, blocked: blockedCache.set };
};
function setFilters(patch, { keepView = false } = {}) {
  S.filters = normalizeFilters({ ...S.filters, ...patch });
  if (!keepView) { const v = S.meta?.filterSets.find(x => x.id === S.activeView); if (v && JSON.stringify(normalizeFilters(v.filters)) !== JSON.stringify(S.filters)) { /* view modified */ } }
  ls.set('lk2.filters', S.filters); ls.set('lk2.view', S.activeView); S.limit = 150;
  deck.top = deck.next = null; // new filters: slides start from the top again
  if ($('#q').value.trim() !== (S.filters.q || '') && document.activeElement !== $('#q')) $('#q').value = S.filters.q || ''; // keep box and chip in sync
  refreshJobs();
}
// List first (what the user is looking at); counters right after, off the critical path.
const deferred = debounce(() => { renderQuick(); renderViews(); }, 60);
const refreshJobs = () => { renderChips(); renderList(); deferred(); if ($('#sheet').classList.contains('open')) renderSheetDebounced(); };

// ───────────────────────────────────────────── filtering
// One cached pass gives the list and every facet count; invalidated whenever the list re-renders.
let evCache = null;
const ev = () => (evCache ||= evaluate(S.jobs, S.filters, ctx()));
function filtered() {
  const out = [...ev().matched];
  if (S.sort === 'best') { const p = profile(); const now = Date.now(); out.sort((a, b) => score(b, p, now) - score(a, p, now)); }
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
  arr('specialties', 'Role'); arr('types', 'Type'); arr('levels', 'Level', lv$);
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
// Small facts as pills. Rows show the first three (CSS); slides show them all.
function pillsFor(j, where = 'row') {
  const p = {};
  if (j.funded) { const l = j.funding?.label || 'Funded'; p.fund = `<span class="pill ${/^YC\b/.test(l) ? '' : 'live'}">${esc(l)}</span>`; } // fresh rounds get the accent; a YC batch is neutral
  const v = visaShort[j.visa]; if (v) p.visa = `<span class="pill ${v[1]}">${v[0]}</span>`;
  const ps = payStr(j); if (ps) p.pay = `<span class="pill">${esc(ps)}</span>`;
  const y = years(j); if (y && !(j.type === 'Internship' && j.yearsMin === 0)) p.yrs = `<span class="pill">${esc(y)}</span>`;
  if (j.workMode === 'Remote' || j.workMode === 'Hybrid') p.mode = `<span class="pill">${esc(j.workMode)}</span>`;
  if (where === 'slide') p.type = `<span class="pill">${esc(j.type === 'Internship' ? 'Internship' : j.level === 'Entry' ? 'Entry level' : j.type)}</span>`;
  const order = where === 'slide' ? ['type', 'yrs', 'pay', 'mode', 'visa', 'fund'] : ['fund', 'visa', 'pay', 'yrs', 'mode'];
  return order.map(k => p[k]).filter(Boolean).join('');
}
function rowHtml(j, { arrive = false } = {}) {
  const tr = S.meta?.tracking?.[j.id]; const pills = pillsFor(j); const loc = locShort(j);
  return `<div class="row ${S.sel === j.id ? 'sel' : ''} ${isHot(j) ? 'hot' : ''} ${arrive ? 'arrive' : ''}" data-id="${j.id}" role="option">
    ${logo(j.company, j.domain)}
    <div class="r-main">
      <div class="r-title">${esc(j.title)}</div>
      <div class="r-sub"><span class="r-co">${esc(j.company)}</span>${loc ? `<span class="r-loc">${esc(loc)}</span>` : ''}</div>
      ${pills ? `<div class="r-pills">${pills}</div>` : ''}
    </div>
    <div class="r-right"><span class="t-time">${when(j)}</span>${tr?.status ? `<span class="r-flag">${esc(statusLabel(tr.status))}</span>` : ''}</div></div>`;
}
let current = [];
function renderList(arriveIds = new Set()) {
  evCache = null; current = filtered();
  $('#viewCount').textContent = fmt(current.length);
  $('#list').innerHTML = current.length
    ? current.slice(0, S.limit).map(j => rowHtml(j, { arrive: arriveIds.has(j.id) })).join('') + (current.length > S.limit ? '<button class="btn more" id="more">Show more</button>' : '')
    : `<div class="empty"><div class="empty-in"><img src="/logo.svg" width="44" alt=""><h3>Nothing matches</h3>${chipList().length ? '<button class="btn" id="emptyClear">Clear filters</button>' : '<p>New roles show up here as they’re found.</p>'}</div></div>`;
  hydrateIcons($('#list'));
  $('#more')?.addEventListener('click', () => { S.limit += 300; renderList(); });
  $('#emptyClear')?.addEventListener('click', () => { S.activeView = null; $('#q').value = ''; setFilters({ ...EMPTY_FILTERS }); });
  $('#nJobs').textContent = fmt(S.jobs.length);
  S.pending = []; updatePill();
  renderDeck();
}
const list = $('#list');
list.addEventListener('click', e => { const r = e.target.closest('.row'); if (r) select(r.dataset.id, true); });
list.addEventListener('mousemove', e => { const r = e.target.closest('.row'); if (!r) return; const b = r.getBoundingClientRect(); r.style.setProperty('--mx', `${e.clientX - b.left}px`); r.style.setProperty('--my', `${e.clientY - b.top}px`); });
list.addEventListener('mouseleave', () => $$('.row', list).forEach(r => r.style.removeProperty('--mx')));
function updatePill() { const n = S.pending.length; const p = $('#newPill'); p.classList.toggle('hidden', !n); p.innerHTML = `${ic('arrowup')}${n} new`; document.title = n ? `(${n}) Lookout` : 'Lookout'; }
$('#newPill').onclick = () => { const ids = new Set(S.pending); list.scrollTop = 0; renderList(ids); };

// sort + search
function renderSort() { $('#sortBtn').innerHTML = `${ic('sort')}<span>${S.sort === 'best' ? 'Best match' : 'Newest'}</span>`; $('#sortBtn').title = 'Switch between newest and best match'; }
$('#sortBtn').onclick = () => {
  S.sort = S.sort === 'new' ? 'best' : 'new'; ls.set('lk2.sort', S.sort); deck.top = deck.next = null; renderSort(); renderList();
  if (S.sort === 'best' && !profile().skills?.length) toast('Add your skills to rank by fit', { action: ['Add skills', () => { location.hash = '#settings'; }] });
};
$('#q').value = S.filters.q || '';
$('#q').addEventListener('input', debounce(e => setFilters({ q: e.target.value.trim() }), 140));
$('#q').addEventListener('search', e => setFilters({ q: e.target.value.trim() })); // native clear (×) and Esc
$('#q').addEventListener('keydown', e => { if (e.key === 'Escape') { e.target.value = ''; setFilters({ q: '' }); e.target.blur(); e.stopPropagation(); } });

// ───────────────────────────────────────────── detail
const STATUSES = [['saved', 'Saved'], ['applied', 'Applied'], ['contacted', 'Contacted'], ['interview', 'Interviewing'], ['rejected', 'Closed']];
const statusLabel = s => (STATUSES.find(x => x[0] === s) || [s, s === 'hidden' ? 'Hidden' : s])[1];
function detailEmpty() {
  $('#detail').classList.remove('open');
  $('#detail').innerHTML = '<div class="d-empty"><div><img src="/logo.svg" width="48" alt=""><p>Pick a role</p></div></div>';
}
async function select(id, fromClick = false) {
  S.sel = id;
  $$('.row', list).forEach(r => r.classList.toggle('sel', r.dataset.id === id));
  const row = $(`.row[data-id="${id}"]`, list); if (row && !fromClick) row.scrollIntoView({ block: 'nearest' });
  const d = $('#detail'); d.classList.add('open');
  d.innerHTML = `<div class="d-body" style="padding-top:28px"><span class="spin"></span></div>`;
  let j; try { j = await api('/api/job/' + encodeURIComponent(id)); } catch (e) { d.innerHTML = `<div class="d-body">${esc(e.message)}</div>`; return; }
  if (S.sel !== id) return;
  renderDetail(j);
}
const saveBtnHtml = saved => `<span class="bm ${saved ? 'on' : ''}">${ic('bookmark')}</span>${saved ? 'Saved' : 'Save'}`;
// Only facts the posting actually states; no "Not stated" filler.
function factsFor(j) {
  const out = []; const add = (k, v, cls = '') => { if (v) out.push(`<div class="fact"><span>${k}</span><b class="${cls}">${v}</b></div>`); };
  const fr = freshness(j);
  if (fr.kind === 'exact') add('Posted', esc(agoLong(fr.t)), isHot(j) ? 'live' : '');
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
    <div class="d-actions">
      <a class="btn primary lg" href="${esc(apply)}" target="_blank" rel="noreferrer" title="Open the listing (Enter)">Apply ${ic('external')}</a>
      <button class="btn lg" id="dSave" title="Save (S)">${saveBtnHtml(tr.status === 'saved')}</button>
      <button class="btn lg" id="dDraft" title="Draft an outreach email (E)">${ic('mail')}Email</button>
      <span class="spacer"></span>
      <button class="icon-btn" id="dHide" title="${tr.hidden ? 'Unhide this role' : 'Hide this role (X)'}">${ic(tr.hidden ? 'eye' : 'eyeoff')}</button>
      <button class="icon-btn" id="dHideCo" title="Block ${esc(j.company)}">${ic('ban')}</button>
    </div>
  </div>
  <div class="d-body">
    <div class="facts">${factsFor(j)}</div>
    ${reqs.length ? `<section class="sec"><h4>Requirements</h4><ul class="reqs ${reqs.length > 6 ? 'clamped' : ''}" id="reqs">${reqs.map(r => `<li>${esc(r)}</li>`).join('')}</ul>${reqs.length > 6 ? `<button class="link small" id="reqMore">Show all ${reqs.length}</button>` : ''}</section>` : ''}
    ${j.skills.length ? `<section class="sec"><h4>Skills${p.skills?.length ? `<span class="match-pct">${skillMatch(j, p.skills)}% match</span>` : ''}</h4><div class="chipset">${j.skills.map(s => `<span class="sk ${mine.has(s.name.toLowerCase()) ? 'hit' : ''}">${esc(s.name)}</span>`).join('')}</div></section>` : ''}
    <section class="sec"><h4>Contact<button class="icon-btn sm" id="cRe" title="Check again">${ic('refresh')}</button></h4><div id="contacts"><span class="spin"></span></div></section>
    <section class="sec"><h4>Status</h4><div class="status-row">${STATUSES.map(([v, l]) => `<button data-st="${v}" class="${tr.status === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <textarea class="note" id="note" rows="2" placeholder="Notes">${esc(tr.note || '')}</textarea></section>
    <details class="fold"><summary>Seen on ${j.sources.length} source${j.sources.length > 1 ? 's' : ''}</summary><div class="srcs">${j.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noreferrer">${esc(srcName(s.source))}<span>${s.postedAt ? `posted ${agoLong(Date.parse(s.postedAt))}` : `seen ${agoLong(Date.parse(s.seenAt))}`}</span></a>`).join('')}</div></details>
    ${j.description ? `<details class="fold"><summary>Full posting</summary><div class="desc">${esc(j.description)}</div></details>` : ''}
  </div>`;
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
  const overlap = j.skills.filter(s => mine.has(s.name.toLowerCase())).map(s => s.name).slice(0, 4);
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
  if (S.sel === id && S.detailJob) { $$('[data-st]').forEach(b => b.classList.toggle('on', b.dataset.st === status)); const sb = $('#dSave'); if (sb) sb.innerHTML = saveBtnHtml(status === 'saved'); }
  renderNav(); if (S.view === 'pipeline') renderPipeline();
  if (S.mode === 'slides' && !deck.busy) renderDeck(); // tracked from Details: it leaves the deck
  if (!quiet && status && status !== 'hidden') toast(`${statusLabel(status)}: ${j?.title || ''}`, { undo: () => track(id, prev?.status || '', prev?.note, true) });
}
function selectNextAfter(idx) { renderList(); if (S.mode === 'slides') { S.sel = null; detailEmpty(); return; } const next = current[Math.min(idx, current.length - 1)]; if (next) select(next.id); else { S.sel = null; detailEmpty(); } }
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

const opt = (key, value, label, n, checked) => `<label class="opt ${n === 0 && !checked ? 'zero' : ''}"><input type="checkbox" data-k="${key}" value="${esc(value)}" ${checked ? 'checked' : ''}><span class="box"></span><span class="lbl">${esc(label ?? value)}</span>${n !== undefined ? `<span class="n">${fmt(n)}</span>` : ''}</label>`;
const sec = (id, title, sum, body) => `<details class="fs" data-sec="${id}" ${S.openSecs.has(id) ? 'open' : ''}><summary>${title}${sum ? `<span class="sum">${esc(sum)}</span>` : ''}</summary><div class="fs-body">${body}</div></details>`;
function renderSheet() {
  const f = S.filters; const open = id => S.openSecs.has(id);
  const scroll = $('#sheetBody').scrollTop;
  // Preserve typing state across re-renders: search boxes, focus and caret.
  const searches = Object.fromEntries($$('[data-search]', $('#sheetBody')).map(i => [i.dataset.search, i.value]));
  const ae = document.activeElement; const focusKey = ae && $('#sheetBody').contains(ae) ? (ae.dataset.search ? `[data-search="${ae.dataset.search}"]` : ae.id ? `#${ae.id}` : null) : null;
  const caret = focusKey && 'selectionStart' in ae ? [ae.selectionStart, ae.selectionEnd] : null;
  $('#sheetCount').textContent = '';
  const parts = [];
  // posted
  parts.push(sec('age', 'Posted', f.age !== 'all' ? AGE_LABEL[f.age] : '', `<div class="seg full" data-seg="age">${Object.keys(AGE_MS).map(a => `<button data-v="${a}" class="${f.age === a ? 'on' : ''}">${a === 'all' ? 'Any' : a}</button>`).join('')}</div>`));
  // field (tri-state)
  { const counts = open('field') ? countsFor('fields', j => j.field, ['fields', 'excludeFields']) : new Map();
    parts.push(sec('field', 'Field', [f.fields.length && `${f.fields.length} in`, f.excludeFields.length && `${f.excludeFields.length} out`].filter(Boolean).join(', '),
      `<p class="tri-help">Click to include, again to exclude.</p>` + Object.keys(FIELDS).map(fl => { const st = f.fields.includes(fl) ? 'inc' : f.excludeFields.includes(fl) ? 'exc' : ''; return `<div class="tri ${st}" data-field="${esc(fl)}" role="checkbox" tabindex="0" aria-checked="${st === 'inc' ? 'true' : st === 'exc' ? 'mixed' : 'false'}" aria-label="${esc(fl$(fl))}${st === 'exc' ? ' (excluded)' : ''}"><span class="st">${st === 'inc' ? '✓' : st === 'exc' ? '–' : ''}</span><span class="lbl">${esc(fl$(fl))}</span><span class="n">${fmt(counts.get(fl) || 0)}</span></div>`; }).join(''))); }
  // specialty
  { const counts = open('spec') ? countsFor('specialties', j => j.specialty) : new Map();
    const fieldsShown = f.fields.length ? f.fields : Object.keys(FIELDS).filter(x => !f.excludeFields.includes(x));
    parts.push(sec('spec', 'Role', f.specialties.length ? `${f.specialties.length} selected` : '', `<input class="fs-search" data-search="spec" placeholder="Filter roles…"><div class="scroll-opts" data-list="spec">${fieldsShown.map(fl => `<div class="sub-group">${esc(fl)}</div>` + FIELDS[fl].map(s => opt('specialties', s, s, counts.get(s) || 0, f.specialties.includes(s))).join('')).join('')}</div>`)); }
  // experience
  { const lo = f.expMin ?? 0, hi = f.expMax ?? 10;
    parts.push(sec('exp', 'Experience', (f.expMin !== null || f.expMax !== null) ? `${lo}–${hi === 10 ? '10+' : hi}` : '', `<div class="presets"><button data-exp="0,1">New grad</button><button data-exp="0,2">0–2</button><button data-exp="2,5">2–5</button><button data-exp="5,10">5+</button><button data-exp="">Any</button></div>
      <div class="range"><div class="range-vals"><span>Asks for <b id="expLo">${lo}</b> to <b id="expHi">${hi === 10 ? '10+' : hi}</b> years</span></div>
      <div class="dual"><div class="track"></div><div class="fill" id="expFill"></div><input type="range" min="0" max="10" step="1" value="${lo}" id="expMinR"><input type="range" min="0" max="10" step="1" value="${hi}" id="expMaxR"></div>
      <div class="ticks"><span>0</span><span>2</span><span>4</span><span>6</span><span>8</span><span>10+</span></div></div>
      <label class="mini-check"><input type="checkbox" id="expUnknown" ${f.expUnknown ? 'checked' : ''}>Include roles that don’t say</label>`)); }
  // type & level
  { const tc = open('type') ? countsFor('types', j => j.type) : new Map(); const lc = open('type') ? countsFor('levels', j => j.level) : new Map();
    parts.push(sec('type', 'Type & level', [...f.types, ...f.levels].join(', '), `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div class="opts">${TYPES.map(t => opt('types', t, t, tc.get(t) || 0, f.types.includes(t))).join('')}</div><div class="opts">${LEVELS.filter(t => t !== 'Intern' || f.levels.includes(t)).map(t => opt('levels', t, lv$(t), lc.get(t) || 0, f.levels.includes(t))).join('')}</div></div>`)); }
  // visa
  { const c = open('visa') ? countsFor('visa', j => j.visa || 'Not stated') : new Map();
    parts.push(sec('visa', 'Visa', f.visa.join(', '), `<div class="presets"><button data-visa="need" title="Keeps roles that sponsor or don’t say. Drops no-sponsorship and citizens-only roles.">I need sponsorship</button><button data-visa="sponsor">Confirmed sponsors</button><button data-visa="">Any</button></div><div class="opts">${VISA.map(v => opt('visa', v, v, c.get(v) || 0, f.visa.includes(v))).join('')}</div>`)); }
  // work mode
  { const c = open('mode') ? countsFor('workModes', j => j.workMode || 'Not stated') : new Map();
    parts.push(sec('mode', 'Work mode', f.workModes.join(', '), `<div class="opts">${WORK_MODES.map(v => opt('workModes', v, v, c.get(v) || 0, f.workModes.includes(v))).join('')}</div>`)); }
  // location
  { const c = open('loc') ? countsFor('countries', j => j.country) : new Map();
    const list = [...c].sort((a, b) => (a[0] === 'Unknown') - (b[0] === 'Unknown') || b[1] - a[1]); for (const x of f.countries) if (!c.has(x)) list.push([x, 0]);
    parts.push(sec('loc', 'Location', f.countries.join(', '), `<input class="fs-search" data-search="loc" placeholder="Filter countries…"><div class="scroll-opts opts" data-list="loc">${list.map(([v, n]) => opt('countries', v, v === 'Unknown' ? 'Location not stated' : v, n, f.countries.includes(v))).join('')}</div>`)); }
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
    parts.push(sec('deg', 'Degree & term', [...f.degrees, ...f.terms].join(', '), `<div class="sub-group" style="padding:0 0 4px 8px">Accepts</div><div class="opts">${DEGREES.map(v => opt('degrees', v, v, dc.get(v) || 0, f.degrees.includes(v))).join('')}</div>${terms.length ? `<div class="sub-group" style="padding:10px 0 4px 8px">Internship term</div><div class="opts">${terms.map(([v, n]) => opt('terms', v, v, n, f.terms.includes(v))).join('')}</div>` : ''}`)); }
  // company
  { const sc = open('co') ? countsFor('fundStages', j => j.fundStage) : new Map();
    parts.push(sec('co', 'Company', [f.fundedOnly && 'funded', ...f.fundStages, f.excludeCompanies.length && `${f.excludeCompanies.length} hidden`].filter(Boolean).join(', '), `<label class="mini-check" style="margin:0 0 8px"><input type="checkbox" data-bool="fundedOnly" ${f.fundedOnly ? 'checked' : ''}>Recently funded only</label><div class="opts">${FUND_STAGES.map(v => opt('fundStages', v, v, sc.get(v) || 0, f.fundStages.includes(v))).join('')}</div>
      ${f.excludeCompanies.length ? `<div class="sub-group" style="padding:10px 0 4px 6px">Hidden companies</div><div class="tokens" style="margin:0">${f.excludeCompanies.map(c => `<span class="chip"><span class="v">${esc(c)}</span><button data-unhide="${esc(c)}">${ic('x')}</button></span>`).join('')}</div>` : ''}`)); }
  // skills
  { const c = open('skills') ? countsFor('skills', j => j.skills.map(skillN)) : new Map();
    const list = [...c].sort((a, b) => b[1] - a[1]).slice(0, 300); for (const x of f.skills) if (!c.has(x)) list.unshift([x, 0]);
    parts.push(sec('skills', 'Skills', f.skills.length ? `${f.skills.length} · ${f.skillsAll ? 'all' : 'any'}` : '', `<div class="seg full" data-seg="skillsAll" style="margin-bottom:8px"><button data-v="any" class="${!f.skillsAll ? 'on' : ''}">Has any</button><button data-v="all" class="${f.skillsAll ? 'on' : ''}">Has all</button></div><input class="fs-search" data-search="skills" placeholder="Filter skills…"><div class="scroll-opts opts" data-list="skills">${list.map(([v, n]) => opt('skills', v, v, n, f.skills.includes(v))).join('')}</div>`)); }
  // sources
  { const c = open('src') ? countsFor('sources', j => j.sources.map(s => s.source)) : new Map();
    const srcs = (S.meta?.sources || []).filter(s => s.kind === 'jobs');
    parts.push(sec('src', 'Source', f.sources.length ? `${f.sources.length} selected` : f.multiSource ? '2+ sources' : '', `<label class="mini-check" style="margin:0 0 8px"><input type="checkbox" data-bool="multiSource" ${f.multiSource ? 'checked' : ''}>Seen on 2+ sources</label><div class="opts">${srcs.map(s => opt('sources', s.id, s.name, c.get(s.id) || 0, f.sources.includes(s.id))).join('')}</div>`)); }
  // keywords + misc
  parts.push(sec('kw', 'More', [f.excludeQ && 'keywords', f.hideAgencies && 'no agencies', f.hasContact && 'has email', f.hideTracked && 'hide tracked'].filter(Boolean).join(', '), `<label class="kw-label">Hide roles mentioning<textarea id="exQ" rows="2" placeholder="senior, staff, clearance">${esc(f.excludeQ)}</textarea></label>
    <label class="mini-check"><input type="checkbox" data-bool="hideAgencies" ${f.hideAgencies ? 'checked' : ''}>Hide staffing agencies</label>
    <label class="mini-check"><input type="checkbox" data-bool="hasContact" ${f.hasContact ? 'checked' : ''}>Has a contact email</label>
    <label class="mini-check"><input type="checkbox" data-bool="hideTracked" ${f.hideTracked ? 'checked' : ''}>Not in my pipeline yet</label>`));

  $('#sheetBody').innerHTML = parts.join(''); hydrateIcons($('#sheetBody'));
  $('#sheetBody').scrollTop = scroll;
  wireSheet(); syncExpFill();
  for (const [k, v] of Object.entries(searches)) { const inp = $(`[data-search="${k}"]`, $('#sheetBody')); if (inp && v) { inp.value = v; inp.dispatchEvent(new Event('input')); } }
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
  $$('input[data-k]', body).forEach(cb => cb.onchange = () => { const k = cb.dataset.k; setFilters({ [k]: cb.checked ? [...S.filters[k], cb.value] : S.filters[k].filter(x => x !== cb.value) }); });
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
  $$('[data-visa]', body).forEach(b => b.onclick = () => setFilters({ visa: b.dataset.visa === 'need' ? ['Sponsors visa', 'Not stated'] : b.dataset.visa === 'sponsor' ? ['Sponsors visa'] : [] }));
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
    return `<div class="vw ${S.activeView === v.id ? 'on' : ''} ${v.alert ? 'alerting' : ''}" data-id="${v.id}" title="${esc(v.name)} · ${fmt(n)} roles${fresh ? `, ${fresh} in the last hour` : ''}${v.alert ? ' · phone alerts on' : ''}"><span class="dot"></span><span class="nm">${esc(v.name)}</span><span class="ct">${fresh ? `<b class="new">+${fresh}</b> ` : ''}${fmt(n)}</span>
      <span class="acts"><button class="icon-btn sm ${v.alert ? 'on' : ''}" data-bell title="${v.alert ? 'Turn phone alerts off' : 'Turn phone alerts on'}">${ic('bell')}</button><button class="icon-btn sm" data-del title="Delete view">${ic('trash')}</button></span></div>`;
  }).join('') : '<div class="empty-views">Set filters, then save them here.</div>';
  $$('.vw').forEach(el => {
    const v = S.meta.filterSets.find(x => x.id === el.dataset.id);
    el.onclick = () => applyView(v);
    el.querySelector('[data-bell]').onclick = async e => { e.stopPropagation(); v.alert = !v.alert; await api('/api/filter-sets', { method: 'POST', body: JSON.stringify(v) }); renderViews(); if (v.alert && !S.meta.settings.ntfyTopic) toast(`Alerts on for “${v.name}”, but no phone is connected yet`, { action: ['Connect phone', () => { location.hash = '#settings'; }] }); else toast(v.alert ? `Phone alerts on for “${v.name}”` : `Phone alerts off for “${v.name}”`); };
    el.querySelector('[data-del]').onclick = async e => { e.stopPropagation(); const copy = { ...v }; await api('/api/filter-sets/' + v.id, { method: 'DELETE' }); S.meta.filterSets = S.meta.filterSets.filter(x => x.id !== v.id); if (S.activeView === v.id) { S.activeView = null; ls.set('lk2.view', null); } renderViews(); renderChips();
      toast(`Deleted “${v.name}”`, { undo: async () => { const r = await api('/api/filter-sets', { method: 'POST', body: JSON.stringify({ ...copy, id: undefined }) }); S.meta.filterSets.push(r); renderViews(); } }); };
  });
}
function applyView(v) {
  S.activeView = v.id; ls.set('lk2.view', v.id);
  S.filters = normalizeFilters(v.filters); ls.set('lk2.filters', S.filters); $('#q').value = S.filters.q || '';
  deck.top = deck.next = null;
  $('#viewTitle').textContent = v.name; location.hash = '#jobs'; refreshJobs(); closeSide();
}
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
  const rec = await api('/api/filter-sets', { method: 'POST', body: JSON.stringify({ id: v && v.name === form.name.value ? v.id : undefined, name: form.name.value, alert: form.alert.checked, filters: S.filters }) });
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
    ...(S.meta?.filterSets || []).map(v => ({ g: 'Saved views', l: v.name, i: 'layers', r: v.alert ? 'alerts on' : '', run: () => applyView(v) })),
    { g: 'Filter', l: 'Software & IT only', i: 'sliders', run: () => setFilters({ fields: ['Software & IT'], excludeFields: [] }) },
    { g: 'Filter', l: 'AI / ML roles', i: 'sliders', run: () => setFilters({ specialties: ['AI / ML'] }) },
    { g: 'Filter', l: 'Data science & analytics', i: 'sliders', run: () => setFilters({ specialties: ['Data Science', 'Data Analytics', 'Data Engineering'] }) },
    { g: 'Filter', l: 'Hide core engineering (mechanical, civil, electrical…)', i: 'sliders', run: () => setFilters({ excludeFields: [...new Set([...S.filters.excludeFields, 'Core Engineering'])], fields: S.filters.fields.filter(x => x !== 'Core Engineering') }) },
    { g: 'Filter', l: 'Internships', i: 'sliders', run: () => setFilters({ types: ['Internship'] }) },
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
    { g: 'Look', l: S.mode === 'slides' ? 'Browse as a list' : 'Slide mode: one role at a time', i: S.mode === 'slides' ? 'list' : 'slides', r: 'V', run: () => { location.hash = '#jobs'; setMode(S.mode === 'slides' ? 'list' : 'slides'); } },
    { g: 'Look', l: 'Toggle light / dark', i: 'moon', run: toggleTheme },
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

// ───────────────────────────────────────────── slide mode
// One role at a time, from the current filtered list. Roles you've already tracked are skipped.
const deck = { skipped: new Set(), history: [], top: null, next: null, full: new Map(), busy: false, dragging: false, back: false, shown: '' };
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function fullJob(id) {
  if (!deck.full.has(id)) { if (deck.full.size > 150) deck.full.clear(); deck.full.set(id, api('/api/job/' + encodeURIComponent(id)).catch(() => null)); }
  return deck.full.get(id);
}
function deckList() {
  const tr = S.meta?.tracking || {};
  const l = current.filter(j => !tr[j.id]?.status && !deck.skipped.has(j.id));
  // Keep the card on screen (and the one peeking behind it) in place when new roles arrive.
  const pin = [deck.top, deck.next].filter(Boolean).map(id => l.find(j => j.id === id)).filter(Boolean);
  return pin.length ? [...pin, ...l.filter(j => !pin.includes(j))] : l;
}
function slideHtml(j, top) {
  const loc = locShort(j);
  return `<header class="s-head">${logo(j.company, j.domain, 'logo xl')}<div class="s-co"><b>${esc(j.company)}</b>${loc ? `<span>${esc(loc)}</span>` : ''}</div><span class="s-time ${isHot(j) ? 'hot' : ''}">${when(j)}</span></header>
    <h2 class="s-title">${esc(j.title)}</h2>
    <div class="s-pills">${pillsFor(j, 'slide')}</div>
    <div class="s-body" ${top ? 'id="slideBody"' : ''}>${top ? '<div class="s-skel"></div><div class="s-skel"></div><div class="s-skel"></div>' : ''}</div>
    ${top ? `<footer class="s-foot"><a class="btn primary lg" id="sApply" target="_blank" rel="noreferrer" title="Open the listing (↑)">Apply ${ic('external')}</a><button class="btn lg" id="sEmail" title="Draft an outreach email (E)">${ic('mail')}Email</button><span class="spacer"></span><button class="btn ghost lg" id="sMore" title="Everything about this role (Space)">Details</button></footer>
    <div class="stamp save">Save</div><div class="stamp pass">Pass</div><div class="stamp later">Later</div>` : ''}`;
}
function blurb(d = '') {
  const t = String(d).split('\n').filter(l => l.trim() && !/^(category|terms?|sponsorship|degrees?):/i.test(l.trim())).join(' ').replace(/\s+/g, ' ').trim();
  return t.length > 340 ? t.slice(0, 340).replace(/\s\S*$/, '') + '…' : t;
}
function fillSlide(f) {
  const body = $('#slideBody'); if (!body) return;
  const p = profile(); const mine = new Set((p.skills || []).map(s => s.toLowerCase()));
  const reqs = (f.requirements || []).slice(0, 5); const text = reqs.length ? '' : blurb(f.description);
  const parts = [];
  if (reqs.length) parts.push(`<h5>Looking for</h5><ul class="reqs">${reqs.map(r => `<li>${esc(r)}</li>`).join('')}</ul>`);
  else if (text) parts.push(`<p class="s-snippet">${esc(text)}</p>`);
  if (f.skills?.length) parts.push(`<h5>Skills${p.skills?.length ? `<span class="match-pct">${skillMatch(f, p.skills)}% match</span>` : ''}</h5><div class="chipset">${f.skills.slice(0, 12).map(s => `<span class="sk ${mine.has(s.name.toLowerCase()) ? 'hit' : ''}">${esc(s.name)}</span>`).join('')}</div>`);
  body.innerHTML = parts.join('') || '<p class="s-snippet">This listing has no summary. Open the details to read it.</p>';
  const a = $('#sApply'); if (a) a.href = f.applyUrl || f.url;
}
function renderDeck(force) {
  if (S.mode !== 'slides' || (deck.dragging && !force)) return;
  const el = $('#deck'); const l = deckList(); const [a, b] = l;
  const sig = a ? `${a.id}|${b?.id || ''}` : 'empty';
  if (!force && a && sig === deck.shown) { const c = $('#deckCount'); if (c) c.textContent = fmt(l.length); return; }
  deck.shown = sig;
  if (!a) {
    deck.top = deck.next = null;
    const saved = deck.history.filter(h => h.kind === 'save').length;
    el.innerHTML = `<div class="deck-empty"><img src="/logo.svg" width="60" alt=""><h3>All caught up</h3><p>${saved ? `${saved} saved this session.` : 'Nothing left to review here.'}</p>
      <div class="btns">${deck.skipped.size ? `<button class="btn" id="deckAgain">Revisit ${deck.skipped.size} skipped</button>` : ''}${deck.history.length ? `<button class="btn" id="deckUndo">${ic('undo')}Undo</button>` : ''}<button class="btn ghost" id="deckToList">Back to list</button></div></div>`;
    $('#deckAgain')?.addEventListener('click', () => { deck.skipped.clear(); renderDeck(true); });
    $('#deckUndo')?.addEventListener('click', deckUndo);
    $('#deckToList').onclick = () => setMode('list');
    return;
  }
  deck.top = a.id; deck.next = b?.id || null;
  el.innerHTML = `
    <div class="deck-top"><span><b id="deckCount">${fmt(l.length)}</b> to go</span><button class="btn ghost" id="deckUndo" title="Undo (Z)" ${deck.history.length ? '' : 'disabled'}>${ic('undo')}Undo</button></div>
    <div class="deck-stage" id="deckStage">
      ${l.length > 2 ? '<div class="slide g2"></div>' : ''}
      ${b ? `<div class="slide g1">${slideHtml(b, false)}</div>` : ''}
      <article class="slide top ${deck.back ? 'back-in' : ''}" id="slideTop" data-id="${a.id}">${slideHtml(a, true)}</article>
    </div>
    <div class="deck-actions">
      <button class="act pass" data-act="pass" title="Not for me"><span class="ring">${ic('x')}</span><span>Pass <kbd>←</kbd></span></button>
      <button class="act later" data-act="later" title="Decide later"><span class="ring">${ic('clock')}</span><span>Later <kbd>↓</kbd></span></button>
      <button class="act save" data-act="save" title="Save to your pipeline"><span class="ring">${ic('bookmark')}</span><span>Save <kbd>→</kbd></span></button>
    </div>`;
  deck.back = false;
  $('#deckUndo').onclick = deckUndo;
  $$('.act', el).forEach(btn => btn.onclick = () => deckAct(btn.dataset.act));
  $('#sMore').onclick = () => select(a.id);
  $('#sEmail').onclick = () => slideEmail(a.id);
  wireDrag($('#slideTop'));
  fullJob(a.id).then(f => { if (f && deck.top === a.id) fillSlide(f); });
  if (b) fullJob(b.id);
}
async function deckAct(kind) {
  if (deck.busy || S.mode !== 'slides') return;
  const id = $('#slideTop')?.dataset.id; const l = deckList();
  if (!id || !l.some(j => j.id === id)) { deck.top = deck.next = null; return renderDeck(true); } // card changed underneath (e.g. tracked from Details)
  const rest = l.filter(j => j.id !== id);
  deck.busy = true;
  $('#slideTop').classList.add('fly-' + kind); $('#deckStage')?.classList.add('advancing');
  deck.history.push({ id, kind }); if (deck.history.length > 60) deck.history.shift();
  deck.top = rest[0]?.id || null; deck.next = rest[1]?.id || null;
  try {
    const anim = new Promise(r => setTimeout(r, reducedMotion() ? 0 : 280));
    if (kind === 'save') await track(id, 'saved', undefined, true);
    else if (kind === 'pass') await setHidden(id, true);
    else deck.skipped.add(id);
    await anim;
  } catch (e) { toast(e.message); }
  deck.busy = false;
  renderList();
}
async function deckUndo() {
  if (deck.busy) return; const h = deck.history.pop(); if (!h) return;
  deck.busy = true;
  try {
    if (h.kind === 'save') await track(h.id, '', undefined, true);
    else if (h.kind === 'pass') await setHidden(h.id, false);
    else deck.skipped.delete(h.id);
  } catch (e) { toast(e.message); }
  deck.busy = false; deck.next = deck.top; deck.top = h.id; deck.back = true;
  renderList();
}
async function slideEmail(id) {
  toast('Finding the best contact…', { ms: 2200 });
  const f = await fullJob(id); if (!f) return;
  let c = null; try { c = await api('/api/contacts/' + encodeURIComponent(id)); } catch { }
  draft(f, c);
}
// Drag (or swipe) the card sideways: right saves, left passes.
function wireDrag(el) {
  let sx = 0, sy = 0, dx = 0, down = false, moved = false;
  const stamps = { save: el.querySelector('.stamp.save'), pass: el.querySelector('.stamp.pass') };
  el.addEventListener('pointerdown', e => { if (e.button || e.target.closest('a,button')) return; down = true; moved = false; sx = e.clientX; sy = e.clientY; dx = 0; });
  el.addEventListener('pointermove', e => {
    if (!down) return; dx = e.clientX - sx; const dy = e.clientY - sy;
    if (!moved) { if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) return; moved = true; deck.dragging = true; try { el.setPointerCapture(e.pointerId); } catch { } el.classList.add('dragging'); }
    el.style.transform = `translateX(${dx}px) rotate(${dx / 30}deg)`;
    const k = Math.min(1, Math.abs(dx) / 130); stamps.save.style.opacity = dx > 0 ? k : 0; stamps.pass.style.opacity = dx < 0 ? k : 0;
  });
  const end = () => {
    if (!down) return; down = false; if (!moved) return;
    deck.dragging = false; el.classList.remove('dragging');
    if (dx > 130) deckAct('save'); else if (dx < -130) deckAct('pass');
    else { el.style.transform = ''; stamps.save.style.opacity = stamps.pass.style.opacity = 0; }
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}
function setMode(m) {
  S.mode = m === 'slides' ? 'slides' : 'list'; ls.set('lk2.mode', S.mode);
  $('#v-jobs').classList.toggle('mode-slides', S.mode === 'slides');
  $$('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === S.mode));
  if (S.sel) { S.sel = null; $$('.row.sel', list).forEach(r => r.classList.remove('sel')); detailEmpty(); }
  if (S.mode === 'slides') renderDeck(true);
}
$$('#modeSeg button').forEach(b => b.onclick = () => setMode(b.dataset.v));

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
  if (typing || e.ctrlKey || e.metaKey || e.altKey || $('#viewDlg').open || !$('#palBg').classList.contains('hidden') || $('#sheet').classList.contains('open')) return;
  if (S.view !== 'jobs') return;
  if ((e.key === ' ' || e.key === 'Enter') && /^(BUTTON|A|SUMMARY)$/.test(ae?.tagName)) return; // let the focused control handle it
  const k = e.key.toLowerCase();
  if (k === 'f') { e.preventDefault(); return openSheet(); }
  if (e.key === '/') { e.preventDefault(); return $('#q').focus(); }
  if (k === 'v') return setMode(S.mode === 'slides' ? 'list' : 'slides');
  if (S.mode === 'slides' && !S.sel) {
    if (e.key === 'ArrowRight' || k === 's') { e.preventDefault(); deckAct('save'); }
    else if (e.key === 'ArrowLeft' || k === 'x') { e.preventDefault(); deckAct('pass'); }
    else if (e.key === 'ArrowDown' || k === 'j') { e.preventDefault(); deckAct('later'); }
    else if (e.key === 'ArrowUp' || e.key === 'Enter') { e.preventDefault(); const a = $('#sApply'); if (a?.href) window.open(a.href, '_blank', 'noopener'); }
    else if (k === 'e') $('#sEmail')?.click();
    else if (e.key === ' ') { e.preventDefault(); $('#sMore')?.click(); }
    else if (k === 'z' || e.key === 'Backspace') { e.preventDefault(); deckUndo(); }
    return;
  }
  const idx = current.findIndex(j => j.id === S.sel);
  if (S.mode === 'list' && (k === 'j' || e.key === 'ArrowDown')) { e.preventDefault(); const n = current[Math.min(current.length - 1, idx + 1)]; if (n) { if (idx + 1 >= S.limit) { S.limit += 300; renderList(); } select(n.id); } }
  else if (S.mode === 'list' && (k === 'k' || e.key === 'ArrowUp')) { e.preventDefault(); const n = current[Math.max(0, idx - 1)]; if (n) select(n.id); }
  else if (e.key === 'Enter' && S.detailJob && S.sel) window.open(S.detailJob.applyUrl || S.detailJob.url, '_blank', 'noopener');
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
function renderPipeline() {
  const byId = new Map(S.jobs.map(j => [j.id, j]));
  const cols = [...STATUSES, ['_hidden', 'Hidden']];
  $('#kanban').innerHTML = cols.map(([st, label]) => {
    const items = Object.entries(S.meta.tracking).filter(([, t]) => st === '_hidden' ? (t.hidden || t.status === 'hidden') : t.status === st).map(([id]) => byId.get(id)).filter(Boolean);
    const empty = st === 'saved' ? 'Press <kbd>S</kbd> on a role' : st === '_hidden' ? 'Hidden roles land here' : 'Empty';
    return `<div class="col"><div class="col-h">${label}<span>${items.length}</span></div>${items.map(j => rowHtml(j)).join('') || `<div class="none">${empty}</div>`}</div>`;
  }).join('');
  hydrateIcons($('#kanban'));
  $$('#kanban .row').forEach(el => el.onclick = () => { location.hash = '#jobs'; setTimeout(() => select(el.dataset.id), 30); });
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
  $('#tileSub1').textContent = 'checked every 1–60 min';
  $('#tileSub2').textContent = 'new boards and lists'; $('#tileSub2').className = today ? 'up' : '';
  $('#tileSub3').textContent = 'duplicates removed';
  const tiers = Object.entries(d.tiers).filter(([, n]) => n);
  $('#tierBar').innerHTML = tiers.map(([k, n]) => `<div style="flex:${n};background:${TIER_COLORS[k]}" title="${k}: ${n}"></div>`).join('');
  $('#tierLegend').innerHTML = tiers.map(([k, n]) => `<span><i style="background:${TIER_COLORS[k]}"></i>${k} · ${fmt(n)}</span>`).join('');
  const via = Object.entries(d.byVia).sort((a, b) => b[1] - a[1]); const max = Math.max(1, ...via.map(v => v[1]));
  $('#viaList').innerHTML = via.map(([k, n]) => `<div class="barrow"><span>${esc(k)}</span><div class="bt"><div style="width:${100 * n / max}%"></div></div><b>${fmt(n)}</b></div>`).join('');
  $('#discLog').innerHTML = d.log.length ? d.log.map(l => `<li><time>${ago(Date.parse(l.at))}</time><div><span class="k ${l.kind}">${l.kind === 'board' ? 'board' : l.kind === 'source' ? 'new list' : 'retired'}</span>${esc(l.text)} <small>via ${esc(l.via)}</small></div></li>`).join('') : '<li><time></time><div class="muted">Discoveries will appear here.</div></li>';
  // sources table
  const yieldOf = id => d.yield.find(y => y.id === id) || { seen: 0, unique: 0 };
  const srcRows = (S.meta?.sources || []).map(s => { const y = yieldOf(s.id); const pct = y.seen ? Math.round(100 * y.unique / y.seen) : 0; const state = s.running ? '<span class="state live">Polling</span>' : s.ok === false ? `<span class="state bad" title="${esc(s.error || '')}">Error</span>` : s.at ? '<span class="state ok">OK</span>' : '<span class="state">Queued</span>';
    return `<tr title="${esc(s.trust || '')}"><td>${s.home ? `<a class="u" href="${esc(s.home)}" target="_blank" rel="noreferrer">${esc(s.name)}</a>` : esc(s.name)}${s.dynamic ? ' <span class="tag good" title="Lookout found this list on its own">auto</span>' : ''}</td><td>${state}</td><td class="mono muted">${s.every >= 3600 ? Math.round(s.every / 3600) + 'h' : s.every >= 60 ? Math.round(s.every / 60) + 'm' : s.every + 's'}</td><td class="mono muted">${s.at ? ago(Date.parse(s.at)) : '—'}</td><td class="num">${s.id === 'ats' || s.id === 'funding' ? fmt(s.totalAdded || s.added || 0) : `<span class="yieldbar"><span style="width:${pct}%"></span></span>${fmt(y.unique)}`}</td></tr>`; }).join('');
  $('#srcTable').innerHTML = `<thead><tr><th>Source</th><th>Status</th><th>Every</th><th>Last check</th><th class="num">Roles found first</th></tr></thead><tbody>${srcRows}</tbody>`;
  $('#watchList').innerHTML = (S.meta?.watch || []).map(w => `<span class="chip"><span class="k">${esc(w.provider)}</span><span class="v">${esc(w.name)}</span><button data-unwatch="${w.id}">${ic('x')}</button></span>`).join('');
  hydrateIcons($('#v-sources'));
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
  if (!$('#topicIdea').textContent) $('#topicIdea').textContent = 'lookout-' + crypto.getRandomValues(new Uint32Array(2)).reduce((a, n) => a + n.toString(36), '');
  const p = s.profile || {}; const pf = $('#profileForm'); pf.name.value = p.name || ''; pf.skills.value = (p.skills || []).join(', '); pf.link.value = p.link || ''; pf.pitch.value = p.pitch || '';
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
$('#profileForm').onsubmit = async e => {
  e.preventDefault(); const f = e.target;
  await api('/api/settings', { method: 'POST', body: JSON.stringify({ profile: { name: f.name.value, link: f.link.value, pitch: f.pitch.value, skills: f.skills.value.split(',').map(s => s.trim()).filter(Boolean) } }) });
  $('#profileMsg').textContent = 'Saved'; await loadMeta(); renderList();
};

// ───────────────────────────────────────────── theme, routing, sidebar
function toggleTheme() { const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); const next = cur === 'light' ? 'dark' : 'light'; setTheme(next); }
{ const t = ls.get('lk2.theme', null); if (t) document.documentElement.dataset.theme = t; }
function route() {
  const v = (location.hash || '#jobs').slice(1); S.view = ['jobs', 'signals', 'pipeline', 'sources', 'settings'].includes(v) ? v : 'jobs';
  $$('.view').forEach(el => el.classList.toggle('hidden', el.id !== 'v-' + S.view));
  $$('.nav a').forEach(a => a.classList.toggle('on', a.dataset.view === S.view));
  closeSide(); if (!S.meta) return;
  if (S.view === 'signals') renderSignals(); if (S.view === 'pipeline') renderPipeline(); if (S.view === 'sources') renderSources(); if (S.view === 'settings') renderSettings();
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
  $('#engState').textContent = !S.connected ? 'Offline' : busy ? 'Scanning' : 'Live';
  $('#engMeta').textContent = boards ? `${fmt(boards)} boards` : '';
  $('#engine').title = `${Math.max(0, src.length - 2)} feeds and ${fmt(boards)} company boards. Last check ${last ? agoLong(last) : 'pending'}.`;
}
setInterval(renderEngine, 5000);
function connect() {
  const es = new EventSource('/api/events');
  es.onopen = () => { S.connected = true; renderEngine(); };
  es.onerror = () => { S.connected = false; renderEngine(); };
  es.addEventListener('jobs', e => {
    const { added } = JSON.parse(e.data); const ids = new Set(S.jobs.map(j => j.id));
    const fresh = added.filter(j => !ids.has(j.id)); if (!fresh.length) return;
    S.jobs = [...fresh, ...S.jobs];
    const c = ctx(); const visible = fresh.filter(j => matches(j, S.filters, c)).map(j => j.id);
    S.pending.push(...visible);
    if (S.mode === 'slides') renderList(); // the deck keeps its card in place and just updates the count
    else if (S.view === 'jobs' && list.scrollTop < 20 && S.pending.length && S.pending.length < 25 && !$('#sheet').classList.contains('open')) { const set = new Set(S.pending); renderList(set); }
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
}
async function loadMeta() { S.meta = await api('/api/meta'); renderNav(); }

async function init() {
  hydrateIcons();
  $('#list').innerHTML = Array.from({ length: 10 }, () => '<div class="skel"></div>').join('');
  detailEmpty(); renderSort();
  await loadMeta();
  const v = S.meta.filterSets.find(x => x.id === S.activeView); if (v) $('#viewTitle').textContent = v.name; else S.activeView = null;
  const { jobs } = await api('/api/jobs'); S.jobs = jobs;
  refreshJobs(); setMode(S.mode); route(); renderEngine(); connect();
  api('/api/signals').then(r => $('#nSignals').textContent = fmt(r.companies.length)).catch(() => { });
  api('/api/discovery').then(d => $('#nSources').textContent = fmt(d.boards)).catch(() => { });
  setInterval(async () => { await loadMeta(); renderViews(); if (S.view === 'sources') renderSources(); }, 30000);
  setInterval(() => { if (S.view === 'jobs') $$('.row .t-time', list).forEach(el => { const j = S.jobs.find(x => x.id === el.closest('.row').dataset.id); if (j) el.textContent = when(j); }); }, 60000);
}
init().catch(e => { $('#list').innerHTML = `<div class="empty"><div class="empty-in"><h3>Can’t reach the scanner</h3><p>${esc(e.message)}. Start it with <code>npm start</code>.</p></div></div>`; });
