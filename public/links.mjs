// How direct a link is: the employer's own listing, one honest click away, an unknown site, or a job board's copy.
// Shared by the scanner (which link Apply opens) and the app (telling you before you click).
const host = u => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
// The employer's own applicant system: applying here goes straight to the hiring team.
const DIRECT = /(^|\.)(applytojob\.com|jibeapply\.com|avature\.net|myworkdaysite\.com|paylocity\.com|hibob\.com|ultipro\.com|dayforcehcm\.com|csod\.com|homerun\.co|join\.com|factorialhr\.com|greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|recruitee\.com|myworkdayjobs\.com|icims\.com|rippling\.com|bamboohr\.com|teamtailor\.com|personio\.(?:com|de)|breezy\.hr|jobvite\.com|eightfold\.ai|oraclecloud\.com|successfactors\.(?:com|eu)|taleo\.net|pinpointhq\.com|gem\.com|dover\.com|notion\.site|keka\.com|darwinbox\.in|zohorecruit\.(?:com|in)|freshteam\.com)$/;
// Listings that are one click from the employer and ask for nothing themselves.
const NEAR = /(^|\.)(ycombinator\.com|workatastartup\.com|news\.ycombinator\.com)$/;
// Boards and link shorteners: a copy of the listing, not the listing.
const AGGREGATOR = /(^|\.)(linkedin\.com|himalayas\.app|jobicy\.com|arbeitnow\.[a-z.]+|remoteok\.com|weworkremotely\.com|startup\.jobs|indeed\.com|glassdoor\.[a-z.]+|naukri\.com|wellfound\.com|simplify\.jobs|vansh\.nyc|bit\.ly|lnkd\.in|jobs\.gem\.com|ziprecruiter\.com|monster\.com|foundit\.in|internshala\.com|unstop\.com|cutshort\.io|instahyre\.com|hirist\.tech|jooble\.org|talent\.com|adzuna\.[a-z.]+|remotive\.com|workingnomads\.com|dailyremote\.com|builtin\.com|otta\.com|welcometothejungle\.com)$/;
const squash = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const GENERIC_CO = /^(startup|company|stealth|confidential|unknown|hiring|careers?|jobs?)$/;
/**
 * 3 = the employer's own listing, 2 = one honest click away, 1 = unknown site, 0 = a board's copy.
 * With the company's name, a site named after it ("metacareers.com", "jobs.l3harris.com") counts as the employer's own.
 */
export function linkRank(url, company = '') {
  const h = host(url); if (!h) return -1;
  if (DIRECT.test(h)) return 3;
  if (AGGREGATOR.test(h)) return 0;
  if (/^(careers?|jobs|apply|work|join|hiring)\./.test(h)) return 3;
  const c = squash(String(company).replace(/\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|plc|technologies|technology|labs?|group|holdings|the)\b/gi, ''));
  if (c.length >= 3 && !GENERIC_CO.test(c) && squash(h).includes(c)) return 3;
  if (NEAR.test(h)) return 2;
  return 1;
}
/** The most direct of a record's links; ties keep the earlier one. */
export function bestLink(urls = [], company = '') { let best = '', r = -2; for (const u of urls) { const k = linkRank(u, company); if (u && k > r) { best = u; r = k; } } return best; }

// Link shorteners and tracking redirectors: one hop that only forwards you somewhere else.
const SHORTENER = /(^|\.)(vansh\.nyc|bit\.ly|lnkd\.in|tinyurl\.com|t\.co|rb\.gy|cutt\.ly|buff\.ly|ow\.ly|is\.gd|shorturl\.at|rebrand\.ly|short\.io|tiny\.cc|s\.id|t\.ly|bl\.ink|surl\.li|shorturl\.gg)$/;
export const isShortLink = url => SHORTENER.test(host(url));
