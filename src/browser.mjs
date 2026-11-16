// Reading pages that only fill in after their JavaScript runs (most React / Next.js portfolios, Kaggle,
// LeetCode...). A plain download of those returns an empty shell, so Lookout borrows a browser that is
// already installed, runs it headless (no window) with a throwaway profile, reads the page, and closes it.
//
// Which browser: the one you set in Settings, else your default browser, else the first one found of
// Chrome, Edge, Brave, Vivaldi, Chromium, Opera. They all speak the same remote-control protocol (CDP).
// Firefox is found but not used yet: it speaks a different protocol (WebDriver BiDi).
//
// It is driven over a private pipe (--remote-debugging-pipe), not a network port, so nothing else on this
// computer can connect to it, and it needs no WebSocket support from Node.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KNOWN = [
  // id, name, engine, Windows exe, Windows install paths (relative to Program Files / LocalAppData), mac app, linux commands, Windows ProgId prefixes
  { id: 'chrome', name: 'Google Chrome', engine: 'chromium', exe: 'chrome.exe', win: ['Google/Chrome/Application/chrome.exe'], mac: 'Google Chrome.app/Contents/MacOS/Google Chrome', linux: ['google-chrome', 'google-chrome-stable'], prog: ['ChromeHTML'] },
  { id: 'edge', name: 'Microsoft Edge', engine: 'chromium', exe: 'msedge.exe', win: ['Microsoft/Edge/Application/msedge.exe'], mac: 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge', linux: ['microsoft-edge', 'microsoft-edge-stable'], prog: ['MSEdgeHTM', 'MSEdgeBHTML', 'MSEdgeDHTML'] },
  { id: 'brave', name: 'Brave', engine: 'chromium', exe: 'brave.exe', win: ['BraveSoftware/Brave-Browser/Application/brave.exe'], mac: 'Brave Browser.app/Contents/MacOS/Brave Browser', linux: ['brave-browser', 'brave'], prog: ['BraveHTML', 'BraveBHTML'] },
  { id: 'vivaldi', name: 'Vivaldi', engine: 'chromium', exe: 'vivaldi.exe', win: ['Vivaldi/Application/vivaldi.exe'], mac: 'Vivaldi.app/Contents/MacOS/Vivaldi', linux: ['vivaldi', 'vivaldi-stable'], prog: ['VivaldiHTM'] },
  { id: 'chromium', name: 'Chromium', engine: 'chromium', exe: 'chromium.exe', win: ['Chromium/Application/chrome.exe'], mac: 'Chromium.app/Contents/MacOS/Chromium', linux: ['chromium', 'chromium-browser'], prog: ['ChromiumHTM'] },
  // Opera starts through a launcher that may not pass on "headless" and could open a window: used only when picked by hand
  { id: 'opera', name: 'Opera', engine: 'chromium', manualOnly: true, exe: 'opera.exe', win: ['Programs/Opera/opera.exe', 'Programs/Opera GX/opera.exe', 'Opera/opera.exe'], mac: 'Opera.app/Contents/MacOS/Opera', linux: ['opera'], prog: ['OperaStable', 'OperaGXStable'] },
  { id: 'firefox', name: 'Firefox', engine: 'firefox', exe: 'firefox.exe', win: ['Mozilla Firefox/firefox.exe'], mac: 'Firefox.app/Contents/MacOS/firefox', linux: ['firefox'], prog: ['FirefoxURL', 'FirefoxHTML'] },
];
const run = (cmd, args) => new Promise(res => execFile(cmd, args, { windowsHide: true, timeout: 8000 }, (e, out) => res(e ? '' : String(out))));
const exists = f => { try { return !!f && fs.statSync(f).isFile(); } catch { return false; } };

