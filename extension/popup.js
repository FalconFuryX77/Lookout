// The panel that opens when you click the Lookout button.
// 1. read the job on the page you are looking at (reader.js, injected only now, only into this tab)
// 2. ask your Lookout to compare it with your profile and check whether it already has the role
// 3. if Lookout is closed, compare skills here, from your profile as of the last time it was connected
import { readJobPage } from './reader.js';
import { extractSkills } from './lib/skills.mjs';
import { fit } from './lib/filters.mjs';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = t => { const m = Math.round((Date.now() - t) / 6e4); return !Number.isFinite(m) ? '' : m < 60 ? `${Math.max(1, m)} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
const say = (html, cls = 'note') => { $('#main').innerHTML = `<div class="${cls}">${html}</div>`; };
const status = (text, kind) => { $('#statusText').textContent = text; $('#status').className = `status ${kind || ''}`; };
$('#opts').onclick = e => { e.preventDefault(); chrome.runtime.openOptionsPage(); };

const settings = await chrome.storage.local.get({ port: 4173, key: '', profile: null });
const base = `http://127.0.0.1:${settings.port}`;
const call = async (path, body) => {
  const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${settings.key}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  const d = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(d.error || `Lookout answered ${r.status}`), { status: r.status }); return d;
};

// 1. read the page. A ?tab= address is only used when testing the panel in a normal tab.
const forced = Number(new URLSearchParams(location.search).get('tab'));
const [tab] = forced ? [await chrome.tabs.get(forced)] : await chrome.tabs.query({ active: true, currentWindow: true });
if (!tab || !/^https?:/.test(tab.url || '')) { status('', ''); say('Open a job posting, then click the Lookout button.'); throw new Error('no page'); }
let page;
try { [{ result: page }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readJobPage }); }
catch { say('This page can’t be read. Browser pages and the extension store are off limits to extensions.'); throw new Error('unreadable'); }
$('#how').textContent = page.how === 'structured' ? 'Read from the page’s job data' : page.how === 'site' ? 'Read from the page' : 'Read from the page text';

// 2. ask Lookout
let hello = null;
try { hello = await call('/api/ext/hello'); } catch { /* not running */ }
if (hello?.paired) {
  status(`Connected · ${hello.profile.label}`, 'on');
  chrome.storage.local.set({ profile: hello.profile, profileAt: Date.now() }); // for when Lookout is closed
  try { render(await call('/api/ext/compare', { page }), true); }
  catch (e) { say(esc(e.message)); }
} else if (hello) {
  status('Not paired', 'off');
  say('<b>Pair the extension with Lookout first.</b><br>In Lookout open Settings → Browser extension, copy the pairing key, and paste it under <a href="#" id="pairNow">Settings</a> here.');
  $('#pairNow').onclick = e => { e.preventDefault(); chrome.runtime.openOptionsPage(); };
} else {
  // 3. Lookout is closed: compare skills here
  status('Lookout is closed', 'off');
  if (!settings.profile) { say('<b>Lookout isn’t running.</b><br>Start Lookout to compare this job with your profile. After the first time, skills can be compared even while it’s closed.'); }
  else {
    const skills = extractSkills(page.description, page.title);
    const ft = fit({ skills }, settings.profile);
    render({ profile: settings.profile, role: { title: page.title, company: page.company, skills: skills.map(s => s.name) }, fit: ft, overReach: false, onFile: null, offline: true }, false);
  }
}

