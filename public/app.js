import { matches, score, effectiveTime, EMPTY_FILTERS } from './filters.mjs';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = async (url, opt = {}) => { const r = await fetch(url, { ...opt, headers: { 'content-type': 'application/json' } }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || r.statusText); return d; };
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } } };
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), ms); }

const S = {
  jobs: [], meta: null, signals: [],
  filters: { ...EMPTY_FILTERS, ...store.get('lk.filters', { age: '7d' }) },
  activeSet: store.get('lk.activeSet', null), sort: store.get('lk.sort', 'new'),
  sel: null, limit: 120, pendingNew: [], view: 'feed', sigFilter: 'all',
};

const TYPES = ['Internship', 'Full-time', 'Part-time', 'Contract', 'Apprenticeship'];
const LEVELS = ['Intern', 'Entry', 'Mid', 'Senior', 'Senior+'];
const CATS = ['Engineering', 'AI / ML', 'Data', 'Product', 'Design', 'Sales / Growth', 'Operations', 'Other'];
const AGES = [['15m', 'Last 15 min'], ['1h', 'Last hour'], ['6h', 'Last 6 hours'], ['24h', 'Last 24 hours'], ['3d', 'Last 3 days'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['all', 'Any time']];
const STATUSES = [['saved', 'Saved'], ['applied', 'Applied'], ['contacted', 'Contacted'], ['interview', 'Interviewing'], ['rejected', 'Closed'], ['hidden', 'Hide']];

// ------------------------------------------------------------ helpers
function ago(t) {
  if (!Number.isFinite(t)) return '—';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400); return d < 30 ? `${d}d ago` : new Date(t).toLocaleDateString();
}
function jobAge(j) { return ago(effectiveTime(j)) + (j.precision === 'minute' ? '' : j.postedAt ? ' · date only' : ''); }
function isHot(j) { return Date.now() - effectiveTime(j) < 36e5 && (j.precision === 'minute' || Date.now() - Date.parse(j.firstSeen) < 36e5); }
const PALETTE = ['#4F46E5', '#0EA5E9', '#14B8A6', '#22A35A', '#D97706', '#E8590C', '#DB2777', '#7C3AED', '#475569', '#0891B2'];
function avatar(name, cls = 'av') { let h = 0; for (const c of name || '?') h = (h * 31 + c.charCodeAt(0)) >>> 0; return `<div class="${cls}" style="background:${PALETTE[h % PALETTE.length]}">${esc((name || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 1).toUpperCase() || '?')}</div>`; }
const srcName = id => S.meta?.sources.find(s => s.id === id)?.name || id;
const profileSkills = () => S.meta?.settings?.profile?.skills || [];
const ctx = () => ({ tracking: S.meta?.tracking || {} });

