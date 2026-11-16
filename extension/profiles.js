// Profile pages Lookout can learn skills from. Shared by the background rules (which mark the toolbar icon)
// and the panel (which reads the page when you click). LinkedIn is listed so the panel can point you to its
// "Save to PDF" instead: LinkedIn profiles are not read.
export const PROFILE_SITES = [
  { id: 'github', name: 'GitHub', host: 'github.com', re: /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/?(?:\?.*)?$/, rule: '^https://github\\.com/[A-Za-z0-9-]+/?(\\?.*)?$', not: /^(about|features|pricing|login|join|sponsors|orgs|topics|collections|trending|explore|marketplace|settings|notifications|enterprise|apps|search|security|readme|events|codespaces|issues|pulls|new|organizations|dashboard)$/i },
  { id: 'gitlab', name: 'GitLab', host: 'gitlab.com', re: /^https:\/\/gitlab\.com\/([A-Za-z0-9_.-]+)\/?(?:\?.*)?$/, rule: '^https://gitlab\\.com/[A-Za-z0-9_.-]+/?(\\?.*)?$', not: /^(explore|users|help|dashboard|projects|groups|search|-)$/i },
  { id: 'huggingface', name: 'Hugging Face', host: 'huggingface.co', re: /^https:\/\/huggingface\.co\/([A-Za-z0-9_.-]+)\/?(?:\?.*)?$/, rule: '^https://huggingface\\.co/[A-Za-z0-9_.-]+/?(\\?.*)?$', not: /^(models|datasets|spaces|docs|blog|papers|learn|pricing|join|login|settings|organizations|posts|chat|enterprise|tasks|collections|new|notifications|inference-endpoints|privacy|terms)$/i },
  { id: 'stackoverflow', name: 'Stack Overflow', host: 'stackoverflow.com', re: /^https:\/\/stackoverflow\.com\/users\/(\d+)(?:\/[^/?#]*)?\/?(?:\?.*)?$/, rule: '^https://stackoverflow\\.com/users/[0-9]+(/[^/?#]*)?/?(\\?.*)?$' },
  { id: 'kaggle', name: 'Kaggle', host: 'www.kaggle.com', re: /^https:\/\/www\.kaggle\.com\/([A-Za-z0-9_-]+)\/?(?:\?.*)?$/, rule: '^https://www\\.kaggle\\.com/[A-Za-z0-9_-]+/?(\\?.*)?$', not: /^(competitions|datasets|code|models|learn|discussions|discussion|docs|account|settings|search|c|benchmarks|rankings|contact|terms|privacy|work|organizations)$/i },
  { id: 'leetcode', name: 'LeetCode', host: 'leetcode.com', re: /^https:\/\/leetcode\.com\/(?:u\/)?([A-Za-z0-9_-]+)\/?(?:\?.*)?$/, rule: '^https://leetcode\\.com/(u/)?[A-Za-z0-9_-]+/?(\\?.*)?$', not: /^(problems|problemset|contest|discuss|explore|study-plan|interview|store|accounts|subscribe|jobs|assessment|support|terms|privacy|u)$/i },
  { id: 'devpost', name: 'Devpost', host: 'devpost.com', re: /^https:\/\/devpost\.com\/([A-Za-z0-9_-]+)\/?(?:\?.*)?$/, rule: '^https://devpost\\.com/[A-Za-z0-9_-]+/?(\\?.*)?$', not: /^(software|hackathons|settings|portfolio|users|about|help|teams|login|search|api)$/i },
  { id: 'devto', name: 'DEV', host: 'dev.to', re: /^https:\/\/dev\.to\/([A-Za-z0-9_]+)\/?(?:\?.*)?$/, rule: '^https://dev\\.to/[A-Za-z0-9_]+/?(\\?.*)?$', not: /^(t|top|latest|search|settings|dashboard|enter|about|faq|privacy|terms|code-of-conduct|listings|podcasts|videos|tags|readinglist|notifications)$/i },
  { id: 'medium', name: 'Medium', host: 'medium.com', re: /^https:\/\/medium\.com\/@([A-Za-z0-9_.-]+)\/?(?:\?.*)?$/, rule: '^https://medium\\.com/@[A-Za-z0-9_.-]+/?(\\?.*)?$' },
  { id: 'codeforces', name: 'Codeforces', host: 'codeforces.com', re: /^https:\/\/codeforces\.com\/profile\/([A-Za-z0-9_.-]+)\/?(?:\?.*)?$/, rule: '^https://codeforces\\.com/profile/[A-Za-z0-9_.-]+/?(\\?.*)?$' },
  { id: 'hackerrank', name: 'HackerRank', host: 'www.hackerrank.com', re: /^https:\/\/www\.hackerrank\.com\/(?:profile\/)?([A-Za-z0-9_.-]+)\/?(?:\?.*)?$/, rule: '^https://www\\.hackerrank\\.com/profile/[A-Za-z0-9_.-]+/?(\\?.*)?$', not: /^(dashboard|domains|contests|jobs|skills-verification|interview|certify|work|login|signup|auth|leaderboard|blog|profile)$/i },
  { id: 'codechef', name: 'CodeChef', host: 'www.codechef.com', re: /^https:\/\/www\.codechef\.com\/users\/([A-Za-z0-9_.-]+)\/?(?:\?.*)?$/, rule: '^https://www\\.codechef\\.com/users/[A-Za-z0-9_.-]+/?(\\?.*)?$' },
  { id: 'behance', name: 'Behance', host: 'www.behance.net', re: /^https:\/\/www\.behance\.net\/([A-Za-z0-9_-]+)\/?(?:\?.*)?$/, rule: '^https://www\\.behance\\.net/[A-Za-z0-9_-]+/?(\\?.*)?$', not: /^(search|galleries|joblist|assets|about|onboarding|hire|live|for_you|pro)$/i },
  { id: 'dribbble', name: 'Dribbble', host: 'dribbble.com', re: /^https:\/\/dribbble\.com\/([A-Za-z0-9_-]+)\/?(?:\?.*)?$/, rule: '^https://dribbble\\.com/[A-Za-z0-9_-]+/?(\\?.*)?$', not: /^(shots|designers|jobs|tags|search|session|signup|pro|stories|learn|hiring|resources|following|about|terms|privacy|marketplace)$/i },
];

/** { site, name, user } when the address is someone's profile on one of these sites; LinkedIn gives { site: 'linkedin' }. */
export function profileSiteOf(url) {
  const u = String(url || '').replace(/#.*$/, '');
  if (/^https:\/\/(?:[a-z]{2,3}\.|www\.)?linkedin\.com\/in\/[^/?#]+/i.test(u)) return { site: 'linkedin', name: 'LinkedIn', user: '' };
  for (const s of PROFILE_SITES) { const m = u.match(s.re); if (m && !(s.not && s.not.test(m[1]))) return { site: s.id, name: s.name, user: m[1] }; }
  return null;
}
