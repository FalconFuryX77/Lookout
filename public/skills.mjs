// One skill vocabulary for the scanner (reading postings and résumés) and the app (showing them).
// A skill is "technical" when it names a tool, language, framework or engineering discipline.
// Everything else ("Sales", "Operations", "Communication") is general: still filterable, shown quieter.

export const SKILLS = {
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
export const SKILL_ALIASES = { Golang: 'Go', LLM: 'LLMs', Lambda: 'Serverless' };

/** Order the groups appear in; "General" is always last. */
export const SKILL_GROUPS = ['Languages', 'AI / ML', 'Backend', 'Frontend', 'Data', 'Infra', 'Hardware', 'Tools & practices', 'Design', 'General'];
const GROUP_LABEL = { Other: 'Tools & practices', Product: 'Design', Business: 'General' };
// Dictionary entries that are really job functions or soft skills.
const GENERAL_NAMES = new Set(['product management', 'roadmapping', 'analytics', 'user research', 'ux research', 'agile', 'testing', 'excel', 'statistics'].concat(SKILLS.Business.map(s => s.toLowerCase())).filter(s => !['hubspot', 'salesforce', 'crm', 'seo', 'financial modeling'].includes(s)));
// Words sources tag roles with that say nothing about what you would build.
const GENERAL_WORDS = /^(communication|leadership|management|teamwork|team ?work|collaboration|problem[- ]solving|writing|research|strategy|planning|presentation|negotiation|organi[sz]ation|customer (?:service|support|experience)|support|training|mentoring|coaching|consulting|administration|admin|hr|human resources|legal|compliance|accounting|bookkeeping|procurement|logistics|supply chain|retail|hospitality|healthcare|education|teaching|content|editing|translation|english|spanish|german|french|hindi|mandarin|project management|program management|people management|stakeholder management|time management|data entry|microsoft office|ms office|powerpoint|word|outlook|google workspace|documentation|reporting|scheduling|quality assurance|innovation|creativity|adaptability|attention to detail|critical thinking|interpersonal skills?|public speaking|fundraising|events?|pr|public relations|branding|advertising|e-?commerce|payments|insurance|banking|real estate|non-?tech|other|general)$/i;

const BY_NAME = new Map();
for (const [group, list] of Object.entries(SKILLS)) for (const n of list) {
  const name = SKILL_ALIASES[n] || n;
  if (!BY_NAME.has(name.toLowerCase())) BY_NAME.set(name.toLowerCase(), { name, group: GENERAL_NAMES.has(name.toLowerCase()) ? 'General' : GROUP_LABEL[group] || group });
  BY_NAME.set(n.toLowerCase(), BY_NAME.get(name.toLowerCase()));
}
// Common long forms that sources use for things in the dictionary.
const LONG_FORMS = [[/amazon web services|\baws\b/i, 'aws'], [/google cloud/i, 'gcp'], [/microsoft azure/i, 'azure'], [/pytorch/i, 'pytorch'], [/postgres/i, 'postgresql'], [/\bk8s\b/i, 'kubernetes'], [/node\.?js/i, 'node.js'], [/react\.?js/i, 'react'], [/large language models?/i, 'llms'], [/natural language processing/i, 'nlp']];
// Shapes that only technical names have: "Node.js", "C++", "S3", "gRPC", "OAuth2", "CI/CD".
const TECH_SHAPE = /[+#]|[A-Z]{2,}-\d|[A-Za-z]-[A-Z]{2,}|^[A-Z][A-Z0-9]{1,5}$|[a-z][A-Z]|[A-Za-z]\d|\d[A-Za-z]{2}/;
const TECH_WORDS = /baib|operating systems?|dbms|object[- ]oriented|boopb|model (?:evaluation|training|deployment|serving)|calibration|query optimi[sz]ation|cryptograph|encryption|explainab|interpretab|concurrency|multithread|parallel computing|version control|unit test|\.js$|\.net|sql|db$|\bapis?\b|script|cloud|linux|kernel|compiler|backend|frontend|full[- ]?stack|engineering|programming|software|hardware|data (?:science|engineering|modeling|warehous|analysis)|machine|neural|vision|crypto|circuit|simulation|automation|devops|infrastructure|database|algorithm|embedded|robot|ci\/cd|framework|server|network|coding|developer|web|mobile|android|ios|gpu|chip|semiconductor|analog|rf\b|signal|control systems|quantum|bioinformatics|cad\b/i;
const EXTRA_TECH = /^(spring|ruby on rails|jenkins|heroku|objective-c|erlang|transformers|diffusion models|blender|altium|photoshop|illustrator|windows|tcp\/ip|assembly|microcontrollers?|evals|opencv|bash\/shell|information security|it security|infosec|multimodal ai|device drivers|puppeteer|whisper|vector embeddings|data analytics|speech recognition|chatbots|adobe .*|autodesk .*|unreal engine|wireframing|sensor integration|fpgas|reinforcement learning.*|natural language.*|neural networks|latex|jira|postman|numpy|matplotlib|seaborn|keras|xgboost|opengl|vulkan|zustand|prisma|sqlalchemy|hadoop|hive|tailwind ?css|bootstrap|material ui|shadcn|streamlit|gradio|ollama|langgraph|pinecone|chroma|weaviate|qdrant|faiss|mlflow|wandb|weights & biases|kubeflow|ansible|helm|argo ?cd|datadog|sentry|splunk|oauth|jwt|maven|gradle|junit|pytest|mocha|vitest|storybook|expo|electron|tauri|qt|gtk|ros ?2|gazebo|simulink|labview|ansys|comsol|kicad|ltspice|autocad|fusion 360|catia|creo|plc|scada|stm32|esp32|rtos|freertos|zephyr|can bus|i2c|spi|uart|bluetooth|ble|zigbee|lora)$/i;
const NOT_TECH =/^(b2b|b2c|saas|hr|pr|kyc|esg|okrs?|kpis?|roi|p&l|m&a|gtm|smb|d2c|24\/7.*|c-suite)$/i;

const cache = new Map();
/** { name, group, tech } for any skill name, known or not. */
export function skillInfo(raw) {
  const key = String(raw || '').trim(); const hit = cache.get(key); if (hit) return hit;
  const low = key.toLowerCase();
  let known = BY_NAME.get(low);
  if (!known) for (const [re, to] of LONG_FORMS) if (re.test(key)) { known = BY_NAME.get(to); break; }
  let out;
  if (known) out = { name: key, canonical: known.name, group: known.group, tech: known.group !== 'General' };
  else if (GENERAL_WORDS.test(low) || NOT_TECH.test(low)) out = { name: key, canonical: key, group: 'General', tech: false };
  else { const tech = EXTRA_TECH.test(key) || TECH_SHAPE.test(key) || TECH_WORDS.test(key); out = { name: key, canonical: key, group: tech ? 'Tools & practices' : 'General', tech }; }
  if (cache.size > 5000) cache.clear();
  cache.set(key, out); return out;
}
export const isTechSkill = name => skillInfo(name).tech;

// ── Reading skills and requirement lines out of a posting (used by the scanner and the browser extension) ──
const ALIASES = SKILL_ALIASES;
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
