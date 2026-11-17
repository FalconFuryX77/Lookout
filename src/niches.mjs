// Niches: which kinds of computing work companies are hiring for, and which are rising.
// Learned from the titles of the roles Lookout sees, never from a fixed list, so a niche that appears in five
// years ("neuromorphic", "agent reliability") shows up here as soon as companies start hiring for it.
// A niche is a word or two-word phrase from role titles, once the words every title has are taken out.
// It counts companies, not listings, so one company posting forty copies of a role is one vote.
//
// Rising needs history Lookout does not keep in its roles (they are pruned after 60 days), so each day's
// counts are written to a small diary (state.nicheDays, 200 days). Rising compares the last 14 days with the
// days before; until four weeks of diary exist, only the biggest niches are shown.

const DAY = 864e5;
const RECENT_DAYS = 14, KEEP_DAYS = 200, MIN_HISTORY_DAYS = 28;
// Words that say level, time, place, language or contract, or name a job without saying what it is about.
const GENERIC = new Set(`
senior sr junior jr staff principal lead leader head chief director vp vice president manager management mgr executive exec
intern internship interns co op coop apprentice apprenticeship trainee graduate grad new entry level early career student students working
i ii iii iv v 1 2 3 4 5 l1 l2 l3 l4 l5 sde sde1 sde2 swe
engineer engineers engineering developer developers development dev programmer specialist associate consultant expert professional member
analyst scientist researcher research architect administrator admin technician officer partner representative assistant coordinator designer
software applied general generalist founding founder team technical technology technologies tech solutions solution services service systems system
summer fall winter spring autumn 2024 2025 2026 2027 2028 2029 2030 year years month months week weeks
remote hybrid onsite on site office full part time contract contractor temporary temp permanent freelance freelancer
global international us usa uk eu emea apac latam india europe americas north south east west region regional
the of and for in at with a an to on by or from as via plus our your new
m f d w x h mfd fmd mwd wmd all genders gender
opportunity opportunities role roles position positions job jobs hiring open program programme pool talent
de la le les des du en et und für fur der die das el los las con développeur developpeur entwickler entwicklerin desarrollador sviluppatore ingénieur ingenieur ingeniero ingenieurin stage stagiaire alternance alternant praktikum praktikant werkstudent werkstudentin pasante becario tirocinio estagio estágio
`.split(/\s+/).filter(Boolean));
// Broad areas: shown among the biggest, but too wide to call a niche that is rising.
const BROAD = new Set(['ai', 'data', 'product', 'platform', 'security', 'infrastructure', 'backend', 'frontend', 'full-stack', 'mobile', 'web', 'cloud', 'analytics', 'machine learning', 'devops', 'qa', 'it', 'support', 'operations', 'business', 'marketing', 'sales', 'design']);
// Spellings of the same thing.
const SAME = [
  [/\bfull[\s-]?stack\b/g, 'full-stack'], [/\bfront[\s-]?end\b/g, 'frontend'], [/\bback[\s-]?end\b/g, 'backend'], [/\bdev[\s-]?ops\b/g, 'devops'],
  [/\bartificial intelligence\b/g, 'ai'], [/\bml\b/g, 'machine learning'], [/\bgen[\s-]?ai\b/g, 'generative ai'], [/\bllms\b/g, 'llm'],
  [/\.net\b/g, ' dotnet'], [/\bc\+\+/g, 'cpp'], [/\bc#/g, 'csharp'], [/\bnode\.?js\b/g, 'node'], [/\breact\.?js\b/g, 'react'], [/\bk8s\b/g, 'kubernetes'],
  [/\bsite reliability\b/g, 'sre'], [/\bforward[\s-]deployed\b/g, 'forward-deployed'], [/\bquality assurance\b/g, 'qa'],
];

/** The niche words and phrases in one title. */
export function phrases(title = '') {
  let t = String(title).toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/&/g, ' and ');
  for (const [re, to] of SAME) t = t.replace(re, to);
  t = t.replace(/[–—|/,:;]+/g, ' , ');
  const out = new Set();
  for (const part of t.split(' , ')) {
    const words = part.match(/\p{L}[\p{L}\p{N}+#.-]*[\p{L}\p{N}+#]|\p{L}/gu) || [];
    const kept = words.filter(w => w.length > 1 && !GENERIC.has(w) && !/^\d+$/.test(w));
    for (let i = 0; i < kept.length; i++) {
      out.add(kept[i]);
      if (i + 1 < kept.length) out.add(`${kept[i]} ${kept[i + 1]}`);
    }
  }
  return [...out];
}

const coKey = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const dayOf = t => new Date(t).toISOString().slice(0, 10);

/**
 * Write today's (and any missing recent days') counts into the diary from the roles on file.
 * `days` is state.nicheDays: { 'YYYY-MM-DD': { phrase: companies } }. Mutates and returns it.
 */
export function recordNicheDays(jobs, days = {}, now = Date.now()) {
  const byDay = new Map();
  for (const j of jobs) {
    if (j.cs === false) continue;
    const t = Date.parse(j.firstSeen || j.postedAt); if (!(t > now - 3 * DAY)) continue; // only days Lookout watched itself
    const d = dayOf(t); let m = byDay.get(d); if (!m) byDay.set(d, m = new Map());
    for (const ph of phrases(j.title)) { let s = m.get(ph); if (!s) m.set(ph, s = new Set()); s.add(coKey(j.company)); }
  }
  for (const [d, m] of byDay) days[d] = Object.fromEntries([...m].filter(([, s]) => s.size >= 1).map(([ph, s]) => [ph, s.size]));
  for (const d of Object.keys(days)) if (Date.parse(d) < now - KEEP_DAYS * DAY) delete days[d];
  return days;
}

/**
 * Niches now. Biggest: the most companies hiring for it among computing roles posted in the last 14 days.
 * Rising: companies per day in the last 14 days of the diary against the days before (once there are enough).
 * Returns { biggest, rising, historyDays, windowDays }, items { phrase, companies, before, growth, new }.
 */
export function findNiches(jobs, days = {}, { now = Date.now(), limit = 12 } = {}) {
  const recent = new Map(), count = new Map();
  for (const j of jobs) {
    if (j.cs === false || j.closedAt) continue;
    const t = Date.parse(j.postedAt || j.firstSeen); if (!(t > now - RECENT_DAYS * DAY)) continue;
    for (const ph of phrases(j.title)) { let s = recent.get(ph); if (!s) recent.set(ph, s = new Set()); s.add(coKey(j.company)); count.set(ph, (count.get(ph) || 0) + 1); }
  }
  let biggest = [...recent].map(([phrase, s]) => ({ phrase, companies: s.size, roles: count.get(phrase) })).filter(x => x.companies >= 4);
  biggest = dropContained(biggest).sort((a, b) => b.companies - a.companies).slice(0, limit);

  const dates = Object.keys(days).sort(); const historyDays = dates.length;
  let rising = [];
  if (historyDays >= MIN_HISTORY_DAYS) {
    const cut = dayOf(now - RECENT_DAYS * DAY);
    const recentDays = dates.filter(d => d > cut), earlierDays = dates.filter(d => d <= cut);
    const sum = (ds, ph) => ds.reduce((a, d) => a + (days[d][ph] || 0), 0);
    const seen = new Set(recentDays.flatMap(d => Object.keys(days[d])));
    for (const phrase of seen) {
      if (BROAD.has(phrase)) continue;
      const now14 = sum(recentDays, phrase); if (now14 < 5) continue;
      const before = sum(earlierDays, phrase) / Math.max(1, earlierDays.length) * recentDays.length;
      const growth = (now14 + 1) / (before + 1);
      if (growth >= 1.5) rising.push({ phrase, companies: now14, before: Math.round(before * 10) / 10, growth: Math.round(growth * 10) / 10, new: before < 0.5 });
    }
    rising = dropContained(rising).sort((a, b) => b.growth - a.growth || b.companies - a.companies).slice(0, limit);
  }
  return { biggest, rising, historyDays, needDays: MIN_HISTORY_DAYS, windowDays: RECENT_DAYS };
}
// A single word that mostly appears inside one two-word phrase is that phrase ("learning" in "machine learning").
function dropContained(list) {
  return list.filter(x => {
    if (x.phrase.includes(' ')) return true;
    return !list.some(y => y.phrase.includes(' ') && y.phrase.split(' ').includes(x.phrase) && y.companies >= x.companies * 0.7);
  });
}
