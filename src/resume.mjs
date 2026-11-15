// Résumé import, entirely on this computer: file -> plain text -> profile fields.
// Reads PDF (text-based, not scans), Word .docx, and plain text. No libraries, nothing is uploaded anywhere.
import zlib from 'node:zlib';
import { extractSkills } from './enrich.mjs';
import { skillInfo } from '../public/skills.mjs';
import { decodeEntities } from './util.mjs';

// ───────────────────────────────────────────── file -> text
export function resumeText(buf, filename = '') {
  const head = buf.subarray(0, 5).toString('latin1');
  if (head.startsWith('%PDF')) return tidy(pdfText(buf));
  if (head.startsWith('PK')) return tidy(docxText(buf));
  if (/\.(doc|rtf|odt|pages)$/i.test(filename) || buf.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) throw new Error('That format is not supported. Save the résumé as PDF or .docx, or paste its text.');
  return tidy(buf.toString('utf8'));
}
const tidy = s => String(s).normalize('NFKC').replace(/\r/g, '').replace(/[​­]/g, '').replace(/[ \t ]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// --- .docx: a zip holding word/document.xml
function docxText(buf) {
  let eocd = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('That file is not a readable .docx.');
  let p = buf.readUInt32LE(eocd + 16); const n = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < n && buf.readUInt32LE(p) === 0x02014b50; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8').replace(/\\/g, '/');
    if (name === 'word/document.xml') {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const raw = buf.subarray(start, start + csize);
      const xml = (method === 0 ? raw : zlib.inflateRawSync(raw)).toString('utf8');
      return decodeEntities(xml.replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>|<\/w:p>|<\/w:tr>/g, '\n').replace(/<\/w:tc>/g, ' | ').replace(/<[^>]+>/g, ''));
    }
    p += 46 + nameLen + extra + comment;
  }
  throw new Error('That .docx has no document text in it.');
}