let found = null; // cached for the life of the process; findBrowsers({ again: true }) looks again
/** Browsers installed on this computer, the default one first. [{ id, name, engine, path, isDefault, usable }] */
export async function findBrowsers({ again = false } = {}) {
  if (found && !again) return found;
  const out = []; const add = (b, p) => { if (exists(p) && !out.some(x => x.path.toLowerCase() === p.toLowerCase())) out.push({ id: b.id, name: b.name, engine: b.engine, path: p, isDefault: false, usable: b.engine === 'chromium', auto: b.engine === 'chromium' && !b.manualOnly }); };
  let defaultId = '';
  if (process.platform === 'win32') {
    const prog = (await run('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', '/v', 'ProgId'])).match(/ProgId\s+REG_SZ\s+(\S+)/)?.[1] || '';
    defaultId = KNOWN.find(b => b.prog.some(p => prog.startsWith(p)))?.id || '';
    const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean);
    for (const b of KNOWN) {
      for (const hive of ['HKCU', 'HKLM']) { const v = (await run('reg', ['query', `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${b.exe}`, '/ve'])).match(/REG_SZ\s+(.+)/)?.[1]?.trim().replace(/^"|"$/g, ''); if (v) add(b, v); }
      for (const r of roots) for (const rel of b.win) add(b, path.join(r, rel));
    }
  } else if (process.platform === 'darwin') {
    for (const b of KNOWN) for (const dir of ['/Applications', path.join(os.homedir(), 'Applications')]) add(b, path.join(dir, b.mac));
  } else {
    for (const b of KNOWN) for (const c of b.linux) { const p = (await run('which', [c])).trim(); if (p) add(b, p); }
    const d = (await run('xdg-settings', ['get', 'default-web-browser'])).toLowerCase();
    defaultId = KNOWN.find(b => d.includes(b.id) || (b.id === 'chrome' && d.includes('google-chrome')))?.id || '';
  }
  for (const b of out) b.isDefault = b.id === defaultId;
  const order = KNOWN.map(b => b.id);
  found = out.sort((a, b) => (b.isDefault - a.isDefault) || (b.usable - a.usable) || order.indexOf(a.id) - order.indexOf(b.id));
  return found;
}

/** The browser to use: the one picked in Settings ('auto', an id, a path, or 'none'), else the best one found. */
export async function pickBrowser(choice = 'auto') {
  if (choice === 'none') return null;
  const list = await findBrowsers();
  if (choice && choice !== 'auto') {
    const byId = list.find(b => b.id === choice && b.usable); if (byId) return byId;
    if (exists(choice)) return { id: 'custom', name: path.basename(choice), engine: /firefox/i.test(choice) ? 'firefox' : 'chromium', path: choice, isDefault: false, usable: !/firefox/i.test(choice) };
  }
  return list.find(b => b.auto) || null;
}

const BLOCK = ['*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.avif', '*.svg', '*.ico', '*.mp4', '*.webm', '*.mp3', '*.woff', '*.woff2', '*.ttf', '*.otf', '*google-analytics.com*', '*googletagmanager.com*', '*doubleclick.net*', '*hotjar.com*', '*facebook.net*'];

/**
 * Starts the browser headless and returns { name, read(url), close() }. read() gives back what the page shows
 * once its scripts have run: { url, title, text, links: [{ href, text }], meta, jsonld, scripts, generator }.
 */
