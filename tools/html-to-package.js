/* Convert a single-file .html export into a static web package folder.

   Usage: node tools/html-to-package.js <book.html> <out-dir> [--title "..."]

   Produces  out-dir/index.html + assets/ + pages/NNN.jpg  — the same layout
   the editor's "แพ็กเกจเว็บ (.zip)" export makes, ready to upload to any
   static host. Useful when a book was exported as a single file but now
   needs to be published by link.
*/
'use strict';

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const titleAt = argv.indexOf('--title');
const titleOverride = titleAt >= 0 ? argv.splice(titleAt, 2)[1] : null;
const [srcArg, outArg] = argv;
if (!srcArg || !outArg) {
  console.error('usage: node tools/html-to-package.js <book.html> <out-dir> [--title "..."]');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(srcArg, 'utf8');

/* --- pull the book data out of the bootstrap call ----------------------- */

const MARK = 'new Flipbook(document.getElementById("book"), ';
const at = src.indexOf(MARK);
if (at < 0) throw new Error('ไม่พบข้อมูลหนังสือในไฟล์นี้ (ไม่ใช่ไฟล์ที่ export จาก Flipbook Maker?)');

const start = src.indexOf('{', at);
let depth = 0, inStr = false, esc = false, end = -1;
for (let i = start; i < src.length; i++) {
  const c = src[i];
  if (inStr) {
    if (esc) esc = false;
    else if (c === '\\') esc = true;
    else if (c === '"') inStr = false;
    continue;
  }
  if (c === '"') inStr = true;
  else if (c === '{') depth++;
  else if (c === '}' && --depth === 0) { end = i + 1; break; }
}
if (end < 0) throw new Error('อ่านข้อมูลหนังสือไม่สำเร็จ');

const book = JSON.parse(src.slice(start, end));
const title = titleOverride || (/<title>([^<]*)<\/title>/.exec(src) || [])[1] || 'Flipbook';
const author = (/name="author" content="([^"]*)"/.exec(src) || [])[1] || '';

/* --- write the package -------------------------------------------------- */

const out = path.resolve(outArg);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
fs.mkdirSync(path.join(out, 'pages'), { recursive: true });

const esc2 = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const baseCss =
  `html,body{margin:0;height:100%;background:${esc2(book.bg)};overflow:hidden}\n` +
  '#book{position:fixed;inset:0}\n';

fs.writeFileSync(path.join(out, 'assets/flipbook.css'),
  baseCss + fs.readFileSync(path.join(ROOT, 'css/flipbook.css'), 'utf8'));
fs.writeFileSync(path.join(out, 'assets/flipbook.js'),
  fs.readFileSync(path.join(ROOT, 'js/flipbook.js'), 'utf8'));

let bytes = 0;
const manifest = book.pages.map((p, i) => {
  const m = /^data:image\/(\w+);base64,(.*)$/.exec(p.src);
  if (!m) throw new Error('หน้า ' + (i + 1) + ' ไม่ใช่รูปแบบ data URI ที่รองรับ');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const name = String(i + 1).padStart(3, '0') + '.' + ext;
  const buf = Buffer.from(m[2], 'base64');
  bytes += buf.length;
  fs.writeFileSync(path.join(out, 'pages', name), buf);
  return { src: 'pages/' + name, w: p.w, h: p.h, text: p.text || '' };
});

const data = {
  pages: manifest,
  mode: book.mode,
  duration: book.duration,
  sound: book.sound,
  bg: book.bg
};
const json = JSON.stringify(data).replace(/</g, '\\u003c');

fs.writeFileSync(path.join(out, 'index.html'),
  '<!doctype html>\n<html lang="th">\n<head>\n' +
  '<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
  `<title>${esc2(title)}</title>\n` +
  (author ? `<meta name="author" content="${esc2(author)}">\n` : '') +
  `<meta property="og:title" content="${esc2(title)}">\n` +
  '<meta property="og:type" content="book">\n' +
  '<meta name="generator" content="Flipbook Maker">\n' +
  '<link rel="stylesheet" href="assets/flipbook.css">\n' +
  '</head>\n<body>\n<div id="book"></div>\n' +
  '<script src="assets/flipbook.js"></' + 'script>\n' +
  '<script>\nnew Flipbook(document.getElementById("book"), ' + json + ');\n</' + 'script>\n' +
  '</body>\n</html>\n');

console.log('title :', title);
console.log('pages :', manifest.length);
console.log('images:', (bytes / 1048576).toFixed(1), 'MB');
console.log('out   :', out);