// ------------------------------------------------------------ filter bar
function countBy(key, list) { const m = new Map(); for (const j of list) { const v = typeof key === 'function' ? key(j) : j[key]; for (const x of [].concat(v)) if (x) m.set(x, (m.get(x) || 0) + 1); } return m; }
function renderFilterBar() {
  const f = S.filters; const jobs = S.jobs;
  const countries = [...countBy('country', jobs)].sort((a, b) => b[1] - a[1]);
  const skills = [...countBy(j => j.skills.map(s => s.name), jobs)].sort((a, b) => b[1] - a[1]).slice(0, 250);
  const sources = (S.meta?.sources || []).filter(s => s.kind === 'jobs');
  const sourceCounts = countBy(j => j.sources.map(s => s.source), jobs);
  const multi = (key, label, opts, searchable) => {
    const sel = f[key]; const active = sel.length > 0;
    return `<div class="fbtn ${active ? 'active' : ''}" data-key="${key}"><button type="button">${label}${active ? `: ${sel.length === 1 ? esc(sel[0]) : sel.length}` : ''}</button>
      <div class="pop hidden">${searchable ? '<input class="pop-search" placeholder="Filter…">' : ''}
      ${opts.map(([v, n, txt]) => `<label data-v="${esc(v).toLowerCase()}"><input type="checkbox" value="${esc(v)}" ${sel.includes(v) ? 'checked' : ''}>${esc(txt || v)}${n !== undefined ? `<span class="n">${n}</span>` : ''}</label>`).join('')}
      <div class="pop-foot"><button type="button" class="link" data-clear>Clear</button><button type="button" class="link" data-done>Done</button></div></div></div>`;
  };
  const tcount = countBy('type', jobs), lcount = countBy('level', jobs), ccount = countBy('category', jobs);
  $('#filterbar').innerHTML = `
    <div class="fbtn ${f.age !== 'all' ? 'active' : ''}" data-key="age"><button type="button">${AGES.find(a => a[0] === f.age)?.[1] || 'Any time'}</button>
      <div class="pop hidden">${AGES.map(([v, l]) => `<label><input type="radio" name="age" value="${v}" ${f.age === v ? 'checked' : ''}>${l}</label>`).join('')}</div></div>
    ${multi('types', 'Type', TYPES.map(t => [t, tcount.get(t) || 0]))}
    ${multi('levels', 'Level', LEVELS.map(t => [t, lcount.get(t) || 0]))}
    ${multi('categories', 'Role', CATS.map(t => [t, ccount.get(t) || 0]))}
    ${multi('countries', 'Location', countries, true)}
    ${multi('skills', 'Skills', skills, true)}
    ${multi('sources', 'Source', sources.map(s => [s.id, sourceCounts.get(s.id) || 0, s.name]))}
    ${toggle('remoteOnly', 'Remote')}${toggle('fundedOnly', '💰 Funded startups')}${toggle('hasContact', '✉ Has contact')}${toggle('hideTracked', 'Hide tracked')}
    ${JSON.stringify({ ...f, q: '' }) !== JSON.stringify({ ...EMPTY_FILTERS, q: '' }) ? '<button class="link clear" id="clearFilters">Reset filters</button>' : ''}`;
  function toggle(k, l) { return `<label class="toggle ${f[k] ? 'on' : ''}"><input type="checkbox" data-toggle="${k}" ${f[k] ? 'checked' : ''}>${l}</label>`; }

  $$('.fbtn').forEach(el => {
    const key = el.dataset.key; const pop = el.querySelector('.pop');
    el.querySelector(':scope > button').onclick = e => { e.stopPropagation(); const open = pop.classList.contains('hidden'); closePops(); if (open) { pop.classList.remove('hidden'); pop.querySelector('.pop-search')?.focus(); } };
    pop.onclick = e => e.stopPropagation();
    pop.querySelectorAll('input[type=checkbox]').forEach(cb => cb.onchange = () => { const v = cb.value; S.filters[key] = cb.checked ? [...S.filters[key], v] : S.filters[key].filter(x => x !== v); changed(false); el.classList.toggle('active', S.filters[key].length > 0); el.querySelector(':scope > button').textContent = labelFor(key); });
    pop.querySelectorAll('input[type=radio]').forEach(r => r.onchange = () => { S.filters.age = r.value; changed(); });
    pop.querySelector('.pop-search')?.addEventListener('input', e => { const q = e.target.value.toLowerCase(); pop.querySelectorAll('label').forEach(l => l.classList.toggle('hidden', !l.dataset.v?.includes(q))); });
    pop.querySelector('[data-clear]')?.addEventListener('click', () => { S.filters[key] = []; changed(); });
    pop.querySelector('[data-done]')?.addEventListener('click', () => { closePops(); renderFilterBar(); });
  });
  $$('[data-toggle]').forEach(cb => cb.onchange = () => { S.filters[cb.dataset.toggle] = cb.checked; changed(); });
  $('#clearFilters')?.addEventListener('click', () => { S.filters = { ...EMPTY_FILTERS, q: S.filters.q }; S.activeSet = null; changed(); });
}
function labelFor(key) { const sel = S.filters[key]; const base = { types: 'Type', levels: 'Level', categories: 'Role', countries: 'Location', skills: 'Skills', sources: 'Source' }[key]; return sel.length ? `${base}: ${sel.length === 1 ? (key === 'sources' ? srcName(sel[0]) : sel[0]) : sel.length}` : base; }
function closePops() { $$('.pop').forEach(p => p.classList.add('hidden')); }
document.addEventListener('click', () => { if ($$('.pop:not(.hidden)').length) { closePops(); renderFilterBar(); } });

function changed(rebar = true) {
  store.set('lk.filters', S.filters); store.set('lk.activeSet', S.activeSet);
  S.limit = 120; if (rebar) renderFilterBar(); renderList(); renderSets();
}

