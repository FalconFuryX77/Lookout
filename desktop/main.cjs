const { app, BrowserWindow, Menu, Tray, nativeImage, Notification } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const APP_URL = 'http://127.0.0.1:4173/';
const APP_DIR = app.getAppPath();
const LOG_FILE = path.join(APP_DIR, 'lookout-desktop.log');
let mainWindow = null;
let tray = null;
let isQuitting = false;
function log(...args) { fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${args.map(x => x?.stack || String(x)).join(' ')}\n`); }

process.on('uncaughtException', error => log('uncaught exception:', error));
process.on('unhandledRejection', error => log('unhandled rejection:', error));
log('main process started', process.versions.electron || '');

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => showWindow());

function makeWindow() {
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 920,
    minWidth: 720,
    minHeight: 620,
    show: false,
    backgroundColor: '#09090b',
    title: 'Lookout',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadURL(APP_URL);
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('close', event => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      if (Notification.isSupported()) {
        new Notification({ title: 'Lookout is still running', body: 'The scanner is in the notification area. Click its icon to reopen the dashboard.' }).show();
      }
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function showWindow() {
  if (!mainWindow) makeWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function buildTray() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect x="1" y="1" width="30" height="30" rx="9" fill="#a8f0c4"/><path d="M16 6 8 14h5v11h6V14h5z" fill="#102019"/></svg>';
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
  tray = new Tray(image);
  tray.setToolTip('Lookout is scanning in the background');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Lookout', click: showWindow },
    { label: 'Scan now', click: async () => {
      try { await fetch('http://127.0.0.1:4173/api/scan', { method: 'POST' }); }
      catch (error) { if (Notification.isSupported()) new Notification({ title: 'Scan could not start', body: error.message }).show(); }
    } },
    { type: 'separator' },
    { label: 'Exit Lookout', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
}

app.whenReady().then(async () => {
  log('app ready');
  try {
    // The server uses import.meta.url for paths, so it works regardless of the login working directory.
    log('loading scanner server');
    await import(pathToFileURL(path.join(APP_DIR, 'server.mjs')).href);
    log('scanner server loaded');
  } catch (error) {
    log('scanner server failed:', error);
    if (Notification.isSupported()) new Notification({ title: 'Lookout could not start', body: error.message }).show();
    app.quit();
    return;
  }
  buildTray();
  makeWindow();

  if (process.platform === 'win32') {
    app.setLoginItemSettings({ openAtLogin: true, path: process.execPath, args: [APP_DIR], name: 'Lookout' });
  }
});

app.on('before-quit', () => { isQuitting = true; });
app.on('window-all-closed', () => { /* Closing the dashboard hides it; only the tray Exit item quits. */ });
