// Turns raw postings into structured, filterable records: skills, requirements, role type,
// seniority, category, country, remote flag, salary.

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
  Other: ['Git', 'Agile', 'Testing', 'Jest', 'Playwright', 'Cypress', 'Selenium', 'Blockchain', 'Web3', 'iOS', 'Android', 'Unity', 'Unreal', 'Game Development', 'Data Structures', 'Algorithms', 'System Design', 'APIs', 'Communication'],
};
const ALIASES = { Golang: 'Go', LLM: 'LLMs', Lambda: 'Serverless' };
const SHORT_AMBIGUOUS = new Set(['C', 'R', 'Go', 'Excel', 'Testing', 'Communication', 'Security', 'Growth', 'Operations', 'Finance', 'Sales', 'Marketing', 'Community', 'APIs', 'REST', 'Statistics', 'Networking']);
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
  const lines = String(text).split(/\n|(?:\s•\s)/).map(l => l.replace(/^[•\-*▪◦·\d.)\s]+/, '').trim()).filter(Boolean);
  const out = []; let on = false;
  for (const l of lines) {
    if (l.length < 70 && REQ_HEAD.test(l)) { on = true; continue; }
    if (on && l.length < 60 && NEXT_HEAD.test(l)) { on = false; continue; }
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
  if (/\b(principal|staff|director|head of|vp|vice president|chief|lead|architect|manager)\b/.test(t)) return 'Senior+';
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
  ['United States', /\b(united states|usa|u\.s\.a?\.?|us-remote|remote[- ]us|san francisco|sf bay|bay area|new york|nyc|seattle|austin|boston|chicago|los angeles|palo alto|mountain view|menlo park|san jose|sunnyvale|denver|atlanta|miami|washington,? d\.?c|philadelphia|pittsburgh|portland|san diego|dallas|houston|redwood city|cambridge, ma|[a-z .]+, (?:ca|ny|wa|tx|ma|il|co|ga|fl|nj|pa|or|va|nc|ut|az|mn|mi|oh|md|dc))\b/],
  ['United Kingdom', /\b(united kingdom|uk|england|london|manchester|edinburgh|cambridge, uk|oxford|bristol|glasgow)\b/],
  ['Canada', /\b(canada|toronto|vancouver|montreal|waterloo|ottawa|calgary)\b/],
  ['Germany', /\b(germany|berlin|munich|münchen|hamburg|frankfurt)\b/],
  ['Singapore', /\bsingapore\b/],
  ['UAE', /\b(dubai|abu dhabi|uae|united arab emirates)\b/],
  ['France', /\b(france|paris)\b/],
  ['Netherlands', /\b(netherlands|amsterdam|rotterdam)\b/],
  ['Australia', /\b(australia|sydney|melbourne)\b/],
  ['Europe (other)', /\b(spain|madrid|barcelona|portugal|lisbon|ireland|dublin|poland|warsaw|sweden|stockholm|switzerland|zurich|italy|milan|austria|vienna|denmark|copenhagen|estonia|finland|helsinki|belgium|czech|prague|europe|emea)\b/],
];
export function inferCountry(location = '') {
  const s = String(location).toLowerCase();
  for (const [c, re] of COUNTRY_RULES) if (re.test(s)) return c;
  if (/\b(remote|anywhere|worldwide|global|distributed)\b/.test(s)) return 'Remote (global)';
  return 'Unknown';
}
export function isRemote(location = '', text = '') {
  return /\b(remote|work from home|wfh|anywhere|distributed)\b/i.test(location) || /\b(fully remote|100% remote|remote[- ]first)\b/i.test(text.slice(0, 2000));
}

export function extractSalary(text = '') {
  const m = text.match(/(?:[$€£₹]|USD|INR|EUR|GBP)\s?\d[\d,.]*\s?(?:k|K|L|LPA|lakhs?|m)?(?:\s?(?:-|–|to)\s?(?:[$€£₹]|USD|INR)?\s?\d[\d,.]*\s?(?:k|K|L|LPA|lakhs?|m)?)?(?:\s?(?:\/|per)\s?(?:year|yr|annum|month|mo|hour|hr))?/);
  if (m) return m[0].trim();
  const st = text.match(/(?:stipend|salary|compensation)[:\s]+([^\n]{3,60})/i);
  return st ? st[1].trim() : '';
}

export function extractEmails(text = '') {
  const raw = String(text).replace(/\s*\[\s*at\s*\]\s*|\s+\(at\)\s+|\s+at\s+(?=[a-z0-9-]+\s*(?:\[dot\]|\(dot\)|\.)\s*[a-z]{2,})/gi, '@').replace(/\s*\[\s*dot\s*\]\s*|\s*\(dot\)\s*/gi, '.');
  const list = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/gi) || [];
  return [...new Set(list.map(e => e.toLowerCase().replace(/\.$/, '')))].filter(e => !/(example\.|domain\.com|email\.com|yourcompany|sentry|wixpress|webpack|w3\.org|\.png|\.jpg|\.svg|\.webp|noreply|no-reply|donotreply|u003e)/.test(e));
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
  return {
    ...job,
    location: locStr,
    country,
    remote: job.remote ?? isRemote(locStr, text),
    level: type === 'Internship' ? 'Intern' : level,
    type,
    category: job.category || inferCategory(job.title, text),
    skills,
    requirements: job.requirements?.length ? job.requirements : requirementLines(text),
    salary: job.salary || extractSalary(text),
    emails: [...new Set([...(job.emails || []), ...extractEmails(text)])],
  };
}
function mergeSkills(given, found) {
  const m = new Map(found.map(s => [s.name.toLowerCase(), s]));
  for (const g of given) { const name = typeof g === 'string' ? g : g.name; if (name && !m.has(name.toLowerCase())) m.set(name.toLowerCase(), { name, group: 'Listed' }); }
  return [...m.values()];
}
