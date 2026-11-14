// Applicant-tracking-system detection and polling. Polling a company's own ATS is the
// fastest trustworthy signal: the posting appears there before any aggregator copies it.
import { getText, getJson, htmlToText, toIso, precisionOf, decodeEntities } from './util.mjs';

const DETECT = [
  ['greenhouse', /(?:boards|job-boards)(?:-api)?\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=|v1\/boards\/)?([A-Za-z0-9_-]+)/i],
  ['lever', /jobs\.lever\.co\/([A-Za-z0-9_.-]+)/i],
  ['ashby', /jobs\.ashbyhq\.com\/([A-Za-z0-9_.%-]+)/i],
  ['workable', /apply\.workable\.com\/(?!api)([A-Za-z0-9_-]+)/i],
  ['smartrecruiters', /(?:careers|jobs)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/i],
  ['recruitee', /([A-Za-z0-9-]+)\.recruitee\.com/i],
];
const BAD_SLUGS = new Set(['embed', 'js', 'api', 'v1', 'jobs', 'careers', 'static', 'assets', 'www', 'boards', 'job_board', 'cdn']);

export function detectInText(text) {
  for (const [provider, re] of DETECT) {
    const m = String(text).match(re);
    if (m && m[1] && !BAD_SLUGS.has(m[1].toLowerCase())) return { provider, board: decodeURIComponent(m[1]).replace(/\.$/, '') };
  }
  return null;
}

/** Look at the company site + its careers pages and find which ATS it uses. */
export async function detectAts(website, nameHint = '') {
  if (!website) return null;
  const origin = new URL(website).origin;
  for (const p of ['', '/careers', '/jobs', '/careers/', '/company/careers', '/join', '/join-us']) {
    try {
      const r = await getText(origin + p, { timeout: 9000, conditional: false, headers: { accept: 'text/html' } });
      const hit = detectInText(r.url) || detectInText(r.body);
      if (hit) return hit;
    } catch { }
  }
  // Fallback: probe the public APIs with slugs derived from the domain / name.
  const base = new URL(website).hostname.replace(/^www\./, '').split('.')[0];
  const slugs = [...new Set([base, nameHint.toLowerCase().replace(/[^a-z0-9]/g, ''), nameHint.toLowerCase().trim().replace(/\s+/g, '-')].filter(s => s && s.length > 1))];
  for (const board of slugs) for (const provider of ['ashby', 'greenhouse', 'lever']) {
    try { const jobs = await fetchBoard({ provider, board }); if (jobs.length) return { provider, board }; } catch { }
  }
  return null;
}

