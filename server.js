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

/* Resolves once the server is listening. Port 0 asks the OS for a free one,
   which is what the desktop build uses so two copies never collide. */
function start(port, attemptsLeft) {
  if (port === undefined) port = START_PORT;
  if (attemptsLeft === undefined) attemptsLeft = 20;

  return new Promise((resolve, reject) => {
    function onError(err) {
      if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
        server.removeListener('error', onError);
        return resolve(start(port + 1, attemptsLeft - 1));
      }
      reject(err);
    }
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError);
      const actual = server.address().port;
      resolve({
        port: actual,
        url: `http://localhost:${actual}/`,
        close: () => new Promise((r) => server.close(r))
      });
    });
  });
}

module.exports = { start };

/* Started straight from a console (start.cmd), not required by Electron. */
if (require.main === module) {
  start().then(({ url }) => {
    console.log('\n  Flipbook Maker พร้อมใช้งานที่  ' + url + '\n  กด Ctrl+C เพื่อปิด\n');
    // Only pop a browser open when a human started us from a console.
    if (!process.stdout.isTTY || process.env.FB_NO_OPEN) return;
    if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', url]);
    else execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [url]);
  }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
