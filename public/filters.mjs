// Shared by the browser UI and the server's alert matcher, so a saved filter set
// behaves identically in the list and in phone alerts.

export const AGE_MS = { '15m': 9e5, '1h': 36e5, '6h': 216e5, '24h': 864e5, '3d': 2592e5, '7d': 6048e5, '30d': 2592e6, all: Infinity };

export const EMPTY_FILTERS = { q: '', types: [], levels: [], countries: [], categories: [], skills: [], age: 'all', remoteOnly: false, fundedOnly: false, sources: [], hasContact: false, hideTracked: false };

/** Age used for filtering/sorting: posting time if the source gave one, else when we first saw it. */
export function effectiveTime(job) {
  const p = Date.parse(job.postedAt || '');
  const f = Date.parse(job.firstSeen || '');
  if (Number.isFinite(p) && job.precision === 'minute') return p;
  if (Number.isFinite(p)) return Math.min(Number.isFinite(f) ? f : p, p + 864e5 - 1); // date-only: assume end of day at most
  return f;
}

export function matches(job, f, ctx = {}) {
  f = { ...EMPTY_FILTERS, ...f };
  const now = ctx.now || Date.now();
  if (f.age && f.age !== 'all') {
    const t = effectiveTime(job);
    if (!Number.isFinite(t) || now - t > AGE_MS[f.age]) return false;
    // Short windows require a source timestamp with time-of-day, or a fresh first sighting.
    if (AGE_MS[f.age] <= 216e5 && job.precision !== 'minute' && now - Date.parse(job.firstSeen) > AGE_MS[f.age]) return false;
  }
  if (f.types.length && !f.types.includes(job.type)) return false;
  if (f.levels.length && !f.levels.includes(job.level)) return false;
  if (f.categories.length && !f.categories.includes(job.category)) return false;
  if (f.countries.length) {
    const ok = f.countries.includes(job.country) || (f.countries.includes('Remote (global)') && job.remote && (job.country === 'Remote (global)' || job.country === 'Unknown'));
    if (!ok) return false;
  }
  if (f.remoteOnly && !job.remote) return false;
  if (f.fundedOnly && !job.funded) return false;
  if (f.hasContact && !(job.emails?.length || job.contactCount)) return false;
  if (f.sources.length && !job.sources.some(s => f.sources.includes(s.source))) return false;
  if (f.skills.length) {
    const have = new Set(job.skills.map(s => s.name.toLowerCase()));
    if (!f.skills.some(s => have.has(s.toLowerCase()))) return false;
  }
  if (f.hideTracked && ctx.tracking?.[job.id]) return false;
  if (ctx.tracking?.[job.id]?.status === 'hidden' && !f.showHidden) return false;
  if (f.q) {
    const hay = `${job.title} ${job.company} ${job.location} ${job.skills.map(s => s.name).join(' ')} ${job.description?.slice(0, 3000) || ''}`.toLowerCase();
    // space = AND, "a | b" = OR, -term = NOT
    for (const clause of f.q.toLowerCase().split(/\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/).filter(Boolean)) {
      if (clause.startsWith('-') && clause.length > 1) { if (hay.includes(clause.slice(1).replace(/"/g, ''))) return false; continue; }
      const alts = clause.split('|').map(x => x.replace(/"/g, '')).filter(Boolean);
      if (alts.length && !alts.some(a => hay.includes(a))) return false;
    }
  }
  return true;
}

/** Relevance score used for "Best match" sorting. Higher = more actionable. */
export function score(job, profileSkills = [], now = Date.now()) {
  let s = 0;
  const ageH = (now - effectiveTime(job)) / 36e5;
  s += Math.max(0, 40 - Math.log2(1 + Math.max(0, ageH)) * 6);        // freshness
  if (job.funded) s += 15;                                             // recently funded company
  if (job.level === 'Intern' || job.level === 'Entry') s += 8;
  if (job.emails?.length || job.contactCount) s += 6;                  // reachable
  s += Math.min(6, (job.sources?.length || 1) - 1) * 2;               // corroborated by several sources
  if (profileSkills.length) {
    const have = new Set(job.skills.map(x => x.name.toLowerCase()));
    const hit = profileSkills.filter(x => have.has(x.toLowerCase())).length;
    s += Math.min(25, hit * 6);
  }
  return s;
}
