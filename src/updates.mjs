// Updates from the project on GitHub, so a copy of Lookout opened years from now is still current:
//   - the board list (starter/sources.json): new company boards, monthly from Common Crawl and community lists,
//     added without a new version of the app;
//   - the vocabulary (starter/vocab.json): words that mark new kinds of computing work, for the same reason;
//   - a notice when a new version of the app itself is out, with the link to download it.
// Only public files of the project are read, over HTTPS, at most once a day each. Nothing is sent about you.
import { getJson } from './util.mjs';
import { githubClient } from './github.mjs';

export const REPO = 'FalconFuryX77/Lookout';
const RAW = `https://raw.githubusercontent.com/${REPO}/main/`;

/** The project's current board list, or null when it has not changed since the last check. */
export async function fetchBoardList() {
  const { data, changed } = await getJson(`${RAW}starter/sources.json`, { timeout: 60000 });
  if (!changed) return null;
  if (!data || data.lookout !== 'sources' || !Array.isArray(data.boards)) throw new Error('the board list on GitHub is not a Lookout sources file');
  return data;
}

/** Extra vocabulary, or null when unchanged: { version, computingTitleWords: [...] }. */
export async function fetchVocab() {
  const { data, changed } = await getJson(`${RAW}starter/vocab.json`, { timeout: 30000 });
  if (!changed) return null;
  if (!data || data.lookout !== 'vocab') throw new Error('the vocabulary on GitHub is not a Lookout vocabulary file');
  return data;
}

const parts = v => String(v || '').replace(/^v/i, '').split(/[.-]/).map(x => Number.parseInt(x, 10) || 0);
/** Is version a newer than version b? ("2.10.0" > "2.9.3") */
export function newer(a, b) { const x = parts(a), y = parts(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; }

/** The latest published release: { version, name, url, notes, publishedAt, assets }. */
export async function latestRelease() {
  const r = await githubClient().api(`/repos/${REPO}/releases/latest`);
  if (!r?.tag_name) return null;
  return { version: r.tag_name.replace(/^v/i, ''), name: r.name || r.tag_name, url: r.html_url, notes: String(r.body || '').slice(0, 4000), publishedAt: r.published_at, assets: (r.assets || []).map(a => ({ name: a.name, url: a.browser_download_url, size: a.size })) };
}
