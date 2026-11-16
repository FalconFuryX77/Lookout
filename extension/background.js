// Marks the toolbar icon with a small dot on profile pages of the sites in profiles.js, so you know the
// Lookout button can pick up skills there. This uses the browser's own page rules (declarativeContent):
// the browser matches the address itself and never tells the extension which pages you visit.
import { PROFILE_SITES } from './profiles.js';

async function dotted(size) {
  const blob = await (await fetch(chrome.runtime.getURL(`icons/${size}.png`))).blob();
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(size, size); const g = c.getContext('2d');
  g.drawImage(bmp, 0, 0, size, size);
  const r = Math.max(2.5, size * 0.2), x = size - r - 0.5, y = size - r - 0.5;
  g.beginPath(); g.arc(x, y, r + Math.max(1, size * 0.06), 0, Math.PI * 2); g.fillStyle = '#0b0b0e'; g.fill();
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = '#c6f432'; g.fill();
  return g.getImageData(0, 0, size, size);
}
async function install() {
  try {
    const imageData = { 16: await dotted(16), 32: await dotted(32) };
    await chrome.declarativeContent.onPageChanged.removeRules(undefined);
    await chrome.declarativeContent.onPageChanged.addRules([{
      conditions: PROFILE_SITES.map(s => new chrome.declarativeContent.PageStateMatcher({ pageUrl: { urlMatches: s.rule } })),
      actions: [new chrome.declarativeContent.SetIcon({ imageData })],
    }]);
  } catch (e) { console.warn('Lookout: could not set up the profile-page dot:', e?.message || e); }
}
chrome.runtime.onInstalled.addListener(install);
chrome.runtime.onStartup.addListener(install);
