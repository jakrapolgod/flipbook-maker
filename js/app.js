/* Flipbook Maker — editor.
   Pages keep a reference to their ORIGINAL source (an image File, or a page of a
   loaded PDF) and are re-rendered on demand at the export resolution, so quality
   settings can be changed at any time without re-importing. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  }

  var state = {
    pages: [],          // see makeImagePage / makePdfPage
    seq: 0,
    render: null,       // { key, pages: [{src,w,h,text}], bytes }
    book: null          // live Flipbook instance while previewing
  };

  var settings = {
    title: '', author: '', mode: 'auto', bg: '#2a2b31',
    duration: 700, sound: true, maxWidth: 1400, quality: 82, format: 'single'
  };

  var FORMAT_HINT = {
    single: 'ได้ไฟล์ .html ไฟล์เดียวที่มีทุกหน้าอยู่ข้างใน ดับเบิลคลิกเปิดได้เลย ' +
      'ส่งทางไลน์/อีเมล หรือวางไว้ใน Google Drive แล้วแชร์ก็ได้',
    zip: 'ได้ไฟล์ .zip ที่ข้างในเป็นเว็บสถิต (index.html + pages/) ' +
      'แตกไฟล์แล้วอัปโหลดขึ้นโฮสต์ cPanel, GitHub Pages, Netlify Drop หรือ Cloudflare Pages ' +
      'จะได้ลิงก์ให้คนอื่นเปิดอ่านออนไลน์ได้ทันที'
  };

  /* ------------------------------------------------------------ utilities */

  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('on'); }, ms || 2600);
  }

  function progress(show, text, pct) {
    var p = $('progress');
    p.classList.toggle('on', !!show);
    if (text) $('progressText').textContent = text;
    $('progressBar').style.width = (pct == null ? 0 : Math.round(pct * 100)) + '%';
  }

  function humanSize(bytes) {
    if (!bytes) return '';
    var u = ['B', 'KB', 'MB', 'GB'], i = 0;
    while (bytes >= 1024 && i < u.length - 1) { bytes /= 1024; i++; }
    return bytes.toFixed(bytes < 10 && i > 0 ? 1 : 0) + ' ' + u[i];
  }

  /* Yield to the browser so the progress bar actually paints.
     Deliberately not requestAnimationFrame: that stalls in a hidden tab. */
  function breathe() {
    return new Promise(function (r) { setTimeout(r, 0); });
  }

  function canvasToDataUrl(canvas, quality) {
    return canvas.toDataURL('image/jpeg', quality / 100);
  }

  /* --------------------------------------------------------- page sources */

  function makeImagePage(file) {
    return { id: ++state.seq, kind: 'image', file: file, name: file.name, rotate: 0 };
  }

  function makePdfPage(doc, pageNum, label) {
    return { id: ++state.seq, kind: 'pdf', doc: doc, pageNum: pageNum, name: label, rotate: 0 };
  }

  /* Draw one page onto a canvas at (at most) maxW css pixels wide. */
  async function renderPage(page, maxW) {
    if (page.kind === 'image') {
      var bmp = await createImageBitmap(page.file);
      var swapped = page.rotate % 180 !== 0;
      var natW = swapped ? bmp.height : bmp.width;
      var natH = swapped ? bmp.width : bmp.height;
      var scale = Math.min(1, maxW / natW);
      var w = Math.max(1, Math.round(natW * scale));
      var h = Math.max(1, Math.round(natH * scale));

      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.translate(w / 2, h / 2);
      ctx.rotate(page.rotate * Math.PI / 180);
      var dw = (swapped ? h : w), dh = (swapped ? w : h);
      ctx.drawImage(bmp, -dw / 2, -dh / 2, dw, dh);
      if (bmp.close) bmp.close();
      return { canvas: c, w: w, h: h, text: '' };
    }

    var pdfPage = await page.doc.getPage(page.pageNum);
    var base = pdfPage.getViewport({ scale: 1, rotation: (pdfPage.rotate + page.rotate) % 360 });
    var scale2 = Math.min(3, maxW / base.width);
    var vp = pdfPage.getViewport({ scale: scale2, rotation: (pdfPage.rotate + page.rotate) % 360 });

    var cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(vp.width));
    cv.height = Math.max(1, Math.round(vp.height));
    var c2 = cv.getContext('2d');
    c2.fillStyle = '#fff';
    c2.fillRect(0, 0, cv.width, cv.height);
    // intent:'print' keeps pdf.js off requestAnimationFrame, so a long import
    // still finishes when the user switches to another tab.
    await pdfPage.render({ canvasContext: c2, viewport: vp, intent: 'print' }).promise;

    var text = '';
    try {
      var tc = await pdfPage.getTextContent();
      text = tc.items.map(function (i) { return i.str; }).join(' ').replace(/\s+/g, ' ').trim();
    } catch (e) { /* scanned PDFs have no text layer — that is fine */ }

    return { canvas: cv, w: cv.width, h: cv.height, text: text };
  }

  /* ------------------------------------------------------------ importing */

  async function addImageFiles(files) {
    var list = Array.prototype.filter.call(files, function (f) { return /^image\//.test(f.type); });
    if (!list.length) return;
    list.sort(function (a, b) { return a.name.localeCompare(b.name, 'th', { numeric: true }); });
    list.forEach(function (f) { state.pages.push(makeImagePage(f)); });
    invalidate();
    await buildThumbs();
    toast('เพิ่ม ' + list.length + ' หน้าแล้ว');
  }

  async function addPdfFiles(files) {
    if (!window.pdfjsLib) { toast('ไม่พบไลบรารี pdf.js'); return; }
    var list = Array.prototype.filter.call(files, function (f) {
      return f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    });
    if (!list.length) return;

    progress(true, 'กำลังอ่านไฟล์ PDF…', 0);
    try {
      for (var i = 0; i < list.length; i++) {
        var buf = await list[i].arrayBuffer();
        var doc = await window.pdfjsLib.getDocument({ data: buf }).promise;
        for (var p = 1; p <= doc.numPages; p++) {
          state.pages.push(makePdfPage(doc, p, list[i].name + ' #' + p));
        }
        progress(true, 'กำลังอ่านไฟล์ PDF…', (i + 1) / list.length);
      }
      invalidate();
      await buildThumbs();
      toast('นำเข้า PDF เรียบร้อย');
    } catch (err) {
      console.error(err);
      toast('เปิดไฟล์ PDF ไม่ได้: ' + err.message, 5000);
    } finally {
      progress(false);
    }
  }

  /* --------------------------------------------------------------- thumbs */

  async function buildThumbs() {
    var todo = state.pages.filter(function (p) { return !p.thumb; });
    if (todo.length) progress(true, 'กำลังสร้างภาพย่อ…', 0);
    for (var i = 0; i < todo.length; i++) {
      var r = await renderPage(todo[i], 260);
      todo[i].thumb = canvasToDataUrl(r.canvas, 70);
      todo[i].w = r.w; todo[i].h = r.h;
      progress(true, 'กำลังสร้างภาพย่อ…', (i + 1) / todo.length);
      if (i % 4 === 3) await breathe();
    }
    progress(false);
    draw();
  }

  /* ------------------------------------------------------------- the grid */

  function draw() {
    var wrap = $('pages');
    wrap.innerHTML = '';

    if (!state.pages.length) {
      var e = document.createElement('div');
      e.className = 'empty';
      e.innerHTML = '<strong>ยังไม่มีหน้าในหนังสือ</strong>' +
        '<div>กด “เพิ่มรูปภาพ” หรือ “นำเข้า PDF” ด้านบน<br>หรือลากไฟล์มาวางบนหน้าต่างนี้ได้เลย</div>';
      wrap.appendChild(e);
    }

    state.pages.forEach(function (p, i) {
      var card = document.createElement('div');
      card.className = 'card';
      card.dataset.id = p.id;
      card.innerHTML =
        '<span class="no">' + (i + 1) + '</span>' +
        '<figure draggable="true"><img alt="" src="' + (p.thumb || '') + '"></figure>' +
        '<div class="acts">' +
        '<button data-act="left" title="หมุนซ้าย">⟲</button>' +
        '<button data-act="right" title="หมุนขวา">⟳</button>' +
        '<button data-act="up" title="เลื่อนไปก่อนหน้า">◀</button>' +
        '<button data-act="down" title="เลื่อนไปถัดไป">▶</button>' +
        '<button data-act="del" class="del" title="ลบหน้านี้">✕</button>' +
        '</div>';
      wrap.appendChild(card);
      bindCard(card, p);
    });

    $('count').textContent = state.pages.length
      ? state.pages.length + ' หน้า'
      : 'ยังไม่มีหน้า';
    $('btnPreview').disabled = $('btnExport').disabled = !state.pages.length;
    updateSizeHint();
  }

  function indexOfId(id) {
    for (var i = 0; i < state.pages.length; i++) if (state.pages[i].id === id) return i;
    return -1;
  }

  function bindCard(card, page) {
    card.querySelector('.acts').addEventListener('click', async function (e) {
      var act = e.target.dataset.act;
      if (!act) return;
      var i = indexOfId(page.id);
      if (act === 'del') {
        state.pages.splice(i, 1);
      } else if (act === 'up' && i > 0) {
        state.pages.splice(i - 1, 0, state.pages.splice(i, 1)[0]);
      } else if (act === 'down' && i < state.pages.length - 1) {
        state.pages.splice(i + 1, 0, state.pages.splice(i, 1)[0]);
      } else if (act === 'left' || act === 'right') {
        page.rotate = (page.rotate + (act === 'left' ? 270 : 90)) % 360;
        page.thumb = null;
        invalidate();
        await buildThumbs();
        return;
      } else {
        return;
      }
      invalidate();
      draw();
    });

    var fig = card.querySelector('figure');
    fig.addEventListener('dragstart', function (e) {
      e.dataTransfer.setData('text/plain', String(page.id));
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    fig.addEventListener('dragend', function () {
      card.classList.remove('dragging');
      clearDropMarks();
    });
    card.addEventListener('dragover', function (e) {
      if (!e.dataTransfer.types.includes('text/plain')) return;
      e.preventDefault();
      var r = card.getBoundingClientRect();
      var after = (e.clientX - r.left) > r.width / 2;
      clearDropMarks();
      card.classList.add(after ? 'drop-after' : 'drop-before');
    });
    card.addEventListener('drop', function (e) {
      var id = Number(e.dataTransfer.getData('text/plain'));
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      clearDropMarks();
      var from = indexOfId(id);
      var to = indexOfId(page.id);
      if (from < 0 || to < 0 || from === to) return;
      var r = card.getBoundingClientRect();
      if ((e.clientX - r.left) > r.width / 2) to++;
      if (from < to) to--;
      state.pages.splice(to, 0, state.pages.splice(from, 1)[0]);
      invalidate();
      draw();
    });
  }

  function clearDropMarks() {
    Array.prototype.forEach.call(document.querySelectorAll('.drop-before,.drop-after'), function (n) {
      n.classList.remove('drop-before', 'drop-after');
    });
  }

  /* --------------------------------------------- render at export quality */

  function renderKey() {
    return settings.maxWidth + '|' + settings.quality + '|' +
      state.pages.map(function (p) { return p.id + ':' + p.rotate; }).join(',');
  }

  function invalidate() { state.render = null; }

  async function renderAll(what) {
    var key = renderKey();
    if (state.render && state.render.key === key) return state.render;

    progress(true, what + ' (0/' + state.pages.length + ')', 0);
    var out = [], bytes = 0;
    for (var i = 0; i < state.pages.length; i++) {
      var r = await renderPage(state.pages[i], settings.maxWidth);
      var src = canvasToDataUrl(r.canvas, settings.quality);
      bytes += Math.round(src.length * 0.75);
      out.push({ src: src, w: r.w, h: r.h, text: r.text });
      progress(true, what + ' (' + (i + 1) + '/' + state.pages.length + ')', (i + 1) / state.pages.length);
      if (i % 2 === 1) await breathe();
    }
    progress(false);
    state.render = { key: key, pages: out, bytes: bytes };
    updateSizeHint();
    return state.render;
  }

  function updateSizeHint() {
    var h = $('sizeHint');
    if (!state.pages.length) { h.textContent = ''; return; }
    if (state.render) {
      h.textContent = 'ไฟล์ที่จะได้ประมาณ ' + humanSize(state.render.bytes * 1.37) +
        ' (' + state.render.pages.length + ' หน้า)';
    } else {
      h.textContent = 'ขนาดไฟล์จะคำนวณหลังกดพรีวิวหรือ Export';
    }
  }

  /* -------------------------------------------------------------- preview */

  async function openPreview() {
    var r = await renderAll('กำลังเตรียมพรีวิว');
    $('overlay').classList.add('on');
    $('previewTitle').textContent = settings.title || 'พรีวิว';
    if (state.book) state.book.destroy();
    state.book = new Flipbook($('previewMount'), {
      pages: r.pages,
      mode: settings.mode,
      duration: settings.duration,
      sound: settings.sound,
      bg: settings.bg
    });
  }

  function closePreview() {
    $('overlay').classList.remove('on');
    if (state.book) { state.book.destroy(); state.book = null; }
  }

  /* --------------------------------------------------------------- export */

  async function doExport() {
    var r = await renderAll('กำลังเรนเดอร์หน้าหนังสือ');
    var zipMode = settings.format === 'zip';
    progress(true, 'กำลังประกอบไฟล์…', 0.05);
    try {
      var opts = {
        pages: r.pages,
        title: settings.title || 'Flipbook',
        author: settings.author,
        mode: settings.mode,
        duration: settings.duration,
        sound: settings.sound,
        bg: settings.bg
      };
      var blob = zipMode
        ? await FlipbookExport.buildZip(opts, function (p) {
            progress(true, 'กำลังบีบอัดแพ็กเกจเว็บ…', p);
          })
        : await FlipbookExport.build(opts);

      FlipbookExport.download(blob, FlipbookExport.safeFilename(settings.title, zipMode ? '.zip' : '.html'));
      toast('Export สำเร็จ — ' + humanSize(blob.size) +
        (zipMode ? ' · แตกไฟล์แล้วอัปโหลดทั้งโฟลเดอร์ขึ้นโฮสต์ได้เลย' : ''), 4500);
    } catch (err) {
      console.error(err);
      toast('Export ไม่สำเร็จ: ' + err.message, 5000);
    } finally {
      progress(false);
    }
  }

  /* ----------------------------------------------------------------- wire */

  function bindSettings() {
    function live(id, key, transform, label) {
      var node = $(id);
      var apply = function () {
        var v = node.type === 'checkbox' ? node.checked : node.value;
        settings[key] = transform ? transform(v) : v;
        if (label) label();
        if (state.book) {
          if (key === 'mode' || key === 'bg' || key === 'duration' || key === 'sound') {
            state.book.setOption(key, settings[key]);
          }
        }
        if (key === 'maxWidth' || key === 'quality') { invalidate(); updateSizeHint(); }
      };
      node.addEventListener('input', apply);
      node.addEventListener('change', apply);
      apply();
    }

    live('fTitle', 'title');
    live('fAuthor', 'author');
    live('fMode', 'mode');
    live('fBg', 'bg');
    live('fSound', 'sound');
    live('fSpeed', 'duration', Number, function () { $('fSpeedVal').textContent = $('fSpeed').value + ' ms'; });
    live('fWidth', 'maxWidth', Number, function () { $('fWidthVal').textContent = $('fWidth').value; });
    live('fQuality', 'quality', Number, function () { $('fQualityVal').textContent = $('fQuality').value + '%'; });
    live('fFormat', 'format', null, updateExportLabel);
  }

  function updateExportLabel() {
    var zip = settings.format === 'zip';
    $('formatHint').textContent = FORMAT_HINT[zip ? 'zip' : 'single'];
    $('btnExport').textContent = zip ? 'Export แพ็กเกจเว็บ (.zip)' : 'Export ไฟล์ .html';
  }

  function bindDropZone() {
    var hint = $('dropHint'), depth = 0;
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('dragenter', function (e) {
      if (!e.dataTransfer || !e.dataTransfer.types.includes('Files')) return;
      depth++; hint.classList.add('on');
    });
    window.addEventListener('dragleave', function () {
      if (--depth <= 0) { depth = 0; hint.classList.remove('on'); }
    });
    window.addEventListener('drop', async function (e) {
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault();
      depth = 0; hint.classList.remove('on');
      var files = e.dataTransfer.files;
      await addPdfFiles(files);
      await addImageFiles(files);
    });
  }

  function init() {
    bindSettings();
    bindDropZone();
    draw();

    $('btnAddImages').onclick = function () { $('fileImages').click(); };
    $('btnAddPdf').onclick = function () { $('filePdf').click(); };
    $('fileImages').onchange = function () { addImageFiles(this.files); this.value = ''; };
    $('filePdf').onchange = function () { addPdfFiles(this.files); this.value = ''; };

    $('btnPreview').onclick = openPreview;
    $('btnExport').onclick = doExport;
    $('btnClosePreview').onclick = closePreview;
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && $('overlay').classList.contains('on')) closePreview();
    });

    $('btnReverse').onclick = function () {
      state.pages.reverse(); invalidate(); draw();
    };
    $('btnClear').onclick = function () {
      if (!state.pages.length) return;
      if (!confirm('ลบทุกหน้าออกจากหนังสือ?')) return;
      state.pages = []; invalidate(); draw();
    };

    window.addEventListener('beforeunload', function (e) {
      if (state.pages.length) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
