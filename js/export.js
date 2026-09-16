/* Two ways out of the editor:

   1. build()      → one self-contained .html file (pages embedded as data URIs).
                     Opens offline from a USB stick or an email attachment.
   2. buildZip()   → a small website: index.html + assets/ + pages/*.jpg.
                     Unzip and upload anywhere to share the book by link.
*/
(function (global) {
  'use strict';

  var cache = {};

  function grab(url) {
    if (!cache[url]) {
      cache[url] = fetch(url).then(function (r) {
        if (!r.ok) throw new Error('โหลด ' + url + ' ไม่สำเร็จ');
        return r.text();
      });
    }
    return cache[url];
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Never let page content close our <script> block. */
  function safeJson(obj) {
    return JSON.stringify(obj)
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  function pad(n) { return ('000' + n).slice(-3); }

  function head(opts, styleBlock) {
    var t = opts.title || 'Flipbook';
    return '<!doctype html>\n<html lang="th">\n<head>\n' +
      '<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
      '<title>' + esc(t) + '</title>\n' +
      (opts.author ? '<meta name="author" content="' + esc(opts.author) + '">\n' : '') +
      '<meta property="og:title" content="' + esc(t) + '">\n' +
      '<meta property="og:type" content="book">\n' +
      '<meta name="generator" content="Flipbook Maker">\n' +
      styleBlock +
      '</head>\n<body>\n<div id="book"></div>\n';
  }

  function baseCss(bg) {
    return 'html,body{margin:0;height:100%;background:' + esc(bg) +
      ';overflow:hidden}\n#book{position:fixed;inset:0}\n';
  }

  function bookData(opts, pages) {
    return {
      pages: pages,
      mode: opts.mode,
      duration: opts.duration,
      sound: opts.sound,
      bg: opts.bg
    };
  }

  /* ------------------------------------------------- single-file export */

  function build(opts) {
    return Promise.all([grab('css/flipbook.css'), grab('js/flipbook.js')]).then(function (parts) {
      var html = head(opts, '<style>\n' + baseCss(opts.bg) + parts[0] + '\n</style>\n') +
        '<script>\n' + parts[1] + '\n<\/script>\n' +
        '<script>\nnew Flipbook(document.getElementById("book"), ' +
        safeJson(bookData(opts, opts.pages)) + ');\n<\/script>\n' +
        '</body>\n</html>\n';
      return new Blob([html], { type: 'text/html;charset=utf-8' });
    });
  }

  /* ------------------------------------------------ web package (.zip) */

  function buildZip(opts, onProgress) {
    if (!global.JSZip) return Promise.reject(new Error('ไม่พบไลบรารี JSZip'));

    return Promise.all([grab('css/flipbook.css'), grab('js/flipbook.js')]).then(function (parts) {
      var zip = new global.JSZip();
      var assets = zip.folder('assets');
      var pagesDir = zip.folder('pages');

      assets.file('flipbook.css', baseCss(opts.bg) + parts[0]);
      assets.file('flipbook.js', parts[1]);

      var manifest = opts.pages.map(function (p, i) {
        var m = /^data:image\/(\w+);base64,(.*)$/.exec(p.src);
        var ext = m ? (m[1] === 'jpeg' ? 'jpg' : m[1]) : 'jpg';
        var name = pad(i + 1) + '.' + ext;
        pagesDir.file(name, m ? m[2] : '', { base64: !!m });
        return { src: 'pages/' + name, w: p.w, h: p.h, text: p.text || '' };
      });

      var html = head(opts, '<link rel="stylesheet" href="assets/flipbook.css">\n') +
        '<script src="assets/flipbook.js"><\/script>\n' +
        '<script>\nnew Flipbook(document.getElementById("book"), ' +
        safeJson(bookData(opts, manifest)) + ');\n<\/script>\n' +
        '</body>\n</html>\n';

      zip.file('index.html', html);
      zip.file('README.txt',
        (opts.title || 'Flipbook') + '\n' +
        'สร้างด้วย Flipbook Maker\n\n' +
        'วิธีเผยแพร่ออนไลน์: แตกไฟล์ zip นี้ แล้วอัปโหลดทั้งโฟลเดอร์\n' +
        'ขึ้นเว็บโฮสต์ใดก็ได้ (cPanel / public_html, Cloudflare Pages,\n' +
        'GitHub Pages, Netlify) แล้วเปิดที่ index.html\n' +
        'ไม่ต้องใช้ฐานข้อมูลหรือ PHP — เป็นไฟล์สถิตล้วน\n');

      return zip.generateAsync(
        { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } },
        function (meta) { if (onProgress) onProgress(meta.percent / 100); });
    });
  }

  /* ------------------------------------------------------------- saving */

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function safeFilename(name, ext) {
    var base = String(name || 'flipbook').trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
    return (base || 'flipbook') + ext;
  }

  global.FlipbookExport = {
    build: build,
    buildZip: buildZip,
    download: download,
    safeFilename: safeFilename
  };
})(window);