// ------------------------------------------------------------ list
function filtered() {
  const c = ctx(); const list = S.jobs.filter(j => matches(j, S.filters, c));
  if (S.sort === 'best') { const ps = profileSkills(); const now = Date.now(); list.sort((a, b) => score(b, ps, now) - score(a, ps, now)); }
  else list.sort((a, b) => effectiveTime(b) - effectiveTime(a));
  return list;
}
function jobRow(j, opts = {}) {
  const ps = new Set(profileSkills().map(s => s.toLowerCase()));
  const tr = S.meta?.tracking?.[j.id];
  const tags = [
    j.type === 'Internship' ? '<span class="tag intern">Internship</span>' : j.level === 'Entry' ? '<span class="tag intern">Entry level</span>' : `<span class="tag">${esc(j.level)}</span>`,
    j.funded ? `<span class="tag funded" title="${esc(j.funding?.publisher || '')}">${esc(j.funding?.label || 'Funded')}</span>` : '',
    j.remote ? '<span class="tag remote">Remote</span>' : '',
    j.contactCount ? '<span class="tag mail">✉ contact</span>' : '',
    tr ? `<span class="tag status">${esc(STATUSES.find(s => s[0] === tr.status)?.[1] || tr.status)}</span>` : '',
    ...j.skills.slice(0, 5).map(s => `<span class="tag skill ${ps.has(s.name.toLowerCase()) ? 'hit' : ''}">${esc(s.name)}</span>`),
  ].join('');
  return `<div class="job ${S.sel === j.id ? 'sel' : ''} ${isHot(j) ? 'fresh' : ''} ${opts.flash ? 'seen-new' : ''}" data-id="${j.id}" role="listitem">
    ${avatar(j.company)}
    <div><h3>${esc(j.title)}</h3><div class="co">${esc(j.company)} · ${esc(j.location || j.country)}</div><div class="tags">${tags}</div></div>
    <div class="when ${isHot(j) ? 'hot' : ''}">${jobAge(j)}<span class="src">${j.sources.length > 1 ? `${j.sources.length} sources` : esc(srcName(j.sources[0]?.source))}</span></div></div>`;
}
function renderList(flashIds = new Set()) {
  const list = filtered();
  const hour = list.filter(isHot).length;
  $('#resultCount').innerHTML = `<b>${list.length.toLocaleString()}</b> roles${hour ? ` · <span style="color:var(--hot);font-weight:700">${hour} in the last hour</span>` : ''} <span class="small">· deduplicated from ${S.jobs.reduce((n, j) => n + j.sources.length, 0).toLocaleString()} listings</span>`;
  $('#list').innerHTML = list.length ? list.slice(0, S.limit).map(j => jobRow(j, { flash: flashIds.has(j.id) })).join('') + (list.length > S.limit ? `<button class="btn more" id="more">Show ${Math.min(200, list.length - S.limit)} more</button>` : '')
    : `<div class="empty"><b>No roles match these filters</b>Try a longer time window or remove a filter. New listings stream in automatically.</div>`;
  $('#more')?.addEventListener('click', () => { S.limit += 200; renderList(); });
  $('#navJobs').textContent = S.jobs.length ? S.jobs.length.toLocaleString() : '';
  S.pendingNew = []; updateBanner();
}
$('#list').addEventListener('click', e => { const el = e.target.closest('.job'); if (el) openJob(el.dataset.id); });
$('#sort').value = S.sort; $('#sort').onchange = e => { S.sort = e.target.value; store.set('lk.sort', S.sort); renderList(); };
let qT; $('#q').value = S.filters.q || ''; $('#q').oninput = e => { clearTimeout(qT); qT = setTimeout(() => { S.filters.q = e.target.value.trim(); if (S.view !== 'feed') location.hash = '#feed'; changed(false); }, 160); };

function updateBanner() {
  const b = $('#newBanner'); const n = S.pendingNew.length;
  b.classList.toggle('hidden', !n); b.textContent = `↑ ${n} new role${n > 1 ? 's' : ''}`;
  document.title = n ? `(${n}) Lookout` : 'Lookout';
}
$('#newBanner').onclick = () => { const ids = new Set(S.pendingNew); renderList(ids); $('#list').scrollTop = 0; };

