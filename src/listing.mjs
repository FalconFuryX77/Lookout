// Noticing roles that disappear from an employer's own careers board.
// A board that hands over every open role at once (Greenhouse, Lever, Ashby, Workable, Recruitee, YC, and
// SmartRecruiters when it fits in one page) tells us exactly what is still open. A role missing from it has
// been taken down, unless the answer was a glitch, so a role counts as gone only when it is missing on reads
// at least CLOSE_AFTER apart. Most of a board vanishing at once looks more like an outage than a hiring
// freeze, so that waits CLOSE_AFTER_BULK.

export const CLOSE_AFTER = 20 * 60e3;
export const CLOSE_AFTER_BULK = 3 * 36e5;
const MAX_MISSING = 500;

/**
 * Update a board's record with what it lists now and say which links have now been gone long enough.
 * `urls` is the set of canonical links the board lists on this read, or null when the board answered
 * "unchanged" (then only overdue removals are settled). Mutates `b.listed` and `b.missing`.
 * Returns { present: Set, close: [links] }.
 */
export function diffListing(b, urls, now = Date.now()) {
  const before = new Set(b.listed || []);
  const present = urls || before;
  const missing = b.missing ||= {};
  if (urls) {
    const gone = [...before].filter(u => !present.has(u));
    const bulk = before.size >= 4 && gone.length > before.size / 2;
    for (const u of gone) missing[u] ||= [now, bulk ? 1 : 0];
    b.listed = [...present];
  }
  const close = [];
  for (const u of Object.keys(missing)) {
    if (present.has(u)) { delete missing[u]; continue; }   // back again: it was only a glitch or a pause
    const [at, bulk] = missing[u];
    if (now - at >= (bulk ? CLOSE_AFTER_BULK : CLOSE_AFTER)) { close.push(u); delete missing[u]; }
  }
  const keys = Object.keys(missing);
  if (keys.length > MAX_MISSING) for (const u of keys.slice(0, keys.length - MAX_MISSING)) delete missing[u];
  return { present, close };
}
