// Deep job attributes used by the filters: field/specialty, years of experience, visa
// sponsorship, work mode, degree, normalized pay and internship term.

export const FIELDS = {
  'Software & IT': ['AI / ML', 'Data Science', 'Data Engineering', 'Data Analytics', 'Frontend', 'Backend', 'Full-stack', 'Mobile', 'Software Engineering', 'DevOps / Cloud', 'Security', 'QA / Testing', 'Embedded / Firmware', 'IT & Support', 'Quant'],
  'Core Engineering': ['Hardware / Electrical', 'Mechanical', 'Robotics', 'Civil / Construction', 'Chemical / Materials', 'Aerospace', 'Manufacturing'],
  'Product & Design': ['Product', 'Design'],
  'Business': ['Sales', 'Marketing', 'Customer Success', 'Operations', 'Finance', 'HR / Recruiting', 'Legal'],
  'Science & Research': ['Research', 'Biotech / Life Sciences'],
  'Other': ['Other'],
};
export const FIELD_OF = Object.fromEntries(Object.entries(FIELDS).flatMap(([f, list]) => list.map(s => [s, f])));

// Titles whose head noun is a business function stay in business even if they mention AI/data/etc.
const BUSINESS_HEAD = /\b(sales|account (?:executive|manager)|gtm|go-to-market|marketing|marketer|seo|content|copywriter|recruit\w*|talent|counsel|attorney|lawyer|paralegal|designer|product manager|program manager|operations|consultant|editor|writer|expert|evangelist|partnerships?|customer success|business development|bdr|sdr|community|chief of staff|executive assistant|controller|accountant)\b/;
const TECH_HEAD = /\b(engineer\w*|developer|scientist|programmer|architect|sre|sdet|technician|analyst)\b/;
const HARDWARE = /\b(hardware|silicon|asic|fpga|rtl|dft|analog|mixed[- ]signal|pcb|rf\b|radio frequency|validation engineer|verification engineer|flight test|environmental test|manufacturing test|test engineer, (?:hardware|electrical)|packaging engineer|layout engineer|power electronics|circuit|semiconductor|photonics|optical engineer|antenna|signal integrity|board design)/;

