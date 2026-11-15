// Phone push via ntfy (ntfy.sh or self-hosted). One push per job, or a digest when a scan
// produces a burst, so the phone doesn't get 40 buzzes after adding a new source.
// Every saved view can send to the default channel (Settings) or to a channel of its own,
// so different views can go to different people.

function inQuietHours(spec) {
  const m = String(spec || '').match(/^(\d{1,2}):?(\d{2})?\s*-\s*(\d{1,2}):?(\d{2})?$/);
  if (!m) return false;
  const now = new Date(); const cur = now.getHours() * 60 + now.getMinutes();
  const a = Number(m[1]) * 60 + Number(m[2] || 0), b = Number(m[3]) * 60 + Number(m[4] || 0);
  return a <= b ? cur >= a && cur < b : cur >= a || cur < b;
}

const TOPIC = /^[A-Za-z0-9_-]{1,64}$/;
/**
 * Where a push goes. `channel` is empty (the default from Settings), a bare topic name on the
 * default server, or a full address like https://ntfy.sh/my-friend-topic.
 * Returns null when there is nowhere to send; throws on a malformed address.
 */
export function resolveChannel(settings, channel = '') {
  const defServer = String(settings.ntfyServer || 'https://ntfy.sh').trim().replace(/\/+$/, '');
  const c = String(channel || '').trim();
  let server = defServer, topic = String(settings.ntfyTopic || '').trim(), custom = false;
  if (c) {
    custom = true;
    if (/^https?:\/\//i.test(c) || /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(c)) {
      let u; try { u = new URL(/^https?:/i.test(c) ? c : `https://${c}`); } catch { throw new Error('That channel address is not a valid link'); }
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length !== 1) throw new Error('A channel address looks like https://ntfy.sh/topic-name');
      server = u.origin; topic = parts[0];
    } else topic = c;
  }
  if (!topic) return null;
  if (!TOPIC.test(topic)) throw new Error('ntfy topic may only use letters, numbers, - and _');
  // the access token belongs to the default server; never send it anywhere else
  return { server, topic, custom, token: server === defServer ? settings.ntfyToken || '' : '', label: server === defServer ? topic : `${server.replace(/^https?:\/\//, '')}/${topic}` };
}

async function push(dest, { title, body, click, tags = 'briefcase', priority = 'high', actions = [] }) {
  const headers = { 'Content-Type': 'application/json' };
  if (dest.token) headers.Authorization = `Bearer ${dest.token}`;
  const payload = { topic: dest.topic, title, message: body, tags: tags.split(','), priority: priority === 'high' ? 4 : priority === 'max' ? 5 : 3, actions };
  if (click) payload.click = click;
  const r = await fetch(dest.server, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`ntfy ${r.status} ${await r.text().catch(() => '')}`.trim());
  return { ok: true };
}

async function sendTo(dest, settings, items) {
  if (items.length > 4) {
    // Someone on a separate channel can't open this computer's Lookout, so their digest carries the links.
    const shown = items.slice(0, dest.custom ? 6 : 8);
    const lines = shown.map(({ job }) => `• ${job.company} — ${job.title}${dest.custom ? `\n  ${job.applyUrl || job.url}` : ''}`).join('\n');
    await push(dest, { title: `${items.length} new matching roles`, body: lines + (items.length > shown.length ? `\n…and ${items.length - shown.length} more` : ''), tags: 'briefcase,rotating_light', click: dest.custom ? (items[0].job.applyUrl || items[0].job.url) : settings.appUrl });
    return 1;
  }
  let sent = 0;
  for (const { job, sets } of items) {
    // How old the posting was when this was sent: if the phone shows it much later than this says, the delay is on the phone's side.
    const mins = job.precision === 'minute' && job.postedAt ? Math.max(0, Math.round((Date.now() - Date.parse(job.postedAt)) / 6e4)) : null;
    const age = mins === null ? '' : mins < 1 ? 'Posted just now' : mins < 90 ? `Posted ${mins} min ago` : `Posted ${Math.round(mins / 60)} h ago`;
    const where = [age, job.location, job.salary].filter(Boolean).join(' · ');
    const actions = [{ action: 'view', label: 'Open listing', url: job.applyUrl || job.url }];
    if (job.emails?.[0]) actions.push({ action: 'view', label: 'Email', url: `mailto:${job.emails[0]}` });
    await push(dest, {
      title: `${job.funded ? '💰 ' : ''}${job.company}: ${job.title}`.slice(0, 140),
      body: [where, `Skills: ${job.skills.slice(0, 6).map(s => s.name).join(', ') || '—'}`, `Matched: ${sets.join(', ')}`].filter(Boolean).join('\n'),
      click: job.applyUrl || job.url, actions,
      priority: job.funded || job.level === 'Intern' ? 'max' : 'high',
    });
    sent++;
  }
  return sent;
}

/**
 * items: [{ job, sets: [{ name, channel }] }]. Each job goes once to every channel that one of its
 * matching views points at. Quiet hours apply to the default channel only (they are yours, not your friends').
 */
export async function sendAlerts(settings, items) {
  const dests = new Map(); // key -> { dest, items: [{ job, sets: [names] }] }
  const errors = [];
  for (const { job, sets } of items) {
    const per = new Map();
    for (const s of sets) {
      let dest; try { dest = resolveChannel(settings, s.channel); } catch (e) { errors.push(`${s.name}: ${e.message}`); continue; }
      if (!dest) continue;
      const key = `${dest.server}/${dest.topic}`;
      if (!per.has(key)) per.set(key, { dest, names: [] });
      per.get(key).names.push(s.name);
    }
    for (const [key, { dest, names }] of per) {
      if (!dests.has(key)) dests.set(key, { dest, items: [] });
      dests.get(key).items.push({ job, sets: names });
    }
  }
  const quiet = inQuietHours(settings.quietHours);
  const defKey = (() => { try { const d = resolveChannel(settings, ''); return d && `${d.server}/${d.topic}`; } catch { return null; } })();
  let sent = 0; const channels = [];
  for (const [key, { dest, items: list }] of dests) {
    if (quiet && key === defKey) continue;
    try { sent += await sendTo(dest, settings, list); channels.push(dest.label); }
    catch (e) { errors.push(`${dest.label}: ${e.message}`); }
  }
  return { sent, channels, errors };
}

export async function testPush(settings, channel = '', viewName = '') {
  const dest = resolveChannel(settings, channel);
  if (!dest) return { skipped: 'no topic' };
  await push(dest, { title: 'Lookout is connected', body: viewName ? `New roles matching “${viewName}” will show up here.` : 'You will get a push here as soon as a matching role appears.', tags: 'white_check_mark', priority: 'default', click: dest.custom ? undefined : settings.appUrl });
  return { ok: true, channel: dest.label };
}
