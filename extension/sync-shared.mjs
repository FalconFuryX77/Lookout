// Copies the code the extension shares with Lookout (skill vocabulary, skill reading, fit) into extension/lib,
// so the extension can compare a page with your skills even while Lookout is closed. Run after changing
// public/skills.mjs or public/filters.mjs:   node extension/sync-shared.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(path.join(here, 'lib'), { recursive: true });
for (const f of ['skills.mjs', 'filters.mjs']) {
  const src = fs.readFileSync(path.join(here, '..', 'public', f), 'utf8');
  fs.writeFileSync(path.join(here, 'lib', f), `// Copied from public/${f} by sync-shared.mjs. Edit the original, not this file.\n${src}`);
}
console.log('extension/lib is up to date');