export async function openBrowser(browser, { log = () => { } } = {}) {
  if (!browser?.usable) throw new Error('No browser that Lookout can drive was found.');
  // throwaway profiles from earlier runs that the browser was still holding when they were deleted
  try { for (const d of fs.readdirSync(os.tmpdir())) if (d.startsWith('lookout-reader-')) { const full = path.join(os.tmpdir(), d); if (Date.now() - fs.statSync(full).mtimeMs > 36e5) fs.rmSync(full, { recursive: true, force: true }); } } catch { }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lookout-reader-'));
  const args = ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--disable-client-side-phishing-detection', '--mute-audio', '--hide-scrollbars', '--window-size=1366,900', '--no-service-autorun', '--password-store=basic', '--disable-features=Translate,MediaRouter,OptimizationHints,msEdgeSidebarV2,msUndersideButton,msHubApps,msEdgeWelcomePage', 'about:blank'];
  const child = spawn(browser.path, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], windowsHide: true });
  let stderr = ''; child.stderr.on('data', d => { if (stderr.length < 4000) stderr += d; });
  const toBrowser = child.stdio[3], fromBrowser = child.stdio[4];
  let id = 0; const pend = new Map(); const listeners = new Set(); let buf = ''; let dead = null;
  fromBrowser.on('data', chunk => {
    buf += chunk.toString('utf8'); let i;
    while ((i = buf.indexOf('\0')) >= 0) {
      const raw = buf.slice(0, i); buf = buf.slice(i + 1); let m; try { m = JSON.parse(raw); } catch { continue; }
      if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.bad(new Error(m.error.message)) : p.ok(m.result); }
      else if (m.method) for (const f of listeners) f(m);
    }
  });
  const fail = e => { dead = e; for (const p of pend.values()) p.bad(e); pend.clear(); };
  child.on('error', e => fail(new Error(`${browser.name} could not start (${e.message}).`)));
  child.on('exit', code => fail(new Error(`${browser.name} closed (code ${code}). ${stderr.split('\n').find(l => /error/i.test(l)) || ''}`.trim())));
  toBrowser.on('error', () => { });
  const send = (method, params = {}, sessionId, timeout = 20000) => new Promise((ok, bad) => {
    if (dead) return bad(dead);
    const n = ++id; const t = setTimeout(() => { if (pend.delete(n)) bad(new Error(`${method} timed out`)); }, timeout);
    pend.set(n, { ok: v => { clearTimeout(t); ok(v); }, bad: e => { clearTimeout(t); bad(e); } });
    toBrowser.write(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
  const close = async () => {
    try { await send('Browser.close', {}, undefined, 3000); } catch { }
    try { child.kill(); } catch { }
    setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { } }, 1500);
  };
  try { await send('Browser.getVersion', {}, undefined, 15000); }
  catch (e) { await close(); throw new Error(`${browser.name} would not start headless: ${e.message}`); }
  await send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => { });

  async function read(url, { settleMs = 900, maxWaitMs = 12000 } = {}) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const s = (m, p, t) => send(m, p, sessionId, t);
    let loaded = false; const onEv = m => { if (m.sessionId !== sessionId) return; if (m.method === 'Page.loadEventFired') loaded = true; if (m.method === 'Page.javascriptDialogOpening') s('Page.handleJavaScriptDialog', { accept: false }).catch(() => { }); };
    listeners.add(onEv);
    try {
      await s('Page.enable'); await s('Network.enable'); await s('Network.setBlockedURLs', { urls: BLOCK }).catch(() => { });
      await s('Page.navigate', { url }, 25000);
      const t0 = Date.now(); while (!loaded && Date.now() - t0 < maxWaitMs) await new Promise(r => setTimeout(r, 150));
      // wait for the text to stop changing (single-page apps fill in after "load")
      let last = -1, stableSince = Date.now();
      while (Date.now() - t0 < maxWaitMs) {
        const n = await s('Runtime.evaluate', { expression: 'document.body ? document.body.innerText.length : 0', returnByValue: true }).then(r => r.result.value).catch(() => 0);
        if (n !== last) { last = n; stableSince = Date.now(); } else if (Date.now() - stableSince >= settleMs && n > 0) break;
        await new Promise(r => setTimeout(r, 250));
      }
      const r = await s('Runtime.evaluate', { returnByValue: true, expression: `(() => {
        const meta = {}; for (const m of document.querySelectorAll('meta[name], meta[property]')) meta[(m.getAttribute('name') || m.getAttribute('property')).toLowerCase()] = (m.content || '').slice(0, 500);
        const links = [...document.querySelectorAll('a[href]')].slice(0, 800).map(a => ({ href: a.href, text: (a.innerText || a.title || '').replace(/\\s+/g, ' ').trim().slice(0, 120) })).filter(l => /^https?:/.test(l.href));
        const jsonld = [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => s.textContent.slice(0, 20000));
        const scripts = [...document.scripts].map(s => s.src).filter(Boolean).slice(0, 80);
        return { url: location.href, title: document.title, text: (document.body ? document.body.innerText : '').slice(0, 200000), links, meta, jsonld, scripts, generator: meta.generator || '' };
      })()` });
      return r.result.value;
    } finally {
      listeners.delete(onEv);
      await send('Target.closeTarget', { targetId }).catch(() => { });
    }
  }
  log(`reader: started ${browser.name} headless`);
  return { name: browser.name, read, close };
}