// ------------------------------------------------------------ detail
async function openJob(id) {
  S.sel = id; $$('.job').forEach(el => el.classList.toggle('sel', el.dataset.id === id));
  const d = $('#detail'); d.classList.remove('empty-detail');
  d.innerHTML = '<div class="d-body" style="padding:30px"><span class="spinner"></span> Loading…</div>';
  let j; try { j = await api('/api/job/' + encodeURIComponent(id)); } catch (e) { d.innerHTML = `<div class="d-body">${esc(e.message)}</div>`; return; }
  if (S.sel !== id) return;
  const tr = S.meta.tracking[id] || {};
  const ps = new Set(profileSkills().map(s => s.toLowerCase()));
  const groups = {}; for (const s of j.skills) (groups[s.group] ||= []).push(s.name);
  const apply = j.applyUrl || j.url;
  d.innerHTML = `
    <div class="d-head"><div class="row">${avatar(j.company)}<div style="flex:1;min-width:0"><h2>${esc(j.title)}</h2><div class="co">${esc(j.company)} · ${esc(j.location || j.country)}${j.remote ? ' · Remote' : ''}</div></div><button class="btn ghost d-close" id="dClose">✕</button></div>
      <div class="d-actions"><a class="btn primary" href="${esc(apply)}" target="_blank" rel="noreferrer">Apply on original listing ↗</a><button class="btn hot" id="draftBtn">✉ Draft outreach email</button><button class="btn" id="saveBtn">${tr.status === 'saved' ? '★ Saved' : '☆ Save'}</button></div></div>
    <div class="d-body">
      <div class="d-sec"><div class="facts">
        <div class="fact"><span>Posted</span><b>${jobAge(j)}</b></div>
        <div class="fact"><span>First detected by Lookout</span><b>${ago(Date.parse(j.firstSeen))}</b></div>
        <div class="fact"><span>Type · Level</span><b>${esc(j.type)} · ${esc(j.level)}</b></div>
        <div class="fact"><span>Role</span><b>${esc(j.category)}</b></div>
        ${j.salary ? `<div class="fact"><span>Pay</span><b>${esc(j.salary)}</b></div>` : ''}
        ${j.funding ? `<div class="fact"><span>Funding signal</span><b>${j.funding.url ? `<a href="${esc(j.funding.url)}" target="_blank" rel="noreferrer">${esc(j.funding.label)} ↗</a>` : esc(j.funding.label)}${j.funding.at ? ` · ${ago(Date.parse(j.funding.at))}` : ''}</b></div>` : ''}
      </div></div>
      <div class="d-sec"><h4>Skills mentioned (${j.skills.length})</h4>${j.skills.length ? `<div class="skillgroups">${Object.entries(groups).map(([g, l]) => `<div class="sg"><em>${esc(g)}</em>${l.map(n => `<span class="tag skill ${ps.has(n.toLowerCase()) ? 'hit' : ''}">${esc(n)}</span>`).join('')}</div>`).join('')}</div>` : '<span class="muted small">No known skill terms in the listing text. Check the full posting.</span>'}</div>
      ${j.requirements?.length ? `<div class="d-sec"><h4>Requirements from the posting</h4><ul class="reqs">${j.requirements.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>` : ''}
      <div class="d-sec" id="contactSec"><h4>Who to contact</h4><div id="contacts"><span class="spinner"></span> <span class="muted small">Checking the job post, company website, GitHub and YC profile…</span></div></div>
      <div class="d-sec"><h4>Track it</h4><div class="statusbar">${STATUSES.map(([v, l]) => `<button data-st="${v}" class="${tr.status === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        <textarea class="note" id="note" rows="2" placeholder="Notes: who you emailed, when to follow up…">${esc(tr.note || '')}</textarea></div>
      <div class="d-sec"><h4>Seen on ${j.sources.length} source${j.sources.length > 1 ? 's' : ''}</h4><div class="srcs">${j.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noreferrer">${esc(srcName(s.source))} ↗<span>${s.postedAt ? ago(Date.parse(s.postedAt)) : 'no date'} · seen ${ago(Date.parse(s.seenAt))}</span></a>`).join('')}</div></div>
      ${j.description ? `<div class="d-sec"><h4>Full listing text</h4><div class="desc clamp" id="desc">${esc(j.description)}</div><button class="link" id="descMore">Show all</button></div>` : ''}
    </div>`;
  $('#dClose').onclick = () => { S.sel = null; d.classList.add('empty-detail'); d.innerHTML = ''; $$('.job.sel').forEach(x => x.classList.remove('sel')); };
  $('#descMore')?.addEventListener('click', e => { $('#desc').classList.toggle('clamp'); e.target.textContent = $('#desc').classList.contains('clamp') ? 'Show all' : 'Show less'; });
  $('#saveBtn').onclick = () => track(id, tr.status === 'saved' ? '' : 'saved');
  $$('[data-st]').forEach(b => b.onclick = () => track(id, b.classList.contains('on') ? '' : b.dataset.st));
  $('#note').onchange = e => track(id, S.meta.tracking[id]?.status || 'saved', e.target.value);
  let contacts = null;
  $('#draftBtn').onclick = () => draftEmail(j, contacts);
  loadContacts(j).then(c => { contacts = c; });
}

async function loadContacts(j, refresh = false) {
  try {
    const c = await api(`/api/contacts/${encodeURIComponent(j.id)}${refresh ? '?refresh=1' : ''}`);
    if (S.sel !== j.id) return c;
    const parts = [];
    for (const e of c.emails) parts.push(`<div class="contact"><div><div class="em"><a href="mailto:${esc(e.email)}">${esc(e.email)}</a></div><div class="via">${esc(e.role)} · found on <a href="${esc(e.url)}" target="_blank" rel="noreferrer">${esc(e.source)}</a></div></div><span class="badge ${e.confidence === 'published' ? 'pub' : 'off'}">${e.confidence === 'published' ? 'Published' : 'Other domain'}</span></div>`);
    if (c.founders?.length) parts.push(`<div style="margin:10px 0 4px" class="small muted">Founders (from YC profile)</div>` + c.founders.map(f => `<div class="founder">${avatar(f.name, 'av')}<div><b>${esc(f.name)}</b> <span class="muted small">${esc(f.role || '')}</span><div class="small">${f.linkedin ? `<a href="${esc(f.linkedin)}" target="_blank" rel="noreferrer">LinkedIn ↗</a> ` : ''}${f.x ? `<a href="${esc(f.x)}" target="_blank" rel="noreferrer">X ↗</a>` : ''}</div></div></div>`).join(''));
    for (const g of c.guesses || []) parts.push(`<div class="contact guess"><div><div class="em">${esc(g.email)}</div><div class="via">${esc(g.name)} · ${esc(g.source)}${g.alt?.length ? ` · also try ${g.alt.map(esc).join(', ')}` : ''}</div></div><span class="badge guess">Guess</span></div>`);
    const soc = Object.entries(c.socials || {}).map(([k, u]) => `<a href="${esc(u)}" target="_blank" rel="noreferrer">${esc({ linkedin: 'LinkedIn', x: 'X / Twitter', github: 'GitHub', instagram: 'Instagram' }[k] || k)} ↗</a>`).join(' · ');
    $('#contacts').innerHTML = (parts.join('') || `<div class="muted small">No published email found${c.website ? ` on ${esc(c.domain)}` : ' (company website unknown)'}. Apply via the listing, or reach founders on LinkedIn / X.</div>`)
      + `<div class="small" style="margin-top:8px">${c.website ? `<a href="${esc(c.website)}" target="_blank" rel="noreferrer">${esc(c.domain)} ↗</a>` : ''}${soc ? ' · ' + soc : ''} · <button class="link" id="reContacts">Re-check</button></div>`
      + (c.pagesChecked?.length ? `<div class="hint">Checked ${c.pagesChecked.length} page(s) ${ago(Date.parse(c.checkedAt))}.</div>` : '');
    $('#reContacts').onclick = () => { $('#contacts').innerHTML = '<span class="spinner"></span>'; loadContacts(j, true); };
    return c;
  } catch (e) { if (S.sel === j.id) $('#contacts').innerHTML = `<span class="muted small">Could not check contacts: ${esc(e.message)}</span>`; return null; }
}

function draftEmail(j, c) {
  const p = S.meta.settings.profile || {};
  const best = c?.emails?.[0]?.email || j.emails?.[0] || c?.guesses?.[0]?.email || '';
  const founder = c?.founders?.[0]?.name?.split(' ')[0];
  const mine = new Set((p.skills || []).map(s => s.toLowerCase()));
  const overlap = j.skills.filter(s => mine.has(s.name.toLowerCase())).map(s => s.name).slice(0, 5);
  const subject = `${j.title} at ${j.company}${p.name ? ` | ${p.name}` : ''}`;
  const body = [
    `Hi ${founder || `${j.company} team`},`, '',
    `I just saw that ${j.company} is hiring for ${j.title}${j.funding ? `, and congratulations on the ${j.funding.label}` : ''}. I'd love to be considered.`, '',
    p.pitch || '[2–3 lines about you: what you built, what you are great at]', '',
    overlap.length ? `I've worked hands-on with ${overlap.join(', ')}, which lines up with what the role needs.` : `[Why you fit: match a requirement from the post]`, '',
    p.link ? `My work: ${p.link}` : '', '',
    'Would you be open to a 15-minute chat this week?', '', 'Thanks,', p.name || '[Your name]',
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
  const href = `mailto:${encodeURIComponent(best)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  navigator.clipboard?.writeText(`To: ${best}\nSubject: ${subject}\n\n${body}`).catch(() => { });
  location.href = href;
  toast(best ? `Draft opened for ${best} (also copied to clipboard)` : 'Draft opened. No email found yet, add a recipient.');
  if (!S.meta.tracking[j.id]) track(j.id, 'contacted');
}

async function track(id, status, note) {
  const prev = S.meta.tracking[id];
  const r = await api('/api/track', { method: 'POST', body: JSON.stringify({ id, status, note: note ?? prev?.note ?? '' }) });
  if (r) S.meta.tracking[id] = r; else delete S.meta.tracking[id];
  if (S.sel === id) { $$('[data-st]').forEach(b => b.classList.toggle('on', b.dataset.st === status)); const sb = $('#saveBtn'); if (sb) sb.textContent = status === 'saved' ? '★ Saved' : '☆ Save'; }
  const row = $(`.job[data-id="${id}"]`); const j = S.jobs.find(x => x.id === id); if (row && j) row.outerHTML = jobRow(j);
  renderNavCounts(); if (S.view === 'tracker') renderTracker();
}

// ------------------------------------------------------------ saved filter sets
function renderSets() {
  const c = ctx();
  $('#setList').innerHTML = (S.meta?.filterSets || []).map(fs => {
    const list = S.jobs.filter(j => matches(j, fs.filters, c)); const hot = list.filter(isHot).length;
    return `<div class="set ${S.activeSet === fs.id ? 'on' : ''}" data-id="${fs.id}"><span class="nm" title="${esc(fs.name)}">${esc(fs.name)}</span><span class="ct ${hot ? 'hot' : ''}">${hot ? `+${hot}` : list.length}</span>
      <button class="bell ${fs.alert ? '' : 'off'}" data-bell title="${fs.alert ? 'Phone alerts on' : 'Phone alerts off'}">🔔</button><button data-del title="Delete">✕</button></div>`;
  }).join('') || '<p class="hint">No saved sets yet.</p>';
  $$('.set').forEach(el => {
    const fs = S.meta.filterSets.find(x => x.id === el.dataset.id);
    el.onclick = () => { S.activeSet = fs.id; S.filters = { ...EMPTY_FILTERS, ...fs.filters }; $('#q').value = S.filters.q || ''; location.hash = '#feed'; changed(); closeRail(); };
    el.querySelector('[data-bell]').onclick = async e => { e.stopPropagation(); fs.alert = !fs.alert; await api('/api/filter-sets', { method: 'POST', body: JSON.stringify(fs) }); renderSets(); toast(fs.alert ? `🔔 Alerts on for “${fs.name}”` : `Alerts off for “${fs.name}”`); };
    el.querySelector('[data-del]').onclick = async e => { e.stopPropagation(); if (!confirm(`Delete “${fs.name}”?`)) return; await api('/api/filter-sets/' + fs.id, { method: 'DELETE' }); S.meta.filterSets = S.meta.filterSets.filter(x => x.id !== fs.id); if (S.activeSet === fs.id) S.activeSet = null; renderSets(); };
  });
}
function describeFilters(f) {
  const bits = [];
  if (f.q) bits.push(`“${f.q}”`); if (f.age !== 'all') bits.push(AGES.find(a => a[0] === f.age)?.[1]);
  for (const k of ['types', 'levels', 'categories', 'countries', 'skills']) if (f[k].length) bits.push(f[k].join(' / '));
  if (f.sources.length) bits.push('from ' + f.sources.map(srcName).join(', '));
  if (f.remoteOnly) bits.push('remote'); if (f.fundedOnly) bits.push('funded startups'); if (f.hasContact) bits.push('has contact');
  return bits.join(' · ') || 'All roles';
}
$('#saveSet').onclick = () => {
  const fs = S.meta.filterSets.find(x => x.id === S.activeSet);
  const form = $('#setForm'); form.name.value = fs?.name || ''; form.alert.checked = fs ? fs.alert : true;
  $('#setSummary').textContent = describeFilters(S.filters) + (fs ? `  (updates “${fs.name}” unless you rename it)` : '');
  $('#setDialog').showModal();
};
$('#setDialog').addEventListener('close', async () => {
  if ($('#setDialog').returnValue !== 'ok') return;
  const form = $('#setForm'); const fs = S.meta.filterSets.find(x => x.id === S.activeSet);
  const rec = await api('/api/filter-sets', { method: 'POST', body: JSON.stringify({ id: fs && fs.name === form.name.value ? fs.id : undefined, name: form.name.value, alert: form.alert.checked, filters: S.filters }) });
  const i = S.meta.filterSets.findIndex(x => x.id === rec.id); if (i >= 0) S.meta.filterSets[i] = rec; else S.meta.filterSets.push(rec);
  S.activeSet = rec.id; changed(false); toast(`Saved “${rec.name}”${rec.alert ? ' with phone alerts' : ''}`);
});

// ------------------------------------------------------------ signals
async function renderSignals() {
  const { companies } = await api('/api/signals'); S.signals = companies;
  const f = S.sigFilter;
  const list = companies.filter(c => f === 'all' || (f === 'news' && c.funding.at) || (f === 'yc' && c.yc) || (f === 'open' && c.openJobs));
  const atsPill = c => c.ats ? `<span class="pill watch">Watching ${esc(c.ats.provider)} board</span>` : c.atsCheckedAt ? '<span class="pill none">No public board found</span>' : '<span class="pill wait">Looking for careers board…</span>';
  $('#signalList').innerHTML = list.slice(0, 400).map(c => `<div class="card"><div class="top">${avatar(c.name)}<div style="flex:1;min-width:0"><h3>${esc(c.name)}</h3><div class="one">${esc(c.oneLiner || c.industry || '')}</div></div></div>
    <div class="tags"><span class="tag funded">${c.funding.url ? `<a href="${esc(c.funding.url)}" target="_blank" rel="noreferrer">${esc(c.funding.label)}</a>` : esc(c.funding.label)}</span>${c.funding.at ? `<span class="tag">${ago(Date.parse(c.funding.at))}</span>` : ''}${c.funding.publisher ? `<span class="tag">${esc(c.funding.publisher)}</span>` : ''}${c.teamSize ? `<span class="tag">${c.teamSize} people</span>` : ''}${c.isHiring ? '<span class="tag remote">Hiring on YC</span>' : ''}</div>
    <div class="foot">${atsPill(c)}${c.openJobs ? `<button class="btn sm primary" data-co="${esc(c.name)}">${c.openJobs} open role${c.openJobs > 1 ? 's' : ''}</button>` : ''}${c.website ? `<a href="${esc(c.website)}" target="_blank" rel="noreferrer">Website ↗</a>` : ''}</div></div>`).join('') || '<div class="empty"><b>No funding signals yet</b>Funding feeds refresh every 5 minutes.</div>';
  $$('[data-co]').forEach(b => b.onclick = () => { S.filters = { ...EMPTY_FILTERS, q: `"${b.dataset.co.toLowerCase()}"` }; $('#q').value = S.filters.q; S.activeSet = null; location.hash = '#feed'; changed(); });
  $('#navSignals').textContent = companies.length || '';
}
$$('#sigFilter button').forEach(b => b.onclick = () => { S.sigFilter = b.dataset.f; $$('#sigFilter button').forEach(x => x.classList.toggle('on', x === b)); renderSignals(); });

// ------------------------------------------------------------ tracker
function renderTracker() {
  const cols = STATUSES.filter(s => s[0] !== 'hidden');
  const byId = new Map(S.jobs.map(j => [j.id, j]));
  $('#board').innerHTML = cols.map(([st, label]) => {
    const items = Object.entries(S.meta.tracking).filter(([, t]) => t.status === st).map(([id]) => byId.get(id)).filter(Boolean);
    return `<div class="col"><h3>${label}<span>${items.length}</span></h3>${items.map(j => jobRow(j)).join('') || '<div class="muted small">Nothing here yet</div>'}</div>`;
  }).join('');
  $$('#board .job').forEach(el => el.onclick = () => { location.hash = '#feed'; setTimeout(() => openJob(el.dataset.id), 50); });
}
function renderNavCounts() { const n = Object.values(S.meta?.tracking || {}).filter(t => t.status !== 'hidden').length; $('#navTracker').textContent = n || ''; }

// ------------------------------------------------------------ sources
function renderSources() {
  const rows = S.meta.sources.map(s => `<tr><td><span class="dot ${s.running ? 'idle' : s.ok === false ? 'bad' : s.at ? 'ok' : 'idle'}"></span>${s.home ? `<a href="${esc(s.home)}" target="_blank" rel="noreferrer">${esc(s.name)}</a>` : esc(s.name)}<div class="small muted">${esc(s.trust)}</div></td>
    <td>every ${s.every >= 3600 ? Math.round(s.every / 3600) + 'h' : s.every >= 60 ? Math.round(s.every / 60) + ' min' : s.every + 's'}</td>
    <td>${s.running ? '<span class="spinner"></span>' : s.at ? ago(Date.parse(s.at)) : '—'}${s.ms ? `<div class="small muted">${(s.ms / 1000).toFixed(1)}s</div>` : ''}</td>
    <td>${s.totalAdded ?? 0}${s.boards !== undefined ? `<div class="small muted">${s.boards} boards</div>` : ''}</td>
    <td class="small" style="color:var(--bad)">${esc(s.error || '')}</td></tr>`).join('');
  $('#sourceTable').innerHTML = `<table><thead><tr><th>Source</th><th>Polls</th><th>Last run</th><th>Roles added</th><th>Issues</th></tr></thead><tbody>${rows}</tbody></table>`;
  $('#watchList').innerHTML = S.meta.watch.map(w => `<span class="chip">${esc(w.name)} · ${esc(w.provider)}<button data-unwatch="${w.id}" title="Stop watching">✕</button></span>`).join('');
  $$('[data-unwatch]').forEach(b => b.onclick = async () => { await api('/api/watch/' + b.dataset.unwatch, { method: 'DELETE' }); await loadMeta(); renderSources(); });
  $('#navSources').textContent = S.meta.sources.filter(s => s.ok === false).length ? '⚠' : '';
}
$('#watchForm').onsubmit = async e => {
  e.preventDefault(); const f = e.target; $('#watchMsg').innerHTML = '<span class="spinner"></span> Detecting careers board…';
  try { const w = await api('/api/watch', { method: 'POST', body: JSON.stringify({ name: f.name.value, url: f.url.value }) }); $('#watchMsg').textContent = `Watching ${w.name} (${w.provider}/${w.board}). New roles will appear within a minute.`; f.reset(); await loadMeta(); renderSources(); }
  catch (err) { $('#watchMsg').textContent = err.message; }
};

// ------------------------------------------------------------ settings
function renderSettings() {
  const s = S.meta.settings; const f = $('#pushForm');
  f.ntfyTopic.value = s.ntfyTopic || ''; f.ntfyServer.value = s.ntfyServer || 'https://ntfy.sh'; f.ntfyToken.value = s.hasToken ? '••••' : ''; f.quietHours.value = s.quietHours || ''; f.desktopNotify.checked = !!s.desktopNotify;
  if (!$('#topicIdea').textContent) $('#topicIdea').textContent = 'lookout-' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
  const p = s.profile || {}; const pf = $('#profileForm'); pf.name.value = p.name || ''; pf.skills.value = (p.skills || []).join(', '); pf.link.value = p.link || ''; pf.pitch.value = p.pitch || '';
  $('#alertLog').innerHTML = S.meta.alerts.length ? S.meta.alerts.map(a => `<div class="alert-row"><span><b>${esc(a.company)}</b>: ${esc(a.title)}<div class="muted">${esc(a.sets.join(', '))}</div></span><span class="muted">${ago(Date.parse(a.at))}</span></div>`).join('') : '<span class="muted">No alerts yet. They appear here and on your phone when a saved set with 🔔 gets a new match.</span>';
}
$('#pushForm').onsubmit = async e => {
  e.preventDefault(); const f = e.target;
  await api('/api/settings', { method: 'POST', body: JSON.stringify({ ntfyTopic: f.ntfyTopic.value, ntfyServer: f.ntfyServer.value, ntfyToken: f.ntfyToken.value, quietHours: f.quietHours.value, desktopNotify: f.desktopNotify.checked }) });
  if (f.desktopNotify.checked && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  $('#pushMsg').textContent = 'Saved'; await loadMeta();
};
$('#testPush').onclick = async () => { $('#pushMsg').textContent = 'Sending…'; try { await api('/api/test-push', { method: 'POST' }); $('#pushMsg').textContent = 'Sent. Check your phone.'; } catch (e) { $('#pushMsg').textContent = e.message; } };
$('#profileForm').onsubmit = async e => {
  e.preventDefault(); const f = e.target;
  const profile = { name: f.name.value, link: f.link.value, pitch: f.pitch.value, skills: f.skills.value.split(',').map(s => s.trim()).filter(Boolean) };
  await api('/api/settings', { method: 'POST', body: JSON.stringify({ profile }) }); $('#profileMsg').textContent = 'Saved. “Best match” now uses your skills.'; await loadMeta(); renderList();
};

// ------------------------------------------------------------ routing
function route() {
  const v = (location.hash || '#feed').slice(1); S.view = ['feed', 'signals', 'tracker', 'sources', 'settings'].includes(v) ? v : 'feed';
  $$('.view').forEach(el => el.classList.toggle('hidden', el.id !== 'view-' + S.view));
  $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.view === S.view));
  if (!S.meta) return;
  if (S.view === 'signals') renderSignals(); if (S.view === 'tracker') renderTracker(); if (S.view === 'sources') renderSources(); if (S.view === 'settings') renderSettings();
  closeRail();
}
window.addEventListener('hashchange', route);
$('#menuBtn').onclick = e => { e.stopPropagation(); $('#rail').classList.toggle('open'); };
function closeRail() { $('#rail').classList.remove('open'); }
$('#scanNow').onclick = async () => { await api('/api/scan', { method: 'POST' }); toast('Polling every source now…'); };

// ------------------------------------------------------------ live status
function renderLive() {
  const src = S.meta?.sources || []; const busy = src.some(s => s.running);
  const last = Math.max(...src.map(s => Date.parse(s.at || 0)));
  const el = $('#live'); el.className = 'live ' + (S.connected ? (busy ? 'busy on' : 'on') : '');
  el.querySelector('span').textContent = !S.connected ? 'Reconnecting…' : busy ? 'Scanning…' : `Live · checked ${ago(last)}`;
}
setInterval(renderLive, 5000);

function connect() {
  const es = new EventSource('/api/events');
  es.onopen = () => { S.connected = true; renderLive(); };
  es.onerror = () => { S.connected = false; renderLive(); };
  es.addEventListener('jobs', e => {
    const { added } = JSON.parse(e.data); const ids = new Set(S.jobs.map(j => j.id));
    const fresh = added.filter(j => !ids.has(j.id)); if (!fresh.length) return;
    S.jobs = [...fresh, ...S.jobs];
    const c = ctx(); const visible = fresh.filter(j => matches(j, S.filters, c));
    S.pendingNew.push(...visible.map(j => j.id));
    if ($('#list').scrollTop < 40 && S.pendingNew.length < 30 && S.view === 'feed') renderList(new Set(S.pendingNew)); else updateBanner();
    renderSets();
  });
  es.addEventListener('alert', e => {
    const items = JSON.parse(e.data);
    if (S.meta?.settings?.desktopNotify && 'Notification' in window && Notification.permission === 'granted')
      for (const a of items.slice(0, 3)) { const n = new Notification(`${a.company}: ${a.title}`, { body: `Matched ${a.sets.join(', ')}`, icon: '/logo.svg', tag: a.id }); n.onclick = () => { window.focus(); location.hash = '#feed'; openJob(a.id); }; }
    toast(`🔔 ${items.length} new match${items.length > 1 ? 'es' : ''}: ${items[0].company}, ${items[0].title}`, 5000);
  });
  es.addEventListener('status', e => { const st = JSON.parse(e.data); const s = S.meta?.sources.find(x => x.id === st.id); if (s) Object.assign(s, st); renderLive(); if (S.view === 'sources') renderSources(); });
  es.addEventListener('funding', () => { if (S.view === 'signals') renderSignals(); });
}

async function loadMeta() { S.meta = await api('/api/meta'); renderNavCounts(); }
async function init() {
  await loadMeta();
  const { jobs } = await api('/api/jobs'); S.jobs = jobs;
  renderFilterBar(); renderList(); renderSets(); route(); renderLive(); connect();
  api('/api/signals').then(r => { $('#navSignals').textContent = r.companies.length || ''; });
  setInterval(async () => { await loadMeta(); renderSets(); }, 60000);
}
init().catch(e => { $('#list').innerHTML = `<div class="empty"><b>Can’t reach the scanner</b>${esc(e.message)}. Start it with <code>npm start</code>.</div>`; });
