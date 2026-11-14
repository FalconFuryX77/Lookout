// Turns raw postings into structured, filterable records: skills, requirements, role type,
// seniority, specialty/field, country, remote flag, salary, visa, years, pay.
import { deepAttributes, payOf } from './taxonomy.mjs';

/** Keep a pay string only if it parses as pay (or is clearly an Indian CTC/stipend we can't normalize). */
export function cleanSalary(s, type) {
  if (!s) return '';
  const t = String(s).trim().slice(0, 80);
  if (payOf(t, type === 'Internship')) return t;
  return /\d/.test(t) && /(lpa|lakh|crore|₹|ctc)/i.test(t) ? t : '';
}

const SKILLS = {
  Languages: ['Python', 'JavaScript', 'TypeScript', 'Java', 'Go', 'Golang', 'Rust', 'C', 'C++', 'C#', 'Kotlin', 'Swift', 'Ruby', 'PHP', 'Scala', 'Elixir', 'Dart', 'R', 'MATLAB', 'Solidity', 'Bash', 'SQL', 'Haskell', 'Julia', 'Lua', 'Verilog', 'VHDL'],
  Frontend: ['React', 'Next.js', 'Vue', 'Nuxt', 'Angular', 'Svelte', 'Redux', 'Tailwind', 'HTML', 'CSS', 'Webpack', 'Vite', 'React Native', 'Flutter', 'SwiftUI', 'Jetpack Compose', 'Three.js', 'WebGL'],
  Backend: ['Node.js', 'Express', 'NestJS', 'Django', 'Flask', 'FastAPI', 'Rails', 'Spring Boot', '.NET', 'Laravel', 'GraphQL', 'REST', 'gRPC', 'Microservices', 'WebSockets', 'Kafka', 'RabbitMQ', 'Redis', 'Celery'],
  Data: ['PostgreSQL', 'MySQL', 'MongoDB', 'DynamoDB', 'Cassandra', 'Elasticsearch', 'Snowflake', 'BigQuery', 'Redshift', 'Databricks', 'Spark', 'Airflow', 'dbt', 'Pandas', 'NumPy', 'ETL', 'Data Pipelines', 'Tableau', 'Power BI', 'Looker', 'Excel', 'ClickHouse', 'Supabase', 'Firebase'],
  'AI / ML': ['Machine Learning', 'Deep Learning', 'PyTorch', 'TensorFlow', 'JAX', 'scikit-learn', 'LLMs', 'LLM', 'NLP', 'Computer Vision', 'RAG', 'LangChain', 'LlamaIndex', 'Hugging Face', 'OpenAI', 'Prompt Engineering', 'Fine-tuning', 'Reinforcement Learning', 'MLOps', 'CUDA', 'Vector Databases', 'Generative AI', 'AI Agents', 'Recommendation Systems', 'Statistics'],
  Infra: ['AWS', 'GCP', 'Azure', 'Kubernetes', 'Docker', 'Terraform', 'CI/CD', 'GitHub Actions', 'Linux', 'Serverless', 'Lambda', 'Cloudflare', 'Vercel', 'Nginx', 'Observability', 'Prometheus', 'Grafana', 'Distributed Systems', 'Networking', 'Security', 'Penetration Testing', 'SRE', 'DevOps'],
  Product: ['Product Management', 'Figma', 'UX Research', 'UI Design', 'Prototyping', 'Product Design', 'A/B Testing', 'Analytics', 'Mixpanel', 'Amplitude', 'Roadmapping', 'User Research', 'Design Systems'],
  Business: ['Sales', 'Business Development', 'Marketing', 'Growth', 'SEO', 'Content Writing', 'Copywriting', 'Social Media', 'Customer Success', 'Account Management', 'Operations', 'Finance', 'Financial Modeling', 'Recruiting', 'Community', 'Partnerships', 'CRM', 'HubSpot', 'Salesforce', 'Go-to-Market'],
  Hardware: ['Embedded', 'Firmware', 'PCB Design', 'Robotics', 'ROS', 'FPGA', 'CAD', 'SolidWorks', 'Mechanical Engineering', 'Electrical Engineering', 'Arduino', 'Raspberry Pi'],
  Other: ['Git', 'Agile', 'Testing', 'Jest', 'Playwright', 'Cypress', 'Selenium', 'Blockchain', 'Web3', 'iOS', 'Android', 'Unity', 'Unreal', 'Game Development', 'Data Structures', 'Algorithms', 'System Design', 'APIs'],
};
const ALIASES = { Golang: 'Go', LLM: 'LLMs', Lambda: 'Serverless' };
const SHORT_AMBIGUOUS = new Set(['Recruiting', 'Analytics', 'Research', 'Design Systems', 'C', 'R', 'Go', 'Excel', 'Testing', 'Communication', 'Security', 'Growth', 'Operations', 'Finance', 'Sales', 'Marketing', 'Community', 'APIs', 'REST', 'Statistics', 'Networking']);
const SKILL_INDEX = Object.entries(SKILLS).flatMap(([group, list]) => list.map(name => ({ name: ALIASES[name] || name, group, re: skillRegex(name) })));
function skillRegex(name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\ /g, '[\\s-]?');
  if (name === 'C') return /(?:^|[\s,(/])C(?=[\s,)/;.]|$)(?![#+])/; // case-sensitive "C" language
  if (name === 'R') return /(?:^|[\s,(/])R(?=[\s,)/;]|$)(?!&)/;
  if (name === 'Go') return /(?:^|[\s,(/])(?:Go|Golang)(?=[\s,)/;.]|$)/;
  return new RegExp(`(?:^|[^a-z0-9+#.])${esc}(?![a-z0-9+#])`, 'i');
}

export function extractSkills(text = '', title = '') {
  const found = new Map();
  const all = `${title}\n${text}`;
  for (const s of SKILL_INDEX) {
    if (found.has(s.name)) continue;
    // ambiguous generic words only count when they are in the title or a requirements-like line
    const hay = SHORT_AMBIGUOUS.has(s.name) && s.name.length > 2 ? `${title}\n${requirementLines(text).join('\n')}` : all;
    if (s.re.test(hay)) found.set(s.name, s.group);
  }
  return [...found].map(([name, group]) => ({ name, group }));
}

const REQ_HEAD = /^(?:#+\s*)?(requirements?|qualifications?|what (?:you(?:'ll)? need|we(?:'re| are) looking for|you bring|we expect)|who you are|you (?:have|might be a fit|should have)|skills?(?: required| needed)?|must[- ]haves?|nice[- ]to[- ]haves?|bonus(?: points)?|preferred(?: qualifications)?|about you|ideal candidate|minimum qualifications|basic qualifications|eligibility)\b.*:?$/i;
const NEXT_HEAD = /^(?:#+\s*)?(benefits|perks|what we offer|compensation|about us|about the company|why join|our values|how to apply|interview process|responsibilities|what you(?:'ll)? do|the role|equal opportunity|location)\b/i;

/** Bullet-ish lines under Requirements / Qualifications style headings. */
export function requirementLines(text = '') {
  // Strip bullet markers and list numbering ("1." / "2)") but keep leading numbers that are content ("2 to 4 years").
  const lines = String(text).split(/\n|(?:\s•\s)/).map(l => l.replace(/^\s*(?:[•\-*▪◦·]+|\d{1,2}[.)])\s*/, '').trim()).filter(Boolean);
  const out = []; let on = false;
  for (const l of lines) {
    if (l.length < 70 && REQ_HEAD.test(l)) { on = true; continue; }
    if (on && l.length < 60 && NEXT_HEAD.test(l)) { on = false; continue; }
    if (/^[A-Z0-9 &/,:-]{3,40}$/.test(l) || /^(originally posted|apply (?:now|here)|requisition|req(?:uisition)? id)/i.test(l) || /requisition id/i.test(l)) continue; // section headers & footers
    if (on && l.length > 6 && l.length < 400) out.push(l);
    if (out.length >= 25) break;
  }
  return out;
}

export function inferType(text) {
  const s = text.toLowerCase();
  if (/\b(intern|internship|co-?op|summer analyst|industrial training)\b/.test(s)) return 'Internship';
  if (/\b(apprentice|apprenticeship|trainee)\b/.test(s)) return 'Apprenticeship';
  if (/\b(part[- ]time)\b/.test(s)) return 'Part-time';
  if (/\b(contract|contractor|freelance|temporary|fixed[- ]term)\b/.test(s)) return 'Contract';
  if (/\b(full[- ]time)\b/.test(s)) return 'Full-time';
  return 'Full-time';
}

export function inferLevel(title = '', text = '') {
  const t = title.toLowerCase(); const s = `${title} ${text}`.toLowerCase();
  if (/\b(intern|internship|co-?op)\b/.test(t)) return 'Intern';
  if (/\b(new grad|graduate|entry[- ]level|junior|jr\.?|fresher|associate engineer|early career|university grad|campus)\b/.test(t)) return 'Entry';
  if (/\b(principal|(?<!technical |of )staff|director|head of|vp|vice president|chief|lead|architect|senior manager|engineering manager|manager, engineering)\b/.test(t)) return 'Senior+';
  if (/\b(senior|sr\.?)\b/.test(t)) return 'Senior';
  const m = s.match(/\b(\d{1,2})\s*\+?\s*(?:-|–|to)?\s*(\d{1,2})?\s*\+?\s*years?/);
  if (m) { const y = Number(m[1]); if (y <= 1) return 'Entry'; if (y <= 3) return 'Mid'; if (y <= 6) return 'Senior'; return 'Senior+'; }
  if (/\b(new grad|entry[- ]level|no experience|fresh graduates?|recent graduates?)\b/.test(s)) return 'Entry';
  return 'Mid';
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
  const typeText = `${job.title} ${job.typeHint || ''} ${text.slice(0, 800)}`;
  const level = job.level || inferLevel(job.title, text);
  const type = job.type || (level === 'Intern' ? 'Internship' : inferType(typeText));
  const locStr = Array.isArray(job.locations) ? job.locations.join('; ') : (job.location || '');
  const country = job.country || inferCountry(locStr || text.slice(0, 600));
  const skills = (job.skills?.length ? mergeSkills(job.skills, extractSkills(text, job.title)) : extractSkills(text, job.title));
  const out = {
    ...job,
    location: locStr,
    country,
    remote: job.remote ?? isRemote(locStr, text),
    level: type === 'Internship' ? 'Intern' : level,
    type,
    skills,
    requirements: job.requirements?.length ? job.requirements : requirementLines(text),
    salary: cleanSalary(job.salary || extractSalary(text), type),
    emails: [...new Set([...(job.emails || []), ...extractEmails(text)])],
  };
  return Object.assign(out, deepAttributes(out));
}
function mergeSkills(given, found) {
  const m = new Map(found.map(s => [s.name.toLowerCase(), s]));
  for (const g of given) { const name = typeof g === 'string' ? g : g.name; if (name && !m.has(name.toLowerCase())) m.set(name.toLowerCase(), { name, group: 'Listed' }); }
  return [...m.values()];
}
