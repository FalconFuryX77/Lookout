// Turns raw postings into structured, filterable records: skills, requirements, role type,
// seniority, specialty/field, country, remote flag, salary, visa, years, pay.
import { deepAttributes, payOf } from './taxonomy.mjs';
import { extractSkills, requirementLines } from '../public/skills.mjs';
// skill and requirement reading live with the shared skill vocabulary, so the browser extension uses the same code
export { extractSkills, requirementLines };

/** Keep a pay string only if it parses as pay (or is clearly an Indian CTC/stipend we can't normalize). */
export function cleanSalary(s, type) {
  if (!s) return '';
  const t = String(s).trim().slice(0, 80);
  if (payOf(t, type === 'Internship')) return t;
  return /\d/.test(t) && /(lpa|lakh|crore|₹|ctc)/i.test(t) ? t : '';
}

// Student roles in the languages our sources actually post in (German, French, Dutch, Portuguese, Spanish).
const INTERN_TITLE = /\b(?:interns?|internships?|intership|co-?op|working student|summer (?:analyst|associate|student)|industrial training|student (?:researcher|developer|engineer|assistant|worker)|stagiaire|estagi[aá]ri[oa]|est[aá]gio|pasant[ií]a|becari[oa])\b|\bwerkstudent|\bpraktik(?:um|ant)|\b(?:meewerk|afstudeer)stage\b|^\s*stage\b(?! manager)|\bstage (?:de |en |-|–|:|\()/i;
const APPRENTICE_TITLE = /\b(?:apprentice(?:ship)?|trainee|jovem aprendiz|alternance|alternant(?:e)?|ausbildung|auszubildende[rn]?|azubi)\b/i;
// Titles that are plainly not student roles, whatever a source's "type" field claims.
const SENIOR_PLUS_TITLE = /\b(?:principal|distinguished|(?<!technical |of |chief of )staff(?! accountant| nurse| auditor| attorney| writer| assistant| member)|director|head(?: of\b|,| -)|s?vp|evp|vice president|chief(?! of staff (?:associate|intern))|president|lead(?! gen)|architect|senior manager|engineering manager|manager,? (?:of )?engineering)\b|^\s*(?:co-?founder\b|c[etfopm]o\b(?!'s| office))/i;
const SENIOR_TITLE = /\b(?:senior|sr\.?|expert|iii|iv|(?:engineer|developer|analyst|scientist|designer|specialist) (?:3|4|5))\b/i;
const MID_TITLE = /\bmid[- ]level\b|\b(?:engineer|developer|analyst|scientist|designer|specialist) (?:ii|2)\b/i;
const ENTRY_TITLE = /\b(?:new grad(?:uate)?s?|graduate|entry[- ]level|junior|jr\.?|fresher|early[- ]career|university grad(?:uate)?|campus hire|associate (?:software |product |data |ml |ai )?(?:engineer|developer|product manager|analyst|consultant|designer|scientist)|(?:engineer|developer|analyst|scientist|designer) (?:i|1))\b/i;

export function inferType(title = '', hint = '', text = '') {
  const t = String(title), h = String(hint || '').toLowerCase(), head = String(text).slice(0, 800).toLowerCase();
  if (INTERN_TITLE.test(t)) return 'Internship';
  const senior = SENIOR_PLUS_TITLE.test(t) || SENIOR_TITLE.test(t) || /\bfounding\b/i.test(t);
  if (!senior && /\b(intern|internship|co-?op|working student|werkstudent|praktikum)\b/.test(h)) return 'Internship';
  if (APPRENTICE_TITLE.test(t)) return 'Apprenticeship';
  if (!senior) {
    if (/\b(apprentice|apprenticeship|trainee|ausbildung)\b/.test(h)) return 'Apprenticeship';
    // The posting itself has to say so; a passing mention ("you'll mentor interns") is not enough.
    if (/\b(?:this is an? (?:(?:paid|unpaid|summer|full-time|part-time|remote|\d+[- ](?:month|week))[ ,]+)*internship|internship (?:position|role|opportunity|duration|period)\b)/.test(head)) return 'Internship';
  }
  const th = t.toLowerCase() + ' ' + h;
  if (/\bpart[- ]?time\b/.test(th)) return 'Part-time';
  if (/\b(contract|contractor|freelance|temporary|fixed[- ]term)\b/.test(th)) return 'Contract';
  if (/\b(?:part[- ]time|contract|freelance) (?:position|role|job|opportunity)\b|\b\d+[- ]month contract\b/.test(head)) return /part[- ]time/.test(head) ? 'Part-time' : 'Contract';
  return 'Full-time';
}

/** Seniority words a source gives us directly ("Director", "Entry-level", "mid_level") mapped to our levels. */
export function normLevel(hint = '') {
  const parts = (Array.isArray(hint) ? hint : [hint]).map(x => String(x || '').toLowerCase().replace(/_/g, ' '));
  const rank = { Intern: 0, Entry: 1, Mid: 2, Senior: 3, 'Senior+': 4 }; let best = null;
  for (const s of parts) {
    let l = null;
    if (!s || /\bany\b|not applicable/.test(s)) l = null;
    else if (/\bintern|student/.test(s)) l = 'Intern';
    else if (/mid[- ]senior/.test(s)) l = null; // too broad to mean anything
    else if (/director|executive|\bvp\b|vice president|chief|c[- ]level|head|principal|\bstaff\b|\blead\b|manager/.test(s)) l = 'Senior+';
    else if (/senior|\bsr\b|experienced/.test(s)) l = 'Senior';
    else if (/entry|junior|graduate|associate|trainee|no experience/.test(s)) l = 'Entry';
    else if (/\bmid|intermediate/.test(s)) l = 'Mid';
    if (l && (best === null || rank[l] < rank[best])) best = l; // open to several levels: the lowest is who can apply
  }
  return best;
}

/**
 * Seniority, in order of trust: what the title says, what the source says, the years it asks for,
 * then wording in the posting. "Mid" is the fallback when nothing says otherwise.
 */
export function inferLevel(title = '', text = '', { hint = '', years = undefined } = {}) {
  const t = String(title);
  if (INTERN_TITLE.test(t)) return 'Intern';
  if (SENIOR_PLUS_TITLE.test(t)) return 'Senior+';
  if (SENIOR_TITLE.test(t)) return 'Senior';
  if (ENTRY_TITLE.test(t)) return 'Entry';
  if (MID_TITLE.test(t)) return 'Mid';
  const fromSource = normLevel(hint);
  if (fromSource) return fromSource;
  let y = years;
  if (y === undefined) { const m = `${title} ${text}`.toLowerCase().match(/\b(\d{1,2})\s*\+?\s*(?:-|–|to)?\s*(\d{1,2})?\s*\+?\s*years?/); y = m ? Number(m[1]) : null; }
  if (/\bfounding\b/i.test(t) && (y === null || y >= 2)) return y !== null && y >= 7 ? 'Senior+' : 'Senior';
  if (y !== null && y !== undefined) { if (y <= 1) return 'Entry'; if (y <= 3) return 'Mid'; if (y <= 6) return 'Senior'; return 'Senior+'; }
  if (/\b(new grads?|entry[- ]level|no experience|fresh graduates?|recent graduates?)\b/i.test(text)) return 'Entry';
  return 'Mid';
}
/** Recompute level on a stored job (after a source told us more, or the rules improved). */
export function relevel(job) {
  job.level = job.type === 'Internship' ? 'Intern' : inferLevel(job.title, job.description || '', { hint: job.levelHint, years: job.yearsMin ?? null });
  if (job.level === 'Intern' && job.type !== 'Internship') job.type = 'Internship';
  return job;
}

export function inferCategory(title = '', text = '') {
  const t = title.toLowerCase();
  const rules = [
    ['AI / ML', /\b(machine learning|ml|ai|llm|deep learning|research scientist|applied scientist|computer vision|nlp|data scientist|genai)\b/],
    ['Data', /\b(data|analytics|analyst|bi|business intelligence)\b/],
    ['Design', /\b(design|designer|ux|ui|brand|illustrat|creative)\b/],
    ['Product', /\b(product manager|product owner|apm|product management|pm intern)\b/],
    ['Engineering', /\b(engineer|engineering|developer|software|sde|swe|frontend|front-end|backend|back-end|full[- ]?stack|devops|sre|security|mobile|ios|android|qa|firmware|embedded|infrastructure|platform|programmer|robotics)\b/],
    ['Sales / Growth', /\b(sales|account executive|sdr|bdr|business development|growth|marketing|seo|content|social media|community|partnerships|customer success|gtm)\b/],
    ['Operations', /\b(operations|ops|strategy|founder'?s office|chief of staff|finance|accounting|legal|hr|people|recruit|talent|admin|supply chain|bizops)\b/],
  ];
  for (const [c, re] of rules) if (re.test(t)) return c;
  const s = text.slice(0, 1500).toLowerCase();
  for (const [c, re] of rules) if (re.test(s)) return c;
  return 'Other';
}

const COUNTRY_RULES = [
  ['India', /\b(india|bengaluru|bangalore|hyderabad|pune|mumbai|delhi|new delhi|ncr|gurugram|gurgaon|chennai|kolkata|noida|ahmedabad|kochi|jaipur|indore|chandigarh|coimbatore|thiruvananthapuram|trivandrum|mohali|bhubaneswar)\b/],
  ['Canada', /\b(canada|toronto|vancouver|montreal|montréal|waterloo|ottawa|calgary|edmonton|mississauga|oakville|winnipeg|halifax|quebec city|victoria, bc|kitchener|markham|burnaby|london, on)\b/],
  ['United States', /\b(united states|usa|u\.s\.a?\.?|us-remote|remote[- ]us|san francisco|sf bay|bay area|new york|nyc|seattle|austin|boston|chicago|los angeles|palo alto|mountain view|menlo park|san jose|sunnyvale|denver|atlanta|miami|washington,? d\.?c|philadelphia|pittsburgh|portland|san diego|dallas|houston|redwood city|cambridge, ma|el segundo|bellevue|scotts valley|irvine|santa clara|cupertino|los gatos|kirkland|redmond|boulder|raleigh|durham|nashville|phoenix|salt lake city|minneapolis|detroit|columbus|baltimore|st\.? louis|kansas city|orlando|tampa|charlotte|las vegas|hawthorne|torrance|culver city|santa monica|oakland|berkeley|san mateo|foster city|south san francisco|ann arbor|madison|arlington|reston|mclean|huntsville|albuquerque|tucson|sacramento|fremont|plano|brooklyn|jersey city|hoboken|stamford)\b/],
  ['United Kingdom', /\b(united kingdom|uk|england|scotland|wales|london|manchester|edinburgh|cambridge, uk|oxford|bristol|glasgow|birmingham, uk|leeds|belfast)\b/],
  ['Germany', /\b(germany|deutschland|berlin|munich|münchen|hamburg|frankfurt|cologne|köln|stuttgart|düsseldorf)\b/],
  ['Singapore', /\bsingapore\b/],
  ['UAE', /\b(dubai|abu dhabi|uae|united arab emirates)\b/],
  ['France', /\b(france|paris(?!,? (?:tx|texas))|lyon|toulouse|rennes|nantes|bordeaux|marseille)\b/],
  ['Netherlands', /\b(netherlands|amsterdam|rotterdam|eindhoven|utrecht|the hague)\b/],
  ['Australia', /\b(australia|sydney|melbourne|brisbane|perth|adelaide)\b/],
  ['Japan', /\b(japan|tokyo|osaka|kyoto)\b/],
  ['South Korea', /\b(south korea|korea|seoul)\b/],
  ['China', /\b(china|beijing|shanghai|shenzhen|hangzhou|guangzhou)\b/],
  ['Hong Kong', /\bhong kong\b/],
  ['Israel', /\b(israel|tel aviv|haifa|herzliya)\b/],
  ['Latin America', /\b(brazil|brasil|são paulo|sao paulo|rio de janeiro|mexico|méxico|ciudad de m[eé]xico|guadalajara|monterrey|colombia|bogot[aá]|medell[ií]n|argentina|buenos aires|chile|santiago|peru|lima|uruguay|costa rica)\b/],
  ['Southeast Asia', /\b(philippines|manila|cebu|malaysia|kuala lumpur|thailand|bangkok|vietnam|ho chi minh|hanoi|indonesia|jakarta)\b/],
  ['Europe (other)', /\b(spain|madrid|barcelona|portugal|lisbon|porto|ireland|dublin|poland|warsaw|krak[oó]w|sweden|stockholm|switzerland|zurich|zürich|geneva|italy|milan|rome|austria|vienna|denmark|copenhagen|estonia|tallinn|finland|helsinki|belgium|brussels|czech|prague|norway|oslo|romania|bucharest|greece|athens|hungary|budapest|europe|emea)\b/],
];
const ISO2 = { ca: 'Canada', gb: 'United Kingdom', uk: 'United Kingdom', de: 'Germany', fr: 'France', nl: 'Netherlands', au: 'Australia', sg: 'Singapore', ae: 'UAE', in: 'India', jp: 'Japan', kr: 'South Korea', cn: 'China', hk: 'Hong Kong', il: 'Israel', br: 'Latin America', mx: 'Latin America', co: 'Latin America', ar: 'Latin America', cl: 'Latin America', pe: 'Latin America', ph: 'Southeast Asia', my: 'Southeast Asia', th: 'Southeast Asia', vn: 'Southeast Asia', id: 'Southeast Asia', es: 'Europe (other)', pt: 'Europe (other)', ie: 'Europe (other)', pl: 'Europe (other)', se: 'Europe (other)', ch: 'Europe (other)', it: 'Europe (other)', at: 'Europe (other)', dk: 'Europe (other)', ee: 'Europe (other)', fi: 'Europe (other)', be: 'Europe (other)', cz: 'Europe (other)', no: 'Europe (other)', ro: 'Europe (other)', gr: 'Europe (other)', hu: 'Europe (other)', us: 'United States' };
const US_STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';
const US_CODE = new RegExp(String.raw`(?:\bUS\b|\bUSA\b|\(US\)|, (?:${US_STATES})\b|\bSF\b|\bNYC\b|\bLA\b)`);
const US_STATE_NAMES = /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington state|kent, washington|wisconsin|wyoming)\b/;
export function inferCountry(location = '') {
  const raw = String(location); const s = raw.toLowerCase();
  if (/\(IN\)|^IN\b|\bIN \/|, India\b/.test(raw)) return 'India';
  // Canadian cities first: "Toronto, CA" is Canada, not California.
  if (COUNTRY_RULES[1][1].test(s) || /, (?:ON|BC|QC|AB|MB|NS)\b/.test(raw)) return 'Canada';
  // Uppercase US state codes ("Manchester, NH", "Paris, TX") beat same-named foreign cities.
  if (US_CODE.test(raw) || US_STATE_NAMES.test(s)) return 'United States';
  // Lowercase ISO-2 suffixes from ATS feeds ("Bogotá, co", "Perth, au").
  const iso = raw.match(/,\s*([a-z]{2})\s*(?:$|[;|)])/)?.[1];
  if (iso && ISO2[iso]) return ISO2[iso];
  for (const [c, re] of COUNTRY_RULES) if (re.test(s)) return c;
  if (/\b(remote|anywhere|worldwide|global|distributed)\b/.test(s)) return 'Remote (global)';
  return 'Unknown';
}
export function isRemote(location = '', text = '') {
  return /\b(remote|work from home|wfh|anywhere|distributed)\b/i.test(location) || /\b(fully remote|100% remote|remote[- ]first)\b/i.test(text.slice(0, 2000));
}

const AMOUNT_RE = /(?:[$€£₹]|\b(?:USD|INR|EUR|GBP|CAD|AUD|SGD|CHF|PHP|ZAR|JPY|PLN|SEK|AED|Rs\.?)[ \t]?)[ \t]?\d[\d,.]*(?:[ \t]?(?:k|K|LPA|lakhs?|L|cr)\b)?(?:[ \t]?(?:-|–|to)[ \t]?(?:[$€£₹]|USD|INR|CAD|EUR|GBP)?[ \t]?\d[\d,.]*(?:[ \t]?(?:k|K|LPA|lakhs?|L|cr)\b)?)?(?:[ \t]?(?:USD|CAD|AUD|EUR|GBP|INR|SGD|CHF)\b)?(?:[ \t]?(?:(?:\/|per|an?)[ \t]?(?:year|yr|annum|month|mo|hour|hr|week)\b|monthly|hourly|annually|yearly|p\.?a\.?\b|p\.?m\.?\b))?/g;
const PAY_CONTEXT = /(\bpay\b|salary|compensation|pay (?:range|band|scale)|base pay|base salary|stipend|ctc|ote\b|wage|hourly rate|per (?:year|hour|month|annum)|annual|\/yr|\/hr)/i;
const NOT_PAY_BEFORE = /(raised|raise|funding|valuation|aum|assets under|revenue|arr\b|series [a-f]|backed|invest|grant|budget|deal|market|worth|fund)[^.\n]{0,40}$/i;
/** Pay range from the posting, only where it reads like compensation (not funding rounds, AUM, revenue). */
export function extractSalary(text = '') {
  const lpa = text.match(/\b\d+(?:\.\d+)?\s*(?:-|–|to)\s*\d+(?:\.\d+)?\s*(?:LPA|lakhs?(?: per annum)?)\b/i) || text.match(/\b\d+(?:\.\d+)?\s*LPA\b/i);
  let best = null;
  for (const m of text.matchAll(AMOUNT_RE)) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 14);
    const before = text.slice(Math.max(0, m.index - 90), m.index);
    if (/^\s*(?:m|mm|mn|b|bn|million|billion|trillion|\+? ?(?:customers|users|companies))\b/i.test(after) || NOT_PAY_BEFORE.test(before)) continue;
    const ctx = PAY_CONTEXT.test(before.slice(-80) + m[0] + after);
    const looksLikePay = ctx || /k\b|per|\/|an? (?:year|hour|month)|-|–/i.test(m[0]);
    if (!looksLikePay) continue;
    if (!best || (ctx && !best.ctx)) best = { s: m[0].trim(), ctx };
    if (best.ctx) break;
  }
  if (best) return best.s;
  if (lpa) return lpa[0].trim();
  const st = text.match(/(?:stipend|salary|compensation)[ \t]*[:\-][ \t]*([^\n]{3,60})/i);
  return st && /\d/.test(st[1]) ? st[1].trim() : '';
}

export function extractEmails(text = '') {
  const raw = String(text).replace(/\s*\[\s*at\s*\]\s*|\s+\(at\)\s+|\s+at\s+(?=[a-z0-9-]+\s*(?:\[dot\]|\(dot\)|\.)\s*[a-z]{2,})/gi, '@').replace(/\s*\[\s*dot\s*\]\s*|\s*\(dot\)\s*/gi, '.');
  const list = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/gi) || [];
  return [...new Set(list.map(e => e.toLowerCase().replace(/[^a-z0-9]+$/, '')))].filter(e => !/(example\.|domain\.com|email\.com|yourcompany|sentry|wixpress|webpack|w3\.org|\.png|\.jpg|\.svg|\.webp|noreply|no-reply|donotreply|u003e)/.test(e) && !/^(security|vulnerabilit|abuse|privacy|legal|press|media|dmca|gdpr|dpo|compliance|accessibility|investors?|billing|webmaster|postmaster|unsubscribe|notifications?|trust|safety|copyright|disclosure|psirt)\b/.test(e));
}

