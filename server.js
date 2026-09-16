// Zero-dependency static server for the Flipbook Maker app.
// Run: node server.js   (or double-click start.cmd)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = __dirname;
const START_PORT = Number(process.env.PORT) || 5173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    // pdf.js is happier with these, and they cost nothing locally.
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  res.end(body);
}

function stripLeadingSeps(p) {
  while (p[0] === '/' || p[0] === '\\') p = p.slice(1);
  return p;
}

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  // Serve directory indexes the way a real static host does, so a preview of
  // an exported package behaves the same locally as it will once deployed.
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(ROOT, stripLeadingSeps(path.normalize(rel)));
  if (!file.startsWith(ROOT)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found: ' + rel);
    send(res, 200, buf, TYPES[path.extname(file).toLowerCase()]);
  });
});

function listen(port, attemptsLeft) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) return listen(port + 1, attemptsLeft - 1);
    console.error(err.message);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}/`;
    console.log('\n  Flipbook Maker พร้อมใช้งานที่  ' + url + '\n  กด Ctrl+C เพื่อปิด\n');
    // Only pop a browser open when a human started us from a console.
    if (!process.stdout.isTTY || process.env.FB_NO_OPEN) return;
    if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', url]);
    else execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [url]);
  });
}
listen(START_PORT, 20);