// --- PDF: inflate the streams, map each font's codes to Unicode, walk the text operators
function pdfText(buf) {
  const s = buf.toString('latin1');
  if (/\/Encrypt\s+\d+\s+\d+\s+R/.test(s)) throw new Error('That PDF is password-protected. Export an unprotected copy, or paste the text.');
  const objs = new Map(); // id -> { dict, stream? (Buffer) }
  const re = /(\d+)\s+(\d+)\s+obj\b/g; let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length; const end = s.indexOf('endobj', start); if (end < 0) break;
    let body = s.slice(start, end); let stream = null;
    const st = body.match(/stream\r?\n/);
    if (st) {
      const dataStart = start + st.index + st[0].length; const dict = body.slice(0, st.index);
      const len = Number(dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/)?.[1]);
      let dataEnd = Number.isFinite(len) && /^\s*endstream/.test(s.slice(dataStart + len, dataStart + len + 12)) ? dataStart + len : s.indexOf('endstream', dataStart);
      if (dataEnd < 0) dataEnd = end;
      stream = buf.subarray(dataStart, dataEnd); body = dict;
      const after = s.indexOf('endobj', dataEnd); if (after > end) re.lastIndex = after;
    }
    objs.set(Number(m[1]), { dict: body, stream });
  }
  const inflate = o => {
    if (!o?.stream) return null; if (o.data !== undefined) return o.data;
    let d = o.stream;
    if (/\/Filter/.test(o.dict)) {
      if (!/\/FlateDecode/.test(o.dict) || /\/(?:DCTDecode|JPXDecode|CCITTFaxDecode|LZWDecode|ASCII85Decode)/.test(o.dict)) return (o.data = null);
      try { d = zlib.inflateSync(d); } catch { try { d = zlib.inflateRawSync(d); } catch { try { d = zlib.inflateSync(d, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); } catch { return (o.data = null); } } }
      if (/\/Predictor\s+1[0-5]/.test(o.dict)) return (o.data = null); // only cross-reference tables use this
    }
    return (o.data = d);
  };
  // objects packed inside object streams
  for (const [, o] of [...objs]) {
    if (!/\/Type\s*\/ObjStm/.test(o.dict)) continue;
    const d = inflate(o)?.toString('latin1'); if (!d) continue;
    const n = Number(o.dict.match(/\/N\s+(\d+)/)?.[1]), first = Number(o.dict.match(/\/First\s+(\d+)/)?.[1]);
    const nums = d.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) { const id = nums[i * 2], off = nums[i * 2 + 1], next = i + 1 < n ? nums[i * 2 + 3] : d.length - first; if (!objs.has(id)) objs.set(id, { dict: d.slice(first + off, first + next), stream: null }); }
  }
  const ref = (dict, key) => { const r = dict.match(new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`)); return r ? Number(r[1]) : null; };
  // the inline << ... >> that follows /Key, or the dictionary it points at
  const sub = (dict, key) => {
    const i = dict.search(new RegExp(`/${key}\\s*<<`));
    if (i >= 0) { let depth = 0, j = dict.indexOf('<<', i); const a = j; for (; j < dict.length; j++) { if (dict.startsWith('<<', j)) { depth++; j++; } else if (dict.startsWith('>>', j)) { depth--; j++; if (!depth) break; } } return dict.slice(a, j + 1); }
    const r = ref(dict, key); return r !== null ? objs.get(r)?.dict || '' : '';
  };
  const cmaps = new Map(); // font object id -> { map, bytes }
  const cmapOf = id => {
    if (cmaps.has(id)) return cmaps.get(id);
    const font = objs.get(id); let out = null;
    const tu = font && ref(font.dict, 'ToUnicode');
    const data = tu !== null && tu !== undefined ? inflate(objs.get(tu))?.toString('latin1') : null;
    if (data) {
      const map = new Map(); let bytes = 1;
      const uni = h => { let t = ''; for (let i = 0; i + 4 <= h.length; i += 4) t += String.fromCharCode(parseInt(h.slice(i, i + 4), 16)); return t; };
      const cs = data.match(/begincodespacerange\s*<([0-9a-f]+)>/i); if (cs) bytes = cs[1].length / 2;
      for (const blk of data.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const p of blk[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]*)>/gi)) { map.set(parseInt(p[1], 16), uni(p[2])); if (!cs) bytes = Math.max(bytes, p[1].length / 2); }
      for (const blk of data.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
        for (const p of blk[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(?:<([0-9a-f]+)>|\[([^\]]*)\])/gi)) {
          const a = parseInt(p[1], 16), b = Math.min(parseInt(p[2], 16), a + 2000); if (!cs) bytes = Math.max(bytes, p[1].length / 2);
          if (p[3] !== undefined) { const base = p[3]; const last = parseInt(base.slice(-4), 16); for (let c = a; c <= b; c++) map.set(c, uni(base.slice(0, -4)) + String.fromCharCode(last + c - a)); }
          else { const list = [...p[4].matchAll(/<([0-9a-f]+)>/gi)].map(x => uni(x[1])); for (let c = a; c <= b && c - a < list.length; c++) map.set(c, list[c - a]); }
        }
      }
      out = { map, bytes: bytes >= 2 ? 2 : 1 };
    } else if (font && /\/Identity-H/.test(font.dict)) out = { map: new Map(), bytes: 2, blind: true };
    cmaps.set(id, out); return out;
  };
  const fontsOf = resDict => {
    const out = {}; const fd = sub(resDict, 'Font');
    for (const f of fd.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) out[f[1]] = Number(f[2]);
    return out;
  };
  const pages = [];
  for (const [id, o] of objs) {
    if (!/\/Type\s*\/Page(?![a-zA-Z])/.test(o.dict)) continue;
    let res = sub(o.dict, 'Resources');
    for (let parent = ref(o.dict, 'Parent'), hops = 0; !res && parent !== null && hops < 6; hops++) { const pd = objs.get(parent)?.dict || ''; res = sub(pd, 'Resources'); parent = ref(pd, 'Parent'); }
    const c = o.dict.match(/\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/);
    let contents = c ? [...c[1].matchAll(/(\d+)\s+\d+\s+R/g)].map(x => Number(x[1])) : [];
    if (contents.length === 1 && !objs.get(contents[0])?.stream) contents = [...(objs.get(contents[0])?.dict || '').matchAll(/(\d+)\s+\d+\s+R/g)].map(x => Number(x[1]));
    pages.push({ id, fonts: fontsOf(res), contents, res });
  }
  const out = [];
  const run = (data, fonts, res, depth = 0) => {
    let font = null, line = '', lastY = null, size = 10, lastLen = 0; const lines = [];
    const flush = () => { if (line.trim()) lines.push(line.replace(/\s+/g, ' ').trim()); line = ''; };
    const show = bytes => {
      const cm = font; let t = '';
      if (cm?.bytes === 2) { for (let i = 0; i + 1 < bytes.length; i += 2) { const code = bytes.charCodeAt(i) << 8 | bytes.charCodeAt(i + 1); t += cm.map.get(code) ?? (cm.blind ? '' : ''); } }
      else for (let i = 0; i < bytes.length; i++) { const code = bytes.charCodeAt(i); t += cm?.map.get(code) ?? (code >= 32 || code === 9 ? WIN1252[code] || String.fromCharCode(code) : ''); }
      line += t; lastLen = t.length;
    };
    const stack = []; let i = 0; const n = data.length;
    const ws = c => c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f' || c === '\0';
    while (i < n) {
      const c = data[i];
      if (ws(c)) { i++; continue; }
      if (c === '%') { while (i < n && data[i] !== '\n' && data[i] !== '\r') i++; continue; }
      if (c === '(') { // literal string
        let depthP = 1, t = ''; i++;
        while (i < n && depthP) {
          const ch = data[i];
          if (ch === '\\') { const e = data[i + 1]; i += 2;
            if (e === 'n') t += '\n'; else if (e === 'r') t += '\r'; else if (e === 't') t += '\t'; else if (e === 'b') t += '\b'; else if (e === 'f') t += '\f';
            else if (e >= '0' && e <= '7') { let o = e; while (o.length < 3 && data[i] >= '0' && data[i] <= '7') o += data[i++]; t += String.fromCharCode(parseInt(o, 8) & 255); }
            else if (e === '\r') { if (data[i] === '\n') i++; } else if (e !== '\n') t += e;
            continue; }
          if (ch === '(') depthP++; else if (ch === ')') { depthP--; if (!depthP) { i++; break; } }
          t += ch; i++;
        }
        stack.push({ s: t }); continue;
      }
      if (c === '<' && data[i + 1] !== '<') { const e = data.indexOf('>', i); const hex = data.slice(i + 1, e).replace(/\s+/g, ''); let t = ''; for (let k = 0; k < hex.length; k += 2) t += String.fromCharCode(parseInt((hex.slice(k, k + 2) + '0').slice(0, 2), 16)); stack.push({ s: t }); i = e + 1; continue; }
      if (c === '[') { stack.push('['); i++; continue; }
      if (c === ']') { const arr = []; while (stack.length && stack[stack.length - 1] !== '[') arr.unshift(stack.pop()); stack.pop(); stack.push({ a: arr }); i++; continue; }
      if (c === '<' || c === '>') { i += 2; continue; }
      if (c === '/') { let j = i + 1; while (j < n && !ws(data[j]) && !'/[]()<>'.includes(data[j])) j++; stack.push({ n: data.slice(i + 1, j) }); i = j; continue; }
      let j = i; while (j < n && !ws(data[j]) && !'/[]()<>'.includes(data[j])) j++;
      if (j === i) { i++; continue; }
      const tok = data.slice(i, j); i = j;
      if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(tok)) { stack.push(Number(tok)); continue; }
      // operator
      if (tok === 'Tf') { const name = stack[stack.length - 2]?.n; font = name !== undefined && fonts[name] !== undefined ? cmapOf(fonts[name]) : null; const sz = stack[stack.length - 1]; if (typeof sz === 'number' && sz > 0) size = sz; }
      else if (tok === 'Tj' || tok === "'" || tok === '"') { if (tok !== 'Tj') flush(); const v = stack[stack.length - 1]; if (v?.s !== undefined) show(v.s); }
      else if (tok === 'TJ') { const v = stack[stack.length - 1]; for (const x of v?.a || []) { if (typeof x === 'number') { if (x < -160 && !line.endsWith(' ')) line += ' '; } else if (x?.s !== undefined) show(x.s); } }
      else if (tok === 'Td' || tok === 'TD') { const ty = stack[stack.length - 1], tx = stack[stack.length - 2]; if (typeof ty === 'number' && Math.abs(ty) > 0.5) flush(); // some exporters place every glyph with its own move: only a move well past the glyphs just drawn is a gap
        else if (typeof tx === 'number' && line && !line.endsWith(' ') && (tx > Math.max(1, lastLen) * size * 0.95 + size * 0.25 || tx < -size)) line += ' '; }
      else if (tok === 'Tm') { const y = stack[stack.length - 1]; if (typeof y === 'number') { if (lastY !== null && Math.abs(y - lastY) > 1.5) flush(); else if (line && !line.endsWith(' ')) line += ' '; lastY = y; } }
      else if (tok === 'T*' || tok === 'ET') { if (tok === 'T*') flush(); else if (line && !line.endsWith(' ')) line += ' '; }
      else if (tok === 'Do' && depth < 3) { // text drawn through a form (some exporters wrap whole pages this way)
        const name = stack[stack.length - 1]?.n; const xo = name !== undefined ? sub(res, 'XObject').match(new RegExp(`/${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(\\d+)\\s+\\d+\\s+R`)) : null;
        const form = xo && objs.get(Number(xo[1]));
        if (form && /\/Subtype\s*\/Form/.test(form.dict)) { const d = inflate(form)?.toString('latin1'); if (d) { flush(); const r2 = sub(form.dict, 'Resources') || res; lines.push(...run(d, { ...fonts, ...fontsOf(r2) }, r2, depth + 1)); } }
      }
      else if (tok === 'BI') { const e = data.indexOf('EI', i); i = e < 0 ? n : e + 2; } // inline image
      stack.length = 0;
    }
    flush(); return lines;
  };
  for (const p of pages) for (const cid of p.contents) { const d = inflate(objs.get(cid))?.toString('latin1'); if (d) out.push(...run(d, p.fonts, p.res)); }
  // Links hidden behind words like "Github" or "LinkedIn" live in the page's link annotations, not its text.
  const uris = new Set(); for (const [, o] of objs) for (const u of o.dict.matchAll(/\/URI\s*\(((?:\\.|[^\\)])*)\)/g)) { const v = u[1].replace(/\\(.)/g, '$1').trim(); if (/^https?:\/\//i.test(v)) uris.add(v); }
  const text = out.join('\n') + (uris.size ? `\n${[...uris].slice(0, 12).join('\n')}` : '');
  if (text.replace(/\s/g, '').length < 80) throw new Error('No text could be read from that PDF. It may be a scan or an image. Export it as text-based PDF, or paste the text instead.');
  return text;
}
// bytes 128-159 of the common Windows encoding (bullets, dashes, curly quotes)
const WIN1252 = { 128: '€', 133: '…', 145: '‘', 146: '’', 147: '“', 148: '”', 149: '•', 150: '–', 151: '—', 153: '™', 160: ' ', 173: '' };

// ───────────────────────────────────────────── text -> profile
const HEADINGS = {
  education: /^(education|academics?|academic (?:background|details|qualifications?|profile)|educational (?:background|qualifications?)|qualifications?|scholastic achievements?)$/,
  experience: /^((?:work|professional|relevant|industry|research)? ?experiences?|employment(?: history)?|work history|internships?|internship experience|professional background|career history)$/,
  skills: /^((?:technical|core|key|relevant|computer|programming)? ?skills?(?: (?:&|and) (?:tools|technologies|interests|abilities|expertise))?|technical (?:proficiency|expertise|stack)|technologies|tech stack|tools(?: (?:&|and) technologies)?|skills summary|areas of expertise|competencies|core competencies)$/,
  summary: /^(summary|professional summary|profile|objective|career objective|about(?: me)?|overview|introduction)$/,
  projects: /^((?:personal|academic|key|selected|notable|side|open[- ]source)? ?projects?|project experience)$/,
  other: /^(achievements?|awards?(?: (?:&|and) (?:honou?rs|achievements))?|honou?rs|certifications?|certificates|licenses|publications?|positions? of responsibility|leadership|extra-?curriculars?(?: activities)?|activities|volunteer(?:ing)?(?: experience)?|coursework|relevant coursework|courses|languages|interests|hobbies|references|contact|personal (?:details|information)|co-?curriculars?|research|patents|talks|open source)$/,
};
function headingOf(line) {
  const t = line.replace(/[:•|_\-–—=*#]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t || t.length > 42 || /\d{4}/.test(t)) return null;
  for (const [k, re] of Object.entries(HEADINGS)) if (re.test(t)) return k;
  // "Achievements & Positions of Responsibility", "Skills and Interests": a heading made of two
  const parts = line.toLowerCase().split(/\s*(?:&|\/|,|\band\b)\s*/).map(p => p.replace(/[:•|_\-–—=*#]+/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (parts.length > 1 && parts.length <= 3) { const kinds = parts.map(p => Object.entries(HEADINGS).find(([, re]) => re.test(p))?.[0]); if (kinds.every(Boolean)) return kinds[0]; }
  return null;
}
const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december';
// "May 2025", "14 May 2025", "May 14, 2025", "05/2025", "2025"
const DATE = `(?:\\d{1,2}(?:st|nd|rd|th)?[ .]+)?(?:(?:${MONTHS})[a-z]*\\.?[ ,']*(?:\\d{1,2}(?:st|nd|rd|th)?,? +)?)?(?:19|20)\\d{2}|\\d{1,2}/(?:19|20)\\d{2}`;
const BULLET = /^[•\-–*▪◦●·•●‣➢]+\s*/;
const RANGE = new RegExp(`(${DATE})\\s*(?:-|–|—|to|till|until)\\s*(${DATE}|present|current|now|ongoing|today)`, 'i');
function monthIndex(str, end = false) {
  const s = String(str).toLowerCase(); if (/present|current|now|ongoing|today/.test(s)) return new Date().getFullYear() * 12 + new Date().getMonth();
  const y = Number(s.match(/(?:19|20)\d{2}/)?.[0]); if (!y) return null;
  const mName = s.match(new RegExp(`\\b(${MONTHS})`))?.[1]; const mNum = s.match(/^(\d{1,2})\//)?.[1];
  const mo = mName ? ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(mName.slice(0, 3)) : mNum ? Number(mNum) - 1 : end ? 11 : 0;
  return y * 12 + Math.max(0, mo);
}
const DEGREES = [
  ['PhD', /\b(ph\.?\s?d\.?|doctor of philosophy|doctorate)\b/i],
  ['Master', /\b(m\.?\s?tech|m\.?\s?sc?\.?|m\.?\s?eng|m\.?e\.|mba|mca|m\.?\s?s\.?(?= in| ,|,| \(|$)|master(?:'?s)?(?: of [a-z ]+)?|post[- ]?graduate|pgdm|pgp)\b/i],
  ['Bachelor', /\b(b\.?\s?tech|b\.?\s?e\.?(?= in| ,|,| \(|\b)|b\.?\s?sc?\.?|b\.?\s?eng|bca|bba|b\.?\s?com|b\.?\s?a\.?(?= in|,)|b\.?\s?s\.?(?= in|,| \()|bachelor(?:'?s)?(?: of [a-z ]+)?|undergraduate|integrated (?:m|b)\.?\s?tech|dual degree)\b/i],
  ['Diploma', /\b(diploma|associate(?:'s)? degree)\b/i],
  ['School', /\b(class (?:xii|x|12|10)|higher secondary|senior secondary|secondary school|high school|intermediate|cbse|icse|isc|hsc|ssc|a[- ]levels?)\b/i],
];
const SCHOOL = /\b(universit[yé]|university|institute|college|school|academy|polytechnic|iit|nit|iiit|bits|iisc|iim|vit|srm|mit|eth|epfl|vidyalaya|vidyapeeth)\b/i;

export function parseResume(text) {
  const lines = text.split('\n').map(l => l.trim());
  // sections
  const sections = {}; let cur = 'top';
  // Once the first real heading has passed, any short ALL-CAPS line is a heading too, even one we have no
  // name for: its lines must not leak into the section above it.
  const capsHeading = l => cur !== 'top' && l.length >= 4 && l.length <= 60 && /^[A-Z][A-Z &/,'’-]+$/.test(l) && l.split(/\s+/).length <= 7;
  for (const l of lines) { const h = headingOf(l) || (capsHeading(l) ? 'other' : null); if (h) { cur = h; continue; } (sections[cur] ||= []).push(l); }
  const sec = k => (sections[k] || []).filter(Boolean);

  const email = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0] || '';
  const phone = (text.match(/(?:\+\d{1,3}[ -]?)?(?:\(?\d{3,5}\)?[ -]?)?\d{3,5}[ -]?\d{4,6}/g) || []).map(p => p.trim()).find(p => p.replace(/\D/g, '').length >= 10 && p.replace(/\D/g, '').length <= 13 && !/^(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}$/.test(p)) || '';
  const links = [...new Set((text.match(/(?:https?:\/\/)?(?:www\.)?(?:github\.com|linkedin\.com\/in|gitlab\.com|leetcode\.com|kaggle\.com|behance\.net|dribbble\.com|medium\.com\/@?|[a-z0-9-]+\.(?:dev|io|me|app|tech|xyz|vercel\.app|github\.io|netlify\.app))\/?[^\s|,;)>\]]*/gi) || []).map(u => u.replace(/[.,]+$/, '')).filter(u => !/@/.test(u) && u.length > 6))].slice(0, 6)
    .map(u => /^https?:/i.test(u) ? u : `https://${u}`);
  const top = sec('top').slice(0, 8);
  const name = top.find(l => /^[A-Za-zÀ-ÿ.'’-]+(?: [A-Za-zÀ-ÿ.'’-]+){1,3}$/.test(l) && l.length <= 40 && !/resume|curriculum|vitae|engineer|developer|student|intern\b/i.test(l)) || '';
  const headline = top.find(l => l !== name && l.length <= 80 && /engineer|developer|student|scientist|designer|analyst|researcher|undergraduate|graduate|intern\b|manager/i.test(l) && !/@|https?:|\d{5}/.test(l)) || '';

  // skills: everything the vocabulary recognises anywhere, plus what the résumé itself lists under Skills
  const found = new Map(); const add = raw => { const info = skillInfo(raw); const key = info.canonical.toLowerCase(); if (!found.has(key)) found.set(key, { name: info.canonical, group: info.group, tech: info.tech }); };
  for (const s of extractSkills(text, '')) add(s.name);
  // A skill is a short name, never a clause: "gamified learning modules" and "a full-stack disaster" are prose.
  const known = t => found.has(skillInfo(t).canonical.toLowerCase());
  const addListed = (body, listed) => {
    for (let tok of body.split(/[,;|•·●▪]|\s{3,}|\s\/\s/)) {
      tok = tok.replace(/\((?:basic|intermediate|advanced|proficient|familiar|beginner|expert|learning)[^)]*\)/i, '').replace(/^[\s\-–•*]+|[\s.]+$/g, '').replace(/^and\s+/i, '').trim();
      const n = tok.split(/\s+/).length;
      if (tok.length < 2 || tok.length > 36 || n > 4 || /[.!?:]$/.test(tok) || /^(etc|others?|and more|skills?|tools?|languages?|frameworks?|libraries|databases?|technologies|familiar with|proficient in)$/i.test(tok)) continue;
      if (/^(a|an|the|with|for|to|of|in|on|by|using|built|developed|worked|experience)\b/i.test(tok)) continue;
      if (!listed && n > 3) continue;
      // "Data Structures & Algorithms" when both halves are already there
      const halves = tok.split(/\s*(?:&|\band\b)\s*/).filter(Boolean); if (halves.length > 1 && halves.every(known)) continue;
      add(tok);
    }
  };
  // 1. the Skills section: "Label: a, b, c" lines and their wrapped continuations
  for (const l of sec('skills')) { if (BULLET.test(l) && l.split(/\s+/).length > 14 && !/:/.test(l.slice(0, 40))) continue; addListed(l.replace(BULLET, '').replace(/^[A-Za-z &/+-]{2,36}:\s*/, ''), true); }
  // 2. tech-stack lines under a project or a job: a bare comma list such as "Flutter, Kotlin, FastAPI, AES-256-GCM"
  const isStack = l => !!l && !BULLET.test(l) && l.length <= 140 && !/[.!?]$/.test(l) && (l.match(/,/g) || []).length >= 2 && l.split(',').every(x => { const t = x.trim(); return t.length >= 1 && t.length <= 30 && t.split(/\s+/).length <= 4; });
  for (const k of ['projects', 'experience']) for (const l of sec(k)) if (isStack(l)) addListed(l, true);
  const skills = [...found.values()].sort((a, b) => b.tech - a.tech).slice(0, 80);

  // projects: a title line (often ending in a year) followed by its stack line or its bullets
  const projects = []; const pl = sec('projects');
  pl.forEach((l, i) => {
    if (BULLET.test(l) || isStack(l) || l.split(/\s+/).length > 16 || !/^[A-Z0-9]/.test(l)) return;
    const next = pl[i + 1] || ''; const year = l.match(/\b((?:19|20)\d{2})\s*$/)?.[1] || '';
    if (!isStack(next) && !(year && BULLET.test(next))) return;
    projects.push({ name: l.replace(RANGE, '').replace(/\s*\b(?:19|20)\d{2}\s*$/, '').replace(/[|,\s–-]+$/, '').trim().slice(0, 120), year, stack: isStack(next) ? next.split(',').map(x => x.trim()).filter(Boolean).slice(0, 14) : [] });
  });

  // education
  const education = []; let e = null;
  const pushE = () => { if (e && (e.school || e.degree)) education.push(e); e = null; };
  for (const l of sec('education')) {
    const deg = DEGREES.find(([, re]) => re.test(l)); const school = SCHOOL.test(l);
    const years = [...l.matchAll(/(?:19|20)\d{2}/g)].map(x => Number(x[0])); const grade = l.match(/\b(?:c?gpa|cpi|sgpa|percentage|score|marks)\b[:\s-]*([\d.]+\s*(?:\/\s*[\d.]+)?%?)|\b(\d{1,2}(?:\.\d{1,2})?\s*\/\s*(?:10|4)(?:\.0+)?)\b|\b(\d{2}(?:\.\d+)?\s?%)/i);
    if ((school && e?.school) || (deg && e?.degree && !school)) pushE();
    if (school || deg || years.length || grade) {
      e ||= { school: '', degree: '', level: '', start: null, end: null, grade: '' };
      if (school && !e.school) e.school = l.split(/\s[|•·]\s|\s{3,}|\t/)[0].replace(RANGE, '').replace(/[,\s–-]+$/, '').trim().slice(0, 90);
      if (deg && !e.degree) { e.level = deg[0]; const part = l.split(/\s[|•·]\s|\s{3,}|\t/).find(p => deg[1].test(p)) || l; e.degree = part.replace(RANGE, '').replace(/\b(?:c?gpa|cpi)\b.*$/i, '').replace(/[,\s–(-]+$/, '').trim().slice(0, 90); }
      if (years.length) { e.end = Math.max(e.end || 0, ...years); if (years.length > 1 || e.start) e.start = Math.min(e.start || 9999, ...years); }
      if (grade && !e.grade) e.grade = (grade[1] || grade[2] || grade[3]).replace(/\s+/g, '');
    }
  }
  pushE();
  const rank = { PhD: 5, Master: 4, Bachelor: 3, Diploma: 2, School: 1, '': 0 };
  const topEdu = [...education].sort((a, b) => rank[b.level] - rank[a.level] || (b.end || 0) - (a.end || 0))[0];

  // experience: dated lines under Experience
  const experience = []; const spans = [];
  const expLines = sec('experience');
  expLines.forEach((l, i) => {
    const r = l.match(RANGE); if (!r) return;
    const a = monthIndex(r[1]), b = monthIndex(r[2], true); if (a === null || b === null || b < a) return;
    const rest = l.replace(RANGE, '').replace(/[|•·,\s–-]+$/, '').replace(/^[|•·,\s–-]+/, '').trim();
    const near = [expLines[i - 1], expLines[i + 1]].find(x => x && !RANGE.test(x) && x.length < 90 && !BULLET.test(x) && !isStack(x)) || '';
    const title = (rest || near).slice(0, 110);
    const internship = /\bintern(ship)?\b|trainee|co-?op/i.test(title);
    // "14 May – 14 July" is two months, "May – July" is three
    const dayToDay = /^\d{1,2}\D/.test(r[1].trim()) && /^\d{1,2}\D/.test(r[2].trim());
    experience.push({ title, from: r[1], to: r[2], months: Math.max(1, b - a + (dayToDay ? 0 : 1)), internship });
    if (!internship) spans.push([a, b]); // years of experience means jobs held; internships are listed, not counted
  });
  spans.sort((x, y) => x[0] - y[0]); let months = 0, endAt = -1;
  for (const [a, b] of spans) { const s = Math.max(a, endAt + 1); if (b >= s) { months += b - s + 1; endAt = b; } }
  const summary = sec('summary').join(' ').replace(/\s+/g, ' ').slice(0, 600);
  const nowYear = new Date().getFullYear();
  return {
    name, headline, email, phone, links, summary, skills, education, experience: experience.slice(0, 12), projects: projects.slice(0, 12),
    yearsExp: Math.round(months / 6) / 2, degree: topEdu?.level || '', gradYear: topEdu?.end || null,
    student: !!(topEdu?.end && topEdu.end >= nowYear && topEdu.level !== 'School'),
    chars: text.length,
  };
}