/** Fill all derived fields of a normalized job. Keeps any value the source already supplied. */
export function enrich(job) {
  const text = job.description || '';
  const levelHint = job.levelHint || job.level || '';   // a level the source supplied is evidence, the title still wins
  const type = job.type || (job.level === 'Intern' ? 'Internship' : inferType(job.title, job.typeHint, text));
  const level = type === 'Internship' ? 'Intern' : (job.level || 'Mid');
  const locStr = Array.isArray(job.locations) ? job.locations.join('; ') : (job.location || '');
  const country = job.country || inferCountry(locStr || text.slice(0, 600));
  const skills = (job.skills?.length ? mergeSkills(job.skills, extractSkills(text, job.title)) : extractSkills(text, job.title));
  const out = {
    ...job,
    location: locStr,
    country,
    remote: job.remote ?? isRemote(locStr, text),
    level, levelHint: Array.isArray(levelHint) ? levelHint.join(' ') : String(levelHint),
    type,
    skills,
    requirements: job.requirements?.length ? job.requirements : requirementLines(text),
    salary: cleanSalary(job.salary || extractSalary(text), type),
    emails: [...new Set([...(job.emails || []), ...extractEmails(text)])],
  };
  Object.assign(out, deepAttributes(out));
  if (type !== 'Internship') { out.level = inferLevel(job.title, text, { hint: levelHint, years: out.yearsMin }); if (out.level === 'Intern') out.type = 'Internship'; }
  return out;
}
function mergeSkills(given, found) {
  const m = new Map(found.map(s => [s.name.toLowerCase(), s]));
  for (const g of given) { const name = typeof g === 'string' ? g : g.name; if (name && !m.has(name.toLowerCase())) m.set(name.toLowerCase(), { name, group: 'Listed' }); }
  return [...m.values()];
}