// Ordered: first match wins.
const RULES = [
  ['Quant', /\b(quant|quantitative (?:developer|researcher|trader|analyst)|algo(?:rithmic)? trad)/],
  ['Data Science', /\b(data scien|decision scien)/],
  ['AI / ML', /\b(\bai\b[^,]*\b(?:intern|engineer|developer|builder|scientist|research)|ai agents?|agent (?:engineer|builder)|machine learning|ml engineer|mle\b|\bml\b|ai engineer|ai\/ml|ai researcher|ai scientist|ai (?:infrastructure|platform|research)|artificial intelligence|llm|deep learning|applied scientist|computer vision|\bnlp\b|genai|generative ai|research engineer|perception|reinforcement learning|robot learning|foundation model)/],
  ['Data Engineering', /\b(data engineer|data architect|database (?:engineer|administrator|developer)|dba\b|analytics engineer|etl\b|data platform|data infrastructure|data pipeline)/],
  ['Data Analytics', /\b(data[\w ]{0,12} analyst|data analyst|business analyst|analytics|business intelligence|\bbi (?:analyst|developer|engineer)|insights analyst|reporting analyst|data intern)/],
  ['Security', /\b(vulnerab|vapt|attack engineer|red team|incident commander|security(?!\s+(?:clearance|officer|guard|specialist, physical))|cyber|appsec|infosec|penetration|soc analyst|threat (?:intel|hunt|detect))/],
  ['DevOps / Cloud', /\b(cloud (?:infra|infrastructure|inference|solution|platform|operations)|multicloud|build engineer|release engineer|cloud architect|devops|sre\b|site reliability|cloud engineer|infrastructure engineer|platform engineer|kubernetes|devsecops|production engineer, (?:infra|cloud))/],
  ['QA / Testing', /\b(qa\b|sdet|software test|test automation|automation test|quality assurance(?: engineer)?(?=.*\b(?:software|web|app|automation)\b)|software qa)/],
  ['Mobile', /\b(ios|android|mobile (?:engineer|developer|app)|react native|flutter)/],
  ['Frontend', /\b(front[- ]?end|ui engineer|web developer|react developer|web engineer)/],
  ['Backend', /\b(back[- ]?end|api engineer|server[- ]side)/],
  ['Full-stack', /\b(full[- ]?stack)/],
  ['Embedded / Firmware', /\b(embedded|firmware|kernel|device driver|bsp\b)/],
  ['IT & Support', /\b(it (?:systems|manager|engineer)|information systems|is infrastructure|support engineer|enterprise technology|it service|itsm|servicenow|sap basis|it support|it specialist|helpdesk|help desk|system administrator|sysadmin|network (?:engineer|administrator)|it (?:analyst|technician|intern|administrator|operations)|desktop support|technical support)/],
  ['Software Engineering', /\b(\bsw\b|python|engineering manager|core engineer|(?:solutions?|platform|ai|software|cloud|enterprise) architect|web3|architecte|tech lead|deployment engineer|trading systems|d[ée]veloppeur|entwickler|desarrollador|sviluppatore|ontwikkelaar|java\b|\.net\b|website|web technology|libraries|systems architect|solutions architect|software architect|plm systems|dynamics 365|ms dynamics|software|technical staff|computer science|sap\b|abap|salesforce developer|swe\b|sde\b|developer|programmer|coding|application engineer|forward deployed|founding engineer|solutions engineer|product engineer|systems engineer(?!ing)?,? (?:software|platform))/],
  ['Robotics', /\b(robotic)/],
  ['Aerospace', /\b(aerospace|avionics|propulsion|spacecraft|aircraft|gnc\b|guidance,? navigation|flight (?:software|sciences|dynamics)|launch|rocket|orbital)/],
  ['Hardware / Electrical', /\b(control systems|controls engineer|systemelektroniker|elektroniker|electrical|electronics|power systems|radar|motor control)/],
  ['Mechanical', /\b(cryogenic|maschinenbau|mechanical|hvac|thermal|cad designer|solidworks|mechatronics|cfd\b|structures? engineer)/],
  ['Civil / Construction', /\b(highway|roadway|bridge engineer|estudios agua|water engineer|civil|structural|construction|geotechnical|surveyor|architectural|water resources|transportation engineer)/],
  ['Chemical / Materials', /\b(materials and processes|materials engineer|chemical|materials? (?:engineer|scien)|process engineer|metallurg|polymer)/],
  ['Manufacturing', /\b(production technician|production support|field service technician|warehouse|operator\b|machinist|welder|fitter|(?<!lab |it |research |pharmacy )technician|field service engineer|production scheduler|manufacturing|production engineer|industrial engineer|supply chain engineer|quality engineer|test technician|assembly)/],
  ['Product', /\b(product manag|product owner|\bapm\b|\bpm\b intern|program manager|technical program)/],
  ['Design', /\b(design(?:er)?\b|\bux\b|\bui\b|illustrat|creative|motion graphic|brand designer)/],
  ['Sales', /\b(sales|account executive|\bsdr\b|\bbdr\b|business development|account manager|gtm|go-to-market|solutions consultant)/],
  ['Marketing', /\b(writer|journalist|reporter|producer|marketing|growth|seo|content|social media|community|brand|communications|\bpr\b|copywrit|video editor)/],
  ['Customer Success', /\b(kundenbetreuung|kundenservice|service client|support analyst|customer success|customer support|customer experience|support specialist|implementation|onboarding specialist)/],
  ['Finance', /\b(cost control|revenue analyst|wealth management|m&a|controlling|private equity|venture capital|financ|accounting|accountant|investment|audit|tax\b|treasury|banking|actuar|equity research|controller|fp&a)/],
  ['HR / Recruiting', /\b(recruit|talent|\bhr\b|human resources|people (?:ops|partner|operations))/],
  ['Legal', /\b(legal|counsel(?!l)|attorney|lawyer|paralegal|compliance|litigation)/],
  ['Operations', /\b(coordinator|planner|buyer|acheteur|einkauf|projects? manager|business support|data entry|executive assistant|project manager|consultant|operations|\bops\b|strategy|founder'?s office|chief of staff|bizops|business operations|supply chain|logistics|procurement|admin|inventory)/],
  ['Biotech / Life Sciences', /\b(biolog|biotech|clinical|lab (?:technician|assistant)|pharma|chemist|genomic|life science|medical|physician|nurse)/],
  ['Research', /\b(r&d|research (?:scientist|assistant|intern|fellow|associate)|scientist|phd|physicist)/],
];
const TECH_SPECIALTIES = new Set(FIELDS['Software & IT']);
const CATEGORY_HINT = [
  [/data science, ai|data science|machine learning/, 'Data Science'], [/ai\/ml\/data/, 'Data Analytics'], [/software/, 'Software Engineering'],
  [/hardware/, 'Hardware / Electrical'], [/quant/, 'Quant'], [/product/, 'Product'], [/data|analyst/, 'Data Analytics'], [/design/, 'Design'],
];
export function classifyRole(title = '', text = '') {
  const t = title.toLowerCase();
  const businessTitle = BUSINESS_HEAD.test(t) && !TECH_HEAD.test(t);
  // Hardware roles first, unless the title is explicitly software/firmware.
  const aiRule = RULES.find(r => r[0] === 'AI / ML')[1];
  if (/\b(physicist|research scientist)\b/.test(t) && !aiRule.test(t)) return 'Research';
  // Ambiguous titles: decide by whether the posting is about software.
  const softwareText = /\b(software|saas|api|apis|frontend|backend|full[- ]?stack|python|typescript|javascript|golang|kubernetes|microservices|distributed systems|cloud)\b/i.test(text.slice(0, 4000));
  const ambiguous = /\b(product engineer|application engineer|applications engineer|staff engineer|principal engineer|lead engineer|systems engineer)\b/.test(t);
  const techInTitle = /\b(software|data|ml|ai|cloud|platform|web|backend|frontend|infra|infrastructure|api|it|is|devops|security|mobile)\b/.test(t);
  if (ambiguous && !techInTitle) return softwareText ? 'Software Engineering' : 'Other';
  if (HARDWARE.test(t) && !/\b(software|firmware|embedded software)\b/.test(t)) return /\b(test|validation)\b/.test(t) && /manufactur/.test(t) ? 'Manufacturing' : 'Hardware / Electrical';
  for (const [s, re] of RULES) { if (businessTitle && TECH_SPECIALTIES.has(s)) continue; if (re.test(t)) return s; }
  const hint = text.match(/Category:\s*([^\n]+)/i)?.[1]?.toLowerCase();
  if (hint) for (const [re, s] of CATEGORY_HINT) if (re.test(hint)) return s;
  // Structured role lines only (YC: "Engineering\nMachine learning"; ATS department lines). Never prose.
  const lines = text.split('\n').slice(0, 3).map(l => l.trim().toLowerCase()).filter(l => l && l.length < 40);
  for (const l of lines) for (const [s, re] of RULES) if (re.test(l)) return s;
  return ambiguous && techInTitle ? 'Software Engineering' : 'Other';
}

const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15 };
/** Minimum / maximum years of experience asked for. null = not stated. */
export function yearsOf(title = '', text = '', level = '') {
  const exp = text.match(/Experience:\s*([^\n]+)/i)?.[1] || '';
  const norm = s => s.toLowerCase().replace(/–|—/g, '-').replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen)\b(?=\s*(?:\+|or more|plus)?\s*(?:-|to)?\s*(?:\d+\s*)?(?:years?|yrs?))/g, w => NUM_WORDS[w]);
  const BAD_AFTER = /^[^.\n]{0,25}\b(of age|old|ago|in business (?:for|since)|of funding|runway|history|track record of the company|and \d[\d,]*\+? (?:projects|clients|customers))/;
  const BAD_BEFORE = /(over the (?:past|last)|for (?:the )?(?:past|last)|founded|been around|in the last|within|with over|with more than|boasting)\s*$/;
  if (/entry[- ]level to \d+\s*(?:years?|yrs?)/i.test(text)) { const m = text.match(/entry[- ]level to (\d+)/i); return { min: 0, max: +m[1] }; }
  const PATTERNS = [
    [/(\d{1,2})\s*(?:\+|plus)?\s*(?:-|to)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)/g, m => (+m[1] <= +m[2] ? { min: +m[1], max: +m[2] } : null)],
    [/(?:minimum(?: of)?|at least|min\.?)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)/g, m => ({ min: +m[1], max: null })],
    [/(\d{1,2})\s*(?:\+|or more|plus)\s*(?:years?|yrs?)/g, m => ({ min: +m[1], max: null })],
    [/\+\s*(\d{1,2})\s*(?:years?|yrs?)/g, m => ({ min: +m[1], max: null })],
    [/(\d{1,2})\s*(?:years?|yrs?)(?:'|’)?\s*(?:of\s+)?(?:[\w,/&-]+\s+){0,5}?experience/g, m => ({ min: +m[1], max: null })],
  ];
  const earliest = src => {
    let best = null;
    for (const [re, mk] of PATTERNS) {
      re.lastIndex = 0;
      for (const m of src.matchAll(re)) {
        if (+m[1] > 25 || (m[2] && +m[2] > 25)) continue;
        const after = src.slice(m.index + m[0].length, m.index + m[0].length + 40); const before = src.slice(Math.max(0, m.index - 30), m.index);
        if (BAD_AFTER.test(after) || BAD_BEFORE.test(before)) continue;
        const r = mk(m); if (r && (!best || m.index < best.at)) best = { ...r, at: m.index };
        break;
      }
    }
    return best && { min: best.min, max: best.max };
  };
  const reqText = norm(text.split('\n').filter(l => /year|yrs/i.test(l)).join('\n'));
  const r = earliest(norm(exp)) || earliest(norm(title)) || earliest(reqText);
  if (r) return r;
  const s = `${title}\n${text}`.toLowerCase();
  if (/any \(new grads ok\)|new grads? ok/.test(exp.toLowerCase())) return { min: 0, max: null }; // "new grads ok" is a floor, not a cap
  if (level === 'Intern') return { min: 0, max: 0 };
  if (level === 'Entry' || /\b(new grad|fresher|no experience required|entry[- ]level|recent graduate)/.test(s)) return { min: 0, max: 1 };
  return null;
}