function render(r, online) {
  const { role, fit: ft } = r; const techN = ft.have.length + ft.missing.length; const pct = techN ? Math.round(100 * ft.have.length / techN) : 0;
  const warns = [];
  if (r.overReach) warns.push(`Asks for more experience than you have${role.yearsMin ? ` (${role.yearsMin}+ years; you have ${r.profile.yearsExp ?? 0})` : role.level ? ` (${role.level})` : ''}.`);
  else if (ft.expGap >= 1) warns.push(`Asks for ${role.yearsMin}+ years; your profile has ${r.profile.yearsExp}.`);
  if (role.visa === 'Citizens / clearance only') warns.push('Citizens or security clearance only.');
  if (role.visa === 'No sponsorship') warns.push('Says it does not sponsor visas.');
  const facts = [role.type, role.level && role.level !== 'Intern' ? role.level : '', role.workMode && role.workMode !== 'Not stated' ? role.workMode : '', role.yearsMin === 0 && !role.yearsMax ? 'No experience needed' : role.yearsMin ? `${role.yearsMin}${role.yearsMax && role.yearsMax !== role.yearsMin ? `–${role.yearsMax}` : '+'} yrs` : ''].filter(Boolean);
  const chip = (n, c) => `<span class="sk ${c}">${esc(n)}</span>`;
  $('#main').innerHTML = `
    <h1>${esc(role.title)}</h1><div class="co">${esc(role.company)}${facts.length ? ` · ${esc(facts.join(' · '))}` : ''}</div>
    ${techN ? `<div class="big"><b>${ft.have.length} of ${techN}</b><span>skills you have</span></div><div class="bar"><i style="width:${pct}%"></i></div>
      <div class="chips">${ft.have.map(n => chip(n, 'hit')).join('')}${ft.missing.map(n => chip(n, '')).join('')}</div>`
      : `<p class="muted" style="margin:12px 0 0">No technical skills named on this page${r.profile.skills?.length ? '' : ', and your profile has none yet'}.</p>`}
    ${ft.general?.length ? `<div class="lab">Also mentions</div><div class="chips">${ft.general.map(n => chip(n, 'gen')).join('')}</div>` : ''}
    ${warns.map(w => `<div class="warn">${esc(w)}</div>`).join('')}
    ${r.offline ? '<div class="found"><b>Lookout is closed.</b><div class="sub">Skills compared with your profile from the last sync. Start Lookout to check experience, visa, and whether it already has this role.</div></div>'
      : r.onFile ? `<div class="found"><b>Lookout already has this role${r.onFile.status ? ` · ${esc(r.onFile.status)}` : ''}</b><div class="sub">Seen on ${esc(r.onFile.sources.join(', '))}${r.onFile.postedAt ? ` · posted ${ago(Date.parse(r.onFile.postedAt))}` : ''}${r.onFile.applyKind === 'direct' ? ' · Apply there opens the employer’s own listing' : ''}</div></div>`
      : '<div class="found"><b>New to Lookout</b><div class="sub">Save it to keep it in your pipeline.</div></div>'}
    ${online ? `<div class="acts">${r.onFile?.status ? '' : '<button class="primary" id="save">Save to pipeline</button>'}${r.onFile ? '<button id="open">Open in Lookout</button>' : ''}${r.board ? '<button id="watch">Watch this company</button>' : ''}</div><p class="msg" id="msg"></p>` : ''}`;
  if (!online) return;
  const msg = t => { $('#msg').textContent = t; };
  $('#save')?.addEventListener('click', async e => {
    e.target.disabled = true; msg('Saving…');
    try { const s = await call('/api/ext/save', { page }); msg(s.isNew ? 'Saved to your pipeline, and added to Lookout.' : 'Saved to your pipeline.'); r.onFile = { id: s.id }; if (!$('#open')) $('.acts').insertAdjacentHTML('beforeend', '<button id="open">Open in Lookout</button>'); $('#open').onclick = () => chrome.tabs.create({ url: `${base}/#job:${s.id}` }); e.target.remove(); }
    catch (err) { msg(err.message); e.target.disabled = false; }
  });
  $('#open')?.addEventListener('click', () => chrome.tabs.create({ url: `${base}/#job:${r.onFile.id}` }));
  $('#watch')?.addEventListener('click', async e => {
    e.target.disabled = true; msg('Checking the careers site…');
    try { const w = await call('/api/ext/watch', { url: page.url, company: role.company }); msg(w.already ? 'Lookout already watches this company.' : 'Watching. Lookout checks this company every minute.'); e.target.remove(); }
    catch (err) { msg(err.message); e.target.disabled = false; }
  });
}
