// Phone push via ntfy (ntfy.sh or self-hosted). One push per job, or a digest when a scan
// produces a burst, so the phone doesn't get 40 buzzes after adding a new source.

function inQuietHours(spec) {
  const m = String(spec || '').match(/^(\d{1,2}):?(\d{2})?\s*-\s*(\d{1,2}):?(\d{2})?$/);
  if (!m) return false;
  const now = new Date(); const cur = now.getHours() * 60 + now.getMinutes();
  const a = Number(m[1]) * 60 + Number(m[2] || 0), b = Number(m[3]) * 60 + Number(m[4] || 0);
  return a <= b ? cur >= a && cur < b : cur >= a || cur < b;
}

async function push(settings, { title, body, click, tags = 'briefcase', priority = 'high', actions = [] }) {
  const topic = String(settings.ntfyTopic || '').trim();
  if (!topic) return { skipped: 'no topic' };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(topic)) throw new Error('ntfy topic may only use letters, numbers, - and _');
  const server = String(settings.ntfyServer || 'https://ntfy.sh').replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (settings.ntfyToken) headers.Authorization = `Bearer ${settings.ntfyToken}`;
  const payload = { topic, title, message: body, tags: tags.split(','), priority: priority === 'high' ? 4 : priority === 'max' ? 5 : 3, click, actions };
  const r = await fetch(server, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`ntfy ${r.status} ${await r.text().catch(() => '')}`.trim());
  return { ok: true };
}

export async function sendAlerts(settings, items) {
  // items: [{ job, sets: [filterSetName] }]
  if (!items.length || inQuietHours(settings.quietHours)) return { sent: 0 };
  if (items.length > 4) {
    const lines = items.slice(0, 8).map(({ job }) => `• ${job.company} — ${job.title}`).join('\n');
    await push(settings, { title: `${items.length} new matching roles`, body: lines + (items.length > 8 ? `\n…and ${items.length - 8} more` : ''), tags: 'briefcase,rotating_light', click: settings.appUrl });
    return { sent: 1 };
  }
  let sent = 0;
  for (const { job, sets } of items) {
    const where = [job.location, job.salary].filter(Boolean).join(' · ');
    const actions = [{ action: 'view', label: 'Open listing', url: job.applyUrl || job.url }];
    if (job.emails?.[0]) actions.push({ action: 'view', label: 'Email', url: `mailto:${job.emails[0]}` });
    await push(settings, {
      title: `${job.funded ? '💰 ' : ''}${job.company}: ${job.title}`.slice(0, 140),
      body: [where, `Skills: ${job.skills.slice(0, 6).map(s => s.name).join(', ') || '—'}`, `Matched: ${sets.join(', ')}`].filter(Boolean).join('\n'),
      click: job.applyUrl || job.url, actions,
      priority: job.funded || job.level === 'Intern' ? 'max' : 'high',
    });
    sent++;
  }
  return { sent };
}

export async function testPush(settings) {
  return push(settings, { title: 'Lookout is connected', body: 'You will get a push here as soon as a matching role appears.', tags: 'white_check_mark', priority: 'default', click: settings.appUrl });
}