export const VISA = ['Sponsors visa', 'No sponsorship', 'Citizens / clearance only', 'Not stated'];
export function visaOf(text = '') {
  const s = text.toLowerCase();
  // YC Work at a Startup structured lines
  if (/^us citizenship\/visa not required$/m.test(s)) return 'Sponsors visa';
  if (/^us citizen\/visa only$/m.test(s)) return 'No sponsorship';
  if (/^sponsorship: offers sponsorship$/m.test(s)) return 'Sponsors visa';
  if (/^sponsorship: does not offer sponsorship$/m.test(s)) return 'No sponsorship';
  if (/^sponsorship: u\.s\. citizenship is required$/m.test(s)) return 'Citizens / clearance only';
  if (/^will sponsor/m.test(s)) return 'Sponsors visa';
  if (/(u\.?s\.? citizenship (?:is )?required|must be a u\.?s\.? citizen|us citizens? only|citizens only|security clearance(?!:? not required)|clearance (?:is )?required|active (?:secret|ts|top secret) clearance|ts\/sci|(?:must|required to|need to|to) (?:be|qualify as|meet the definition of) an? u\.?s\.? person|(?:\bitar\b|export control)[^.]{0,80}(?:u\.?s\.? persons?|citizen)|(?:u\.?s\.? persons?|citizen)[^.]{0,80}(?:\bitar\b|export control))/.test(s)) return 'Citizens / clearance only';
  const noSponsor = /(does not offer (?:visa |immigration )?sponsorship|(?:does|do) not (?:offer|provide) (?:visa |immigration )?sponsorship|not (?:currently )?(?:able|in a position) to (?:offer |provide )?(?:visa |immigration )?sponsor|unable to (?:offer |provide )?(?:visa |work )?sponsor|unable to support[^.]{0,60}(?:h-?1b|visa|sponsor)|cannot (?:offer |provide )?(?:employment )?(?:visa )?sponsor|can't sponsor|no (?:visa )?sponsorship|ineligible for[^.]{0,30}sponsorship|not require[^.]{0,30}sponsorship|without (?:requiring |the need for |needing )?(?:current or future )?(?:visa |employer |immigration )?sponsorship(?! for an export)|we (?:can't|cannot|do not|don't|will not|won't) sponsor|sponsorship is not available|not eligible for (?:visa |employer[- ]sponsored )?(?:sponsorship|immigration)|h-?1b[^.]{0,40}(?:cannot|can't|not) be supported|do not provide visa (?:assistance|support)|must be (?:legally )?authori[sz]ed to work .{0,60}without|not sponsor(?:ing)? (?:visas|work authorization))/;
  if (noSponsor.test(s)) return 'No sponsorship';
  if (/(offers sponsorship|visa sponsorship (?:is |are )?(?:available|provided|offered)|will sponsor|we (?:do )?sponsor visas|we sponsor|sponsorship (?:is |may be )?available|h-?1b sponsor|open to sponsor|can sponsor|relocation and visa|visa support (?:is )?(?:available|provided|offered)|(?:provide|offer)s? visa support|^[•\-* ]*visa sponsorship\s*$|sponsorship[^.]{0,40}may be available)/m.test(s)) return 'Sponsors visa';
  return 'Not stated';
}

export function workModeOf(location = '', text = '', remote) {
  const l = location.toLowerCase(); const s = text.toLowerCase();
  // The location field is explicit; the description often carries company-wide boilerplate.
  if (/\bhybrid\b/.test(l)) return 'Hybrid';
  if (remote || /\b(remote|anywhere|work from home|wfh)\b/.test(l)) return 'Remote';
  if (/\b(this (?:is a )?(?:role|position|job) is hybrid|hybrid (?:role|position)|\d days? (?:a|per) week in (?:the |our )?office|\d days? in (?:the |our )?office|in[- ]office \d days|\(hybrid\))/.test(s.slice(0, 5000))) return 'Hybrid';
  if (/\b(on-?site|in[- ]office|in person)\b/.test(l + ' ' + s.slice(0, 1500))) return 'On-site';
  if (l && !/remote/.test(l)) return 'On-site';
  return 'Not stated';
}

export function degreesOf(text = '') {
  const hint = text.match(/Degrees?:\s*([^\n]+)/i)?.[1] || '';
  const s = (hint + ' ' + text.slice(0, 8000)).toLowerCase();
  const out = new Set();
  if (/\b(bachelor'?s?|b\.s\.|b\.sc|bsc\b|b\.tech|btech\b|b\.e\.|undergraduate degree|4-year degree|four-year degree)/.test(s)) out.add("Bachelor's");
  if (/\b(master'?s(?! of none)|m\.s\.|\bms (?:in|degree|\/)|m\.tech|mtech\b|msc\b|m\.sc|mba\b|graduate degree)/.test(s) && !/scrum master|master (?:data|plan|schedule|service)/.test(s.match(/.{0,20}master.{0,20}/)?.[0] || '')) out.add("Master's");
  if (/\b(ph\.?d|doctorate|doctoral)/.test(s)) out.add('PhD');
  if (/\b(no degree (?:required|needed|necessary)|degree (?:is )?not required|without a degree|don'?t need a degree|self-taught (?:engineers )?welcome|bootcamp grads? welcome)/.test(s)) out.add('No degree required');
  return [...out];
}

// Rough FX to USD so pay can be filtered on one scale. Displayed values stay in original currency.
const FX = { usd: 1, '$': 1, eur: 1.08, '€': 1.08, gbp: 1.27, '£': 1.27, inr: 0.012, '₹': 0.012, rs: 0.012, cad: 0.73, aud: 0.66, sgd: 0.75, chf: 1.13, php: 0.017, zar: 0.055, jpy: 0.0067, pln: 0.25, sek: 0.095, nzd: 0.6, aed: 0.27 };
/** -> { min, max } in USD thousands per year, or null. */
export function payOf(salary = '', intern = false) {
  if (!salary) return null;
  const s = salary.toLowerCase().replace(/,/g, '').replace(/\s+/g, ' ');
  if (/(\d\s*(?:m|b|bn|billion|trillion)\b(?! ?per)|raised|funding|aum|valuation)/.test(s) && !/(lakh|lpa|crore|cr\b)/.test(s)) return null;
  const code = s.match(/\b(usd|eur|gbp|inr|cad|aud|sgd|chf|php|zar|jpy|pln|sek|nzd|aed|sar|qar|kwd|hkd|cny|brl|mxn|krw|myr|thb|idr|vnd|ngn|kes|egp|try)\b/)?.[1];
  if (code && !(code in FX)) return null; // a currency we can't convert: don't guess
  let cur = code || s.match(/(\brs\b\.?|[$€£₹])/)?.[1]?.replace('.', '') || '$';
  if (/\b(lpa|lakhs?|crores?|cr)\b/.test(s)) cur = 'inr';
  const unitRe = /(\d+(?:\.\d+)?)[ \t]?(k|lpa|lakhs?|l|crores?|cr|mn|million)?\b/g;
  let nums = [...s.matchAll(unitRe)].map(m => ({ v: parseFloat(m[1]), u: m[2] || '' })).filter(x => x.v >= 1);
  const lastUnit = [...nums].reverse().find(x => x.u)?.u || '';
  nums = nums.map(x => ({ ...x, u: x.u || (x.v < 1000 ? lastUnit : '') })); // "12-18 LPA", "$120-150k"
  const val = ({ v, u }) => u === 'k' ? v * 1e3 : /^(l|lpa|lakh|lakhs)$/.test(u) ? v * 1e5 : /^(cr|crore|crores)$/.test(u) ? v * 1e7 : /^(mn|million)$/.test(u) ? v * 1e6 : v;
  const vals = nums.map(val).filter(v => v >= 10).slice(0, 2);
  if (!vals.length) return null;
  let mult = 1;
  if (/(\/|per|an?)\s*(hour|hr)\b|hourly|\/h\b/.test(s)) mult = 2080; else if (/(\/|per|an?)\s*(month|mo)\b|monthly|p\.?m\.?\b/.test(s)) mult = 12; else if (/(\/|per|an?)\s*week|weekly/.test(s)) mult = 52;
  const fx = FX[cur] ?? 1;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo > 0 && hi / lo >= 6) return null; // placeholder ranges like "$1K–$100K"
  if (mult === 1 && hi < 1000) { if (lo >= 15 && hi <= 150 && FX[cur] >= 0.5 && vals.length === 2) mult = 2080; else return null; } // "$45 - $60" reads as hourly; a bare "$180" or "$15" is ambiguous
  if (mult === 1 && !intern && hi * (FX[cur] ?? 1) < 10000) return null; // a bare "$1,500" with no period isn't a salary we can trust
  if (mult === 1 && intern && hi >= 1000 && hi * (FX[cur] ?? 1) <= 15000) mult = 12; // intern stipends like "$5K–$7.5K" are monthly
  const toK = v => Math.round(v * mult * fx / 1000);
  const r = { min: toK(lo), max: toK(hi) };
  return r.min > 0 && r.max < 1500 ? r : null;
}

export function termsOf(text = '') {
  const hint = text.match(/Terms?:\s*([^\n]+)/i)?.[1];
  const src = hint || text.slice(0, 400);
  return [...new Set([...src.matchAll(/\b(Summer|Fall|Winter|Spring)\s*(20\d\d)/gi)].map(m => `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}`))];
}

/** Compute all deep attributes for a job record (always recomputed; cheap). */
export function deepAttributes(job) {
  const text = job.description || '';
  const specialty = classifyRole(job.title, text);
  const yrs = yearsOf(job.title, text, job.level);
  return {
    specialty, field: FIELD_OF[specialty] || 'Other',
    yearsMin: yrs?.min ?? null, yearsMax: yrs?.max ?? null,
    visa: visaOf(`${job.title}\n${text}`),
    workMode: workModeOf(`${job.location || ''} ${(job.title.match(/\((hybrid|remote|on-?site)\)|\b(hybrid|remote)\b/i) || [''])[0]}`, text, job.remote),
    degrees: degreesOf(text),
    pay: payOf(job.salary, job.type === 'Internship'),
    terms: termsOf(text),
  };
}
