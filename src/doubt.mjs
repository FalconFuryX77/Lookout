// Signs that a listing may not be a real, open position ("ghost jobs").
// Nobody outside the employer can know for sure, so these are labels with reasons, never silent deletions.
// The strongest sign, an employer taking the listing down, is handled where boards are read (server.mjs):
// those roles are removed outright. What is left here are the softer signs:
//   - it reads like a talent pool or general application, not one specific opening
//   - the employer took it down and put the same role back up later
// Being open for weeks, or the same title in several offices, is normal (a summer internship programme is
// both), so those never earn the label on their own; how long it has been open is only added as context.

// Titles of postings that are not one specific opening. "Talent Acquisition Partner" is a real job, so the
// patterns name the pool, not the word "talent".
const EVERGREEN_TITLE = new RegExp([
  String.raw`talent (?:pool|community|network|pipeline|bench|cloud)`,
  String.raw`general (?:application|interest|applications|submission)`,
  String.raw`(?:open|spontaneous|unsolicited|speculative|initiative) application`,
  String.raw`future (?:opportunit\w*|openings?|roles?|positions?|hires?|hiring|consideration|vacanc\w*)`,
  String.raw`expression of interest`, String.raw`register (?:your )?interest`,
  String.raw`always (?:hiring|accepting|looking)`,
  String.raw`(?:submit|drop|send|share|leave) (?:us )?(?:your|a) (?:resume|cv|profile)`,
  String.raw`don['’]?t see (?:a|the|your)(?: right| perfect)? (?:role|position|job|fit|match)`,
  String.raw`(?:pipeline|evergreen) (?:role|requisition|opening|posting|position)`, String.raw`\bevergreen\b`,
  String.raw`join our (?:talent|candidate) (?:pool|community|network|database)`,
].join('|'), 'i');
// The same idea said in the opening lines of the posting.
const EVERGREEN_TEXT = new RegExp([
  String.raw`this (?:is|posting is|role is|requisition is) (?:an? )?(?:evergreen|general|pipeline|talent[- ]pool|future)\b`,
  String.raw`not (?:tied|linked|attached) to (?:a|an|any) (?:specific|particular|current|open|active) (?:opening|role|position|vacancy|requisition)`,
  String.raw`(?:there is|we have|there are) no (?:current|immediate|specific) (?:opening|vacancy|vacancies|openings|role)`,
  // "...we'll keep your CV for future opportunities" closes many real postings, so only the posting saying
  // that it *is* for future openings counts
  String.raw`this (?:posting|role|position|requisition|listing|opening|vacancy) is (?:only |intended )?for (?:future|upcoming|anticipated) (?:opportunities|openings|roles|vacancies|positions|needs|hiring)`,
  String.raw`(?:add|join|keep) (?:you|your (?:resume|cv|profile|details)) (?:to|in|on) our (?:talent|candidate|applicant) (?:pool|database|community|network)`,
].join('|'), 'i');

const DAY = 864e5;
const LONG_OPEN_DAYS = 45;
const weeks = d => d >= 14 ? `${Math.round(d / 7)} weeks` : `${Math.round(d)} days`;
const shortDate = iso => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/**
 * What, if anything, makes this listing doubtful.
 * Returns undefined, or { level: 'strong'|'some', reasons: [...] }.
 */
export function assessListing(job, { now = Date.now() } = {}) {
  let strong = false; const reasons = [];
  const opening = String(job.description || job.snippet || '').slice(0, 600);
  if (EVERGREEN_TITLE.test(job.title || '') || EVERGREEN_TEXT.test(opening)) {
    strong = true; reasons.push('It reads like a talent pool or a general application, not one specific opening.');
  }
  if (job.repostOf) {
    reasons.push(`The employer took it down on ${shortDate(job.repostOf)} and posted the same role again${job.firstSeen ? ` on ${shortDate(job.firstSeen)}` : ''}.`);
  }
  if (!reasons.length) return undefined;
  // Context only: age counts where the employer's own board gives a real publish time (an "updated" date says
  // nothing), and not for internships, whose programmes stay open for months.
  const fromBoard = (job.sources || []).some(s => s.source === 'ats');
  const age = job.postedAt ? (now - Date.parse(job.postedAt)) / DAY : 0;
  if (fromBoard && job.precision === 'minute' && age >= LONG_OPEN_DAYS && job.type !== 'Internship') reasons.push(`It has been open on the employer's own site for ${weeks(age)}.`);
  return { level: strong ? 'strong' : 'some', reasons };
}

export const DOUBT_TEST = { EVERGREEN_TITLE, EVERGREEN_TEXT };