/** Fetch all current postings of one ATS board as normalized postings (minus `source`). */
export async function fetchBoard({ provider, board, company }) {
  const b = encodeURIComponent(board);
  if (provider === 'greenhouse') {
    const { data } = await getJson(`https://boards-api.greenhouse.io/v1/boards/${b}/jobs?content=true`, { timeout: 15000 });
    return (data.jobs || []).map(j => ({
      sourceJobId: `gh:${board}:${j.id}`, title: j.title, company: company || j.company_name || board,
      url: j.absolute_url, location: j.location?.name || '', description: htmlToText(j.content || ''),
      // Greenhouse only exposes updated_at; first_published exists on newer boards.
      postedAt: toIso(j.first_published || j.updated_at), precision: j.first_published ? 'minute' : 'date',
    }));
  }
  if (provider === 'lever') {
    const { data } = await getJson(`https://api.lever.co/v0/postings/${b}?mode=json`, { timeout: 15000 });
    return (Array.isArray(data) ? data : []).map(j => ({
      sourceJobId: `lever:${board}:${j.id}`, title: j.text, company: company || board, url: j.hostedUrl, applyUrl: j.applyUrl,
      location: [j.categories?.location, ...(j.categories?.allLocations || [])].filter(Boolean).join('; '),
      typeHint: j.categories?.commitment || '', remote: j.workplaceType === 'remote' ? true : undefined,
      description: [j.descriptionPlain, ...(j.lists || []).map(l => `${l.text}\n${htmlToText(l.content)}`), j.additionalPlain].filter(Boolean).join('\n\n'),
      postedAt: toIso(j.createdAt), precision: 'minute', salary: j.salaryRange ? `${j.salaryRange.currency || ''} ${j.salaryRange.min}–${j.salaryRange.max} ${j.salaryRange.interval || ''}`.trim() : '',
    }));
  }
  if (provider === 'ashby') {
    const { data } = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${b}?includeCompensation=true`, { timeout: 15000 });
    return (data.jobs || []).filter(j => j.isListed !== false).map(j => ({
      sourceJobId: `ashby:${board}:${j.id || j.jobUrl}`, title: j.title, company: company || board, url: j.jobUrl, applyUrl: j.applyUrl,
      location: [j.location, ...(j.secondaryLocations || []).map(l => l.location)].filter(Boolean).join('; '),
      remote: j.isRemote, typeHint: j.employmentType || '', description: j.descriptionPlain || htmlToText(j.descriptionHtml || ''),
      postedAt: toIso(j.publishedAt), precision: precisionOf(j.publishedAt), salary: j.compensation?.compensationTierSummary || '',
    }));
  }
  if (provider === 'workable') {
    const { data } = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${b}?details=true`, { timeout: 15000 });
    return (data.jobs || []).map(j => ({
      sourceJobId: `workable:${board}:${j.shortcode}`, title: j.title, company: company || data.name || board, url: j.url || j.shortlink,
      location: [j.city, j.state, j.country].filter(Boolean).join(', '), remote: j.telecommuting, typeHint: j.employment_type || '',
      description: htmlToText(j.description || ''), postedAt: toIso(j.published_on || j.created_at), precision: precisionOf(j.published_on || j.created_at),
    }));
  }
  if (provider === 'smartrecruiters') {
    const { data } = await getJson(`https://api.smartrecruiters.com/v1/companies/${b}/postings?limit=100`, { timeout: 15000 });
    return (data.content || []).map(j => ({
      sourceJobId: `sr:${board}:${j.id}`, title: j.name, company: company || j.company?.name || board, url: `https://jobs.smartrecruiters.com/${board}/${j.id}`,
      location: [j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(', '), remote: j.location?.remote,
      typeHint: j.typeOfEmployment?.label || '', description: `${j.department?.label || ''} ${j.function?.label || ''}`.trim(),
      postedAt: toIso(j.releasedDate), precision: 'minute',
    }));
  }
  if (provider === 'recruitee') {
    const { data } = await getJson(`https://${b}.recruitee.com/api/offers/`, { timeout: 15000 });
    return (data.offers || []).map(j => ({
      sourceJobId: `recruitee:${board}:${j.id}`, title: j.title, company: company || j.company_name || board, url: j.careers_url,
      location: j.location || [j.city, j.country].filter(Boolean).join(', '), remote: j.remote, typeHint: j.employment_type_code || '',
      description: htmlToText(`${j.description || ''}\n${j.requirements || ''}`), postedAt: toIso((j.published_at || j.created_at || '').replace(' UTC', 'Z').replace(' ', 'T')), precision: 'minute',
    }));
  }
  if (provider === 'yc') {
    // YC company profile embeds that company's Work at a Startup postings.
    const { body } = await getText(`https://www.ycombinator.com/companies/${b}`, { timeout: 15000, headers: { accept: 'text/html' } });
    const m = body.match(/data-page="([^"]+)"/); if (!m) return [];
    const page = JSON.parse(decodeEntities(m[1])); const c = page.props?.company || {};
    return (page.props?.jobPostings || []).map(j => ({
      sourceJobId: `yc:${j.id}`, title: j.title, company: company || j.companyName || c.name, url: new URL(j.url, 'https://www.ycombinator.com').href,
      companyUrl: c.website || '', location: j.location || '', typeHint: j.type || '',
      description: [j.prettyRole, j.roleSpecificType, j.minExperience && `Experience: ${j.minExperience}`, j.salaryRange && `Salary: ${j.salaryRange}`, j.equityRange && `Equity: ${j.equityRange}`, j.visa, c.one_liner].filter(Boolean).join('\n'),
      skills: (j.skills || []).map(s => ({ name: typeof s === 'string' ? s : s.name, group: 'Listed' })), salary: j.salaryRange || '',
      postedAt: toIso(j.createdAt || j.created_at), precision: precisionOf(j.createdAt || j.created_at),
      companyMeta: { yc: j.companyBatchName || c.batch_name, funded: true, ycSlug: board, website: c.website },
    }));
  }
  throw new Error(`Unsupported ATS ${provider}`);
}

export const ATS_PROVIDERS = ['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'recruitee', 'yc'];
