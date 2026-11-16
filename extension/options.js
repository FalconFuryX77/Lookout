const f = document.querySelector('#form'); const msg = t => { document.querySelector('#msg').textContent = t; };
const saved = await chrome.storage.local.get({ port: 4173, key: '' });
f.key.value = saved.key; f.port.value = saved.port;
f.onsubmit = async e => {
  e.preventDefault();
  const key = f.key.value.trim(), port = Number(f.port.value) || 4173;
  await chrome.storage.local.set({ key, port });
  msg('Testing…');
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/ext/hello`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    if (d.app !== 'lookout') return msg('Something else is answering on that port.');
    if (!d.paired) return msg('Lookout is running, but that key doesn’t match. Copy it again from Lookout → Settings → Browser extension.');
    await chrome.storage.local.set({ profile: d.profile, profileAt: Date.now() });
    msg(`Paired with Lookout (${d.profile.label}, ${d.profile.skills.length} skills). You can close this page.`);
  } catch { msg(`Lookout isn’t answering on port ${port}. Start it, then try again.`); }
};
