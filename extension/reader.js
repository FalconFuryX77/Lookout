// Reads the job posting on the current page. Injected into the page only when you click the Lookout button,
// so it must stay self-contained: no imports, no outside variables.
//
// Most careers sites embed a schema.org "JobPosting" block for search engines (Workday, Greenhouse, Lever,
// iCIMS, Oracle, SmartRecruiters, LinkedIn's public pages...). That is read first. LinkedIn's signed-in view
// and Indeed get a few known selectors. Anything else falls back to the page's main text.
export function readJobPage() {
  // names in job data often carry HTML entities (&#x27;, &amp;); decode them without running anything
  const decode = s => { const t = String(s ?? ''); return /&[#\w]+;/.test(t) ? (new DOMParser().parseFromString(t, 'text/html').documentElement.textContent || t) : t; };
  const clean = s => decode(s).replace(/\s+/g, ' ').trim();
  const firstText = (...sel) => { for (const q of sel) { const el = document.querySelector(q); if (el && clean(el.textContent)) return clean(el.textContent); } return ''; };
  // HTML from a JSON-LD description, turned into text in an inert document (nothing in it runs or loads)
  const htmlToText = html => {
    const marked = String(html || '').replace(/<\s*li\b[^>]*>/gi, '\n• ').replace(/<\s*(br|\/p|\/li|\/h[1-6]|\/div|\/tr|\/ul|\/ol)\b[^>]*>/gi, '\n');
    const doc = new DOMParser().parseFromString(marked, 'text/html');
    return (doc.body?.textContent || '').replace(/[ \t ]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
  };
  const blockText = el => (el?.innerText || '').replace(/[ \t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const meta = n => document.querySelector(`meta[property="${n}"], meta[name="${n}"]`)?.content || '';
  const out = { url: location.href, title: '', company: '', location: '', description: '', datePosted: '', employmentType: '', seniority: '', how: 'page' };

  // 1. structured job data
  const postings = [];
  const walk = x => { if (!x || typeof x !== 'object') return; if (Array.isArray(x)) return x.forEach(walk); const t = [].concat(x['@type'] || []); if (t.includes('JobPosting')) postings.push(x); if (x['@graph']) walk(x['@graph']); };
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) { try { walk(JSON.parse(s.textContent)); } catch { /* malformed block: skip */ } }
  const jp = postings[0];
  if (jp) {
    const org = jp.hiringOrganization; const places = [].concat(jp.jobLocation || []);
    const placeText = places.map(p => { const a = p?.address || {}; const country = typeof a.addressCountry === 'object' ? a.addressCountry?.name : a.addressCountry; return [a.addressLocality, a.addressRegion, country].filter(Boolean).join(', '); }).filter(Boolean);
    const remote = [].concat(jp.jobLocationType || []).some(t => /telecommute/i.test(t));
    const exp = jp.experienceRequirements; const months = typeof exp === 'object' ? Number(exp?.monthsOfExperience) : NaN;
    Object.assign(out, {
      how: 'structured', title: clean(jp.title), company: clean(typeof org === 'string' ? org : org?.name),
      location: [...new Set(placeText)].slice(0, 4).join('; ') + (remote ? (placeText.length ? ' (Remote)' : 'Remote') : ''),
      datePosted: clean(jp.datePosted), employmentType: [].concat(jp.employmentType || []).join(', '),
      description: [htmlToText(jp.description), typeof exp === 'string' ? `Experience: ${exp}` : '', Number.isFinite(months) && months > 0 ? `Experience: ${Math.round(months / 12 * 10) / 10}+ years` : '', typeof jp.educationRequirements === 'string' ? `Education: ${jp.educationRequirements}` : jp.educationRequirements?.credentialCategory ? `Education: ${jp.educationRequirements.credentialCategory}` : ''].filter(Boolean).join('\n\n'),
    });
  }

  // 2. sites known not to carry it while you are signed in
  const host = location.hostname.replace(/^www\./, '');
  if (/(^|\.)linkedin\.com$/.test(host)) {
    // the same role always has the same address on LinkedIn, so Lookout can tell whether it already has it
    const id = new URLSearchParams(location.search).get('currentJobId') || (location.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/) || [])[1];
    if (id) out.url = `https://www.linkedin.com/jobs/view/${id}`;
    if (!jp) Object.assign(out, { how: 'site',
      title: firstText('.job-details-jobs-unified-top-card__job-title', '.jobs-unified-top-card__job-title', '.top-card-layout__title', 'h1'),
      company: firstText('.job-details-jobs-unified-top-card__company-name', '.jobs-unified-top-card__company-name', '.topcard__org-name-link'),
      location: firstText('.job-details-jobs-unified-top-card__primary-description-container .tvm__text', '.jobs-unified-top-card__bullet', '.topcard__flavor--bullet'),
      description: blockText(document.querySelector('#job-details, .jobs-description__content, .description__text')),
    });
    const crit = [...document.querySelectorAll('.description__job-criteria-item, .job-details-preferences-and-skills__pill')].map(el => clean(el.textContent)).join(' | ');
    if (/seniority level/i.test(crit)) out.seniority = (crit.match(/seniority level\s*([^|]+)/i) || [])[1]?.trim() || '';
  } else if (/(^|\.)indeed\.[a-z.]+$/.test(host) && !jp) {
    Object.assign(out, { how: 'site', title: firstText('[data-testid="jobsearch-JobInfoHeader-title"]', '.jobsearch-JobInfoHeader-title', 'h1'), company: firstText('[data-testid="inlineHeader-companyName"]', '[data-company-name]'), location: firstText('[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]'), description: blockText(document.querySelector('#jobDescriptionText')) });
  }

  // 3. anything else: the page's main text, skipping navigation, footers and "similar jobs" sidebars
  if (!out.description || out.description.length < 200) {
    const candidates = [...document.querySelectorAll('main, article, [role="main"], #content, .content, section, div')].filter(el => !el.closest('nav, footer, header, aside'));
    let best = null, bestScore = 0;
    for (const el of candidates.slice(0, 4000)) { const t = el.innerText || ''; if (t.length < 300) continue; const blocks = el.querySelectorAll('p, li').length; const score = Math.min(t.length, 20000) * (1 + Math.min(blocks, 40) / 20) / (1 + el.querySelectorAll('a').length / 25); if (score > bestScore) { bestScore = score; best = el; } }
    if (best) out.description = blockText(best);
    // the first real heading: skip "browser not supported" or "enable JavaScript" banners
    out.title ||= [...document.querySelectorAll('h1')].map(h => clean(h.textContent)).find(t => t && t.length < 200 && !/internet explorer|not supported|enable javascript|cookies|sign in/i.test(t)) || clean(meta('og:title')) || clean(document.title);
    // "Job Application for X at Acme", or the company's name in a careers-system address (job-boards.greenhouse.io/acme/...)
    const fromTitle = (document.title.match(/\bat\s+([^|–—]+?)\s*(?:[|–—]|$)/) || [])[1];
    const slug = /(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com)$/.test(host) ? location.pathname.split('/').filter(Boolean)[0] : '';
    out.company ||= clean(meta('og:site_name')) || clean(fromTitle) || (slug ? slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '') || host;
  }
  out.description = out.description.slice(0, 30000);
  out.title = out.title.slice(0, 200); out.company = out.company.slice(0, 120);
  out.looksLikeJob = !!jp || /\b(responsibilit|requirement|qualification|apply|experience|what you'?ll|about the role|job description)/i.test(out.description.slice(0, 6000));
  return out;
}
