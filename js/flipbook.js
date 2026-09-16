/* Flipbook engine — standalone, zero dependencies.
   Used for the editor preview AND inlined verbatim into exported books.

   new Flipbook(mountEl, {
     pages:    [{ src, w, h, text }],   // text is optional, enables search
     mode:     'auto' | 'double' | 'single',
     duration: 700,                     // ms per page turn
     sound:    true,
     bg:       '#2a2b31',
     startPage: 0
   })
*/
(function (global) {
  'use strict';

  var DEFAULTS = {
    pages: [],
    mode: 'auto',
    duration: 700,
    sound: true,
    bg: '#2a2b31',
    startPage: 0,
    autoplayDelay: 4000
  };

  function el(tag, cls, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* Synthesised paper rustle, so exported books need no audio asset. */
  function makeSfx() {
    var ctx = null;
    return function () {
      try {
        if (!ctx) ctx = new (global.AudioContext || global.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
        var t = ctx.currentTime;
        var len = Math.floor(ctx.sampleRate * 0.2);
        var buf = ctx.createBuffer(1, len, ctx.sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < len; i++) {
          var p = i / len;
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - p, 3) * Math.min(1, p * 20);
        }
        var src = ctx.createBufferSource(); src.buffer = buf;
        var flt = ctx.createBiquadFilter(); flt.type = 'bandpass';
        flt.frequency.setValueAtTime(800, t);
        flt.frequency.exponentialRampToValueAtTime(2800, t + 0.18);
        flt.Q.value = 0.8;
        var g = ctx.createGain(); g.gain.value = 0.18;
        src.connect(flt); flt.connect(g); g.connect(ctx.destination);
        src.start(t);
      } catch (e) { /* sound is a nicety, never fatal */ }
    };
  }

  function Flipbook(mount, options) {
    var o = {}, k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    for (k in (options || {})) if (options[k] !== undefined) o[k] = options[k];

    this.opt = o;
    this.pages = (o.pages || []).slice();
    this.mount = mount;
    this.cur = 0;          // double mode: leaves turned. single mode: page index.
    this.busy = false;
    this.zoom = 1;
    this.timer = null;
    this.loupeOn = false;
    this.loupeK = 2.5;
    this.sfx = makeSfx();

    this._build();
    this._bind();
    this.layout();
    if (o.startPage) this.toPage(o.startPage, true);
    else this._render();
  }

  var P = Flipbook.prototype;

  /* ------------------------------------------------------------------ DOM */

  P._build = function () {
    var o = this.opt;
    this.mount.innerHTML = '';
    this.mount.classList.add('fb-mount');

    var root = this.root = el('div', 'fb-root', this.mount);
    root.style.setProperty('--fb-bg', o.bg);

    var stage = this.stage = el('div', 'fb-stage', root);
    var book = this.book = el('div', 'fb-book', stage);
    this.slotL = el('div', 'fb-slot fb-slot-l', book);
    this.slotR = el('div', 'fb-slot fb-slot-r', book);
    el('div', 'fb-spine', book);

    this.edgeL = el('button', 'fb-edge fb-edge-l', stage);
    this.edgeL.innerHTML = '‹'; this.edgeL.title = 'หน้าก่อนหน้า (←)';
    this.loupe = el('div', 'fb-loupe', stage);
    this.loupeInner = el('div', 'fb-loupe-inner', this.loupe);

    this.edgeR = el('button', 'fb-edge fb-edge-r', stage);
    this.edgeR.innerHTML = '›'; this.edgeR.title = 'หน้าถัดไป (→)';

    /* --- panels ---------------------------------------------------- */
    var thumbs = this.panelThumbs = el('div', 'fb-panel fb-panel-thumbs', root);
    el('div', 'fb-panel-title', thumbs).textContent = 'สารบัญ';
    this.thumbGrid = el('div', 'fb-thumb-grid', thumbs);

    var search = this.panelSearch = el('div', 'fb-panel fb-panel-search', root);
    el('div', 'fb-panel-title', search).textContent = 'ค้นหาข้อความ';
    var sbox = el('div', 'fb-search-box', search);
    this.searchInput = el('input', null, sbox);
    this.searchInput.type = 'search';
    this.searchInput.placeholder = 'พิมพ์คำที่ต้องการค้นหา';
    this.searchResults = el('div', 'fb-search-results', search);

    /* --- toolbar --------------------------------------------------- */
    var bar = this.bar = el('div', 'fb-bar', root);

    this.btnThumbs = this._tool(bar, '☰', 'สารบัญ');
    this.btnSearch = this._tool(bar, '⌕', 'ค้นหา');
    el('div', 'fb-sep', bar);

    this.btnFirst = this._tool(bar, '«', 'หน้าแรก (Home)');
    this.btnPrev = this._tool(bar, '‹', 'หน้าก่อนหน้า (←)');

    var mid = el('div', 'fb-bar-mid', bar);
    this.range = el('input', 'fb-range', mid);
    this.range.type = 'range'; this.range.min = 0; this.range.step = 1; this.range.value = 0;
    this.label = el('span', 'fb-label', mid);

    this.btnNext = this._tool(bar, '›', 'หน้าถัดไป (→)');
    this.btnLast = this._tool(bar, '»', 'หน้าสุดท้าย (End)');
    el('div', 'fb-sep', bar);

    this.btnZoomOut = this._tool(bar, '−', 'ย่อ');
    this.btnZoomIn = this._tool(bar, '+', 'ขยาย');
    this.btnLoupe = this._tool(bar, '🔍', 'แว่นขยาย (M) — หมุนล้อเพื่อปรับกำลังขยาย');
    this.btnPlay = this._tool(bar, '▶', 'เล่นอัตโนมัติ');
    this.btnSound = this._tool(bar, o.sound ? '🔊' : '🔇', 'เสียงพลิกหน้า');
    this.btnFull = this._tool(bar, '⛶', 'เต็มจอ (F)');

    this._buildThumbs();
  };

  P._tool = function (bar, glyph, title) {
    var b = el('button', 'fb-tool', bar);
    b.innerHTML = glyph;
    b.title = title;
    b.setAttribute('aria-label', title);
    return b;
  };

  /* Thumbnails hold a full copy of every page, so their sources stay unset
     until the contents panel is actually opened. Otherwise opening the book
     would download the whole thing up front — the panel is off-screen by
     transform, which loading="lazy" does not treat as offscreen. */
  P._buildThumbs = function () {
    var self = this;
    this.thumbGrid.innerHTML = '';
    this.thumbsLoaded = false;
    this.pages.forEach(function (p, i) {
      var b = el('button', 'fb-thumb', self.thumbGrid);
      var im = el('img', null, b);
      im.dataset.src = p.src;
      im.loading = 'lazy';
      im.alt = 'หน้า ' + (i + 1);
      el('span', null, b).textContent = i + 1;
      b.onclick = function () { self.toPage(i, true); self._closePanels(); };
    });
  };

  P._loadThumbs = function () {
    if (this.thumbsLoaded) return;
    this.thumbsLoaded = true;
    var imgs = this.thumbGrid.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      if (imgs[i].dataset.src) imgs[i].src = imgs[i].dataset.src;
    }
  };

  /* --------------------------------------------------------------- events */

  P._bind = function () {
    var self = this;

    this.btnNext.onclick = this.edgeR.onclick = function () { self.next(); };
    this.btnPrev.onclick = this.edgeL.onclick = function () { self.prev(); };
    this.btnFirst.onclick = function () { self.toPage(0, true); };
    this.btnLast.onclick = function () { self.toPage(self.pages.length - 1, true); };
    this.btnFull.onclick = function () { self.toggleFullscreen(); };
    this.btnZoomIn.onclick = function () { self.setZoom(self.zoom + 0.5); };
    this.btnZoomOut.onclick = function () { self.setZoom(self.zoom - 0.5); };
    this.btnPlay.onclick = function () { self.toggleAutoplay(); };
    this.btnLoupe.onclick = function () { self.toggleLoupe(); };

    this.btnSound.onclick = function () {
      self.opt.sound = !self.opt.sound;
      this.innerHTML = self.opt.sound ? '🔊' : '🔇';
    };
    this.btnThumbs.onclick = function () {
      self._togglePanel(self.panelThumbs);
      if (self.panelThumbs.classList.contains('open')) self._loadThumbs();
    };
    this.btnSearch.onclick = function () {
      self._togglePanel(self.panelSearch);
      if (self.panelSearch.classList.contains('open')) self.searchInput.focus();
    };
    this.searchInput.oninput = function () { self._search(this.value); };
    this.range.oninput = function () { self.toPage(Number(this.value), true); };

    this._onKey = function (e) {
      if (e.target && /^(input|textarea|select)$/i.test(e.target.tagName)) {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { self.next(); e.preventDefault(); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { self.prev(); e.preventDefault(); }
      else if (e.key === 'Home') self.toPage(0, true);
      else if (e.key === 'End') self.toPage(self.pages.length - 1, true);
      else if (e.key === 'f' || e.key === 'F') self.toggleFullscreen();
      else if (e.key === 'm' || e.key === 'M') self.toggleLoupe();
      else if (e.key === 'Escape') self._closePanels();
    };
    document.addEventListener('keydown', this._onKey);

    this._onResize = function () { self.layout(); };
    global.addEventListener('resize', this._onResize);
    /* The stage can be laid out at zero width (hidden tab, closed overlay),
       which would lock 'auto' mode into single-page. Watch the element itself. */
    if (global.ResizeObserver) {
      this._ro = new ResizeObserver(function () { self.layout(); });
      this._ro.observe(this.stage);
    }

    this._bindPointer();
  };

  P._togglePanel = function (panel) {
    var open = panel.classList.contains('open');
    this._closePanels();
    if (!open) panel.classList.add('open');
  };
  P._closePanels = function () {
    this.panelThumbs.classList.remove('open');
    this.panelSearch.classList.remove('open');
  };

  /* ------------------------------------------------------------ geometry */

  P.isDouble = function () {
    if (this.opt.mode === 'single') return false;
    if (this.opt.mode === 'double') return true;
    return this.stage.clientWidth >= 760;                 // auto
  };

  P.layout = function () {
    var dbl = this.isDouble();
    this.root.classList.toggle('fb-single', !dbl);

    var ratio = 0.707;                                    // A4 portrait fallback
    var p = this.pages[0];
    if (p && p.w && p.h) ratio = p.w / p.h;

    var pad = this.stage.clientWidth < 600 ? 10 : 30;
    var aw = Math.max(120, this.stage.clientWidth - pad * 2);
    var ah = Math.max(120, this.stage.clientHeight - pad * 2);
    var cols = dbl ? 2 : 1;

    var h = ah, w = h * ratio * cols;
    if (w > aw) { w = aw; h = w / (ratio * cols); }
    w *= this.zoom; h *= this.zoom;

    this.pageW = w / cols;
    this.pageH = h;
    this.book.style.width = Math.round(w) + 'px';
    this.book.style.height = Math.round(h) + 'px';
    this.stage.style.perspective = Math.round(w * 2.4) + 'px';
    this._render();
  };

  P.setZoom = function (z) {
    var was = this.zoom;
    this.zoom = clamp(z, 1, 3);
    if (this.zoom === was) return;
    this.stage.classList.toggle('fb-zoomed', this.zoom > 1);
    this.layout();
    if (this.zoom > 1) {
      this.stage.scrollLeft = (this.stage.scrollWidth - this.stage.clientWidth) / 2;
      this.stage.scrollTop = (this.stage.scrollHeight - this.stage.clientHeight) / 2;
    }
  };

  /* ------------------------------------------------------------ painting */

  P._paint = function (slot, index) {
    slot.innerHTML = '';
    var p = this.pages[index];
    if (!p) { slot.classList.add('fb-blank'); return; }
    slot.classList.remove('fb-blank');
    var img = el('img', null, slot);
    img.src = p.src; img.draggable = false; img.alt = 'หน้า ' + (index + 1);
    el('div', 'fb-gloss', slot);
  };

  /* A closed book (cover, or a final odd page) shows only one leaf, so slide the
     spread sideways to keep the visible page centred instead of leaving a gap. */
  P._offsetFor = function (cur) {
    if (!this.isDouble()) return 0;
    var leftBlank = (cur * 2 - 1) < 0;
    var rightBlank = (cur * 2) >= this.pages.length;
    if (leftBlank === rightBlank) return 0;
    return leftBlank ? -25 : 25;
  };

  P._applyOffset = function (cur) {
    this.book.style.transform = 'translateX(' + this._offsetFor(cur) + '%)';
  };

  P._render = function () {
    this._applyOffset(this.cur);
    if (this.isDouble()) {
      this._paint(this.slotL, this.cur * 2 - 1);
      this._paint(this.slotR, this.cur * 2);
    } else {
      this._paint(this.slotL, -1);
      this._paint(this.slotR, this.cur);
    }
    this._updateNav();
    this._syncLoupe();          // must follow the repaint, or it lags a spread
  };

  P._updateNav = function () {
    var n = this.pages.length;
    var first = this.isDouble() ? Math.max(1, this.cur * 2) : this.cur + 1;
    var last = this.isDouble() ? Math.min(n, this.cur * 2 + 1) : first;
    this.label.textContent = (first === last ? first : first + '–' + last) + ' / ' + n;
    this.range.max = Math.max(0, n - 1);
    this.range.value = this.isDouble() ? Math.max(0, this.cur * 2 - 1) : this.cur;

    var canN = this.canNext(), canP = this.canPrev();
    this.btnNext.disabled = this.btnLast.disabled = this.edgeR.disabled = !canN;
    this.btnPrev.disabled = this.btnFirst.disabled = this.edgeL.disabled = !canP;

    var cur = this.cur;
    var kids = this.thumbGrid.children;
    for (var i = 0; i < kids.length; i++) {
      var active = this.isDouble() ? (i === cur * 2 || i === cur * 2 - 1) : i === cur;
      kids[i].classList.toggle('active', active);
    }
  };

  /* Highest reachable spread index. In double mode a spread shows pages
     (2*cur - 1) and (2*cur), so the last one that still holds a real page is
     floor(N/2) — for an even N that is the back page sitting alone on the left. */
  P.maxIndex = function () {
    if (!this.pages.length) return 0;
    return this.isDouble() ? Math.floor(this.pages.length / 2) : this.pages.length - 1;
  };
  P.canNext = function () { return this.cur < this.maxIndex(); };
  P.canPrev = function () { return this.cur > 0; };

  /* ------------------------------------------------------------- turning */

  /* The turning leaf is always a right-hand leaf hinged at the spine;
     a backward turn is the same leaf played from -180deg back to 0. */
  P._makeLeaf = function (dir) {
    var frontIdx, backIdx;
    if (this.isDouble()) {
      frontIdx = dir > 0 ? this.cur * 2 : (this.cur - 1) * 2;
      backIdx = frontIdx + 1;
    } else {
      frontIdx = dir > 0 ? this.cur : this.cur - 1;
      backIdx = -1;                                       // single view: blank reverse
    }
    var leaf = el('div', 'fb-leaf', this.book);
    var front = el('div', 'fb-face fb-front', leaf);
    var back = el('div', 'fb-face fb-back', leaf);
    this._paint(front, frontIdx);
    this._paint(back, backIdx);
    el('div', 'fb-shade', front);
    el('div', 'fb-shade', back);
    leaf.style.transform = 'rotateY(' + (dir > 0 ? 0 : -180) + 'deg)';
    return leaf;
  };

  P._revealUnder = function (dir) {
    if (this.isDouble()) {
      if (dir > 0) this._paint(this.slotR, (this.cur + 1) * 2);
      else this._paint(this.slotL, (this.cur - 1) * 2 - 1);
    } else if (dir > 0) {
      this._paint(this.slotR, this.cur + 1);
    }
  };

  P._setAngle = function (leaf, deg) {
    leaf.style.transform = 'rotateY(' + deg + 'deg)';
    var t = Math.abs(deg) / 180;
    var f = leaf.firstChild.lastChild, b = leaf.lastChild.lastChild;
    if (f) f.style.opacity = (t * 0.7).toFixed(3);
    if (b) b.style.opacity = ((1 - t) * 0.7).toFixed(3);
  };

  P.next = function () { this._turn(1); };
  P.prev = function () { this._turn(-1); };

  P._turn = function (dir) {
    if (this.busy || !this.pages.length) return;
    if (dir > 0 ? !this.canNext() : !this.canPrev()) return;
    var self = this;
    this.busy = true;
    if (this.opt.sound) this.sfx();

    var leaf = this._makeLeaf(dir);
    this._revealUnder(dir);
    this._applyOffset(this.cur + dir);

    var from = dir > 0 ? 0 : -180;
    var to = dir > 0 ? -180 : 0;
    var t0 = performance.now(), dur = this.opt.duration;
    this._setAngle(leaf, from);

    (function frame(now) {
      var t = clamp((now - t0) / dur, 0, 1);
      var e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;   // easeInOutQuad
      self._setAngle(leaf, from + (to - from) * e);
      if (t < 1) requestAnimationFrame(frame);
      else {
        self.cur += dir;
        self._render();
        leaf.remove();
        self.busy = false;
      }
    })(t0);
  };

  P.toPage = function (page, instant) {
    if (!this.pages.length) return;
    var target = clamp(page, 0, this.pages.length - 1);
    var idx = clamp(this.isDouble() ? Math.ceil(target / 2) : target, 0, this.maxIndex());
    if (idx === this.cur) { this._updateNav(); return; }
    if (instant || this.busy || Math.abs(idx - this.cur) > 1) {
      this.cur = idx;
      this._render();
      return;
    }
    this._turn(idx > this.cur ? 1 : -1);
  };

  /* --------------------------------------------------- drag to turn / pan */

  P._bindPointer = function () {
    var self = this, drag = null, pan = null;

    this.stage.addEventListener('pointermove', function (e) { self._moveLoupe(e); });
    this.stage.addEventListener('pointerdown', function (e) { self._moveLoupe(e); });
    this.stage.addEventListener('pointerleave', function () { self._hideLoupe(); });
    this.stage.addEventListener('wheel', function (e) {
      if (!self.loupeOn) return;
      e.preventDefault();
      self.loupeK = clamp(self.loupeK + (e.deltaY < 0 ? 0.25 : -0.25), 1.5, 5);
      self._moveLoupe(e);
    }, { passive: false });

    this.book.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || self.loupeOn) return;
      if (self.zoom > 1) {
        pan = { x: e.clientX, y: e.clientY, sl: self.stage.scrollLeft, st: self.stage.scrollTop };
        self.stage.classList.add('fb-grabbing');
        return;
      }
      if (self.busy || !self.pages.length) return;
      var r = self.book.getBoundingClientRect();
      var dir = (!self.isDouble() || (e.clientX - r.left) > r.width / 2) ? 1 : -1;
      if (dir > 0 ? !self.canNext() : !self.canPrev()) return;
      drag = { dir: dir, x0: e.clientX, moved: 0, leaf: null, p: 0 };
      try { self.book.setPointerCapture(e.pointerId); } catch (err) { /* older Safari */ }
    });

    this.book.addEventListener('pointermove', function (e) {
      if (pan) {
        self.stage.scrollLeft = pan.sl - (e.clientX - pan.x);
        self.stage.scrollTop = pan.st - (e.clientY - pan.y);
        return;
      }
      if (!drag) return;
      var dx = e.clientX - drag.x0;
      drag.moved = Math.max(drag.moved, Math.abs(dx));
      if (drag.moved < 8) return;
      if (!drag.leaf) {
        self.busy = true;
        self.stopAutoplay();
        drag.leaf = self._makeLeaf(drag.dir);
        self._revealUnder(drag.dir);
      }
      drag.p = clamp((drag.dir > 0 ? -dx : dx) / self.pageW, 0, 1);
      self._setAngle(drag.leaf, drag.dir > 0 ? -180 * drag.p : -180 * (1 - drag.p));
    });

    function release(e) {
      if (pan) { pan = null; self.stage.classList.remove('fb-grabbing'); return; }
      if (!drag) return;
      var d = drag; drag = null;
      try { self.book.releasePointerCapture(e.pointerId); } catch (err) {}

      if (!d.leaf) {                                       // a tap, not a drag
        if (d.moved < 8) { d.dir > 0 ? self.next() : self.prev(); }
        return;
      }
      var commit = d.p > 0.32;
      if (commit) self._applyOffset(self.cur + d.dir);
      var cur = d.dir > 0 ? -180 * d.p : -180 * (1 - d.p);
      var to = commit ? (d.dir > 0 ? -180 : 0) : (d.dir > 0 ? 0 : -180);
      var t0 = performance.now(), dur = self.opt.duration * 0.55;
      if (commit && self.opt.sound) self.sfx();

      (function frame(now) {
        var t = clamp((now - t0) / dur, 0, 1);
        self._setAngle(d.leaf, cur + (to - cur) * (1 - Math.pow(1 - t, 3)));
        if (t < 1) requestAnimationFrame(frame);
        else {
          if (commit) self.cur += d.dir;
          self._render();
          d.leaf.remove();
          self.busy = false;
        }
      })(t0);
    }

    this.book.addEventListener('pointerup', release);
    this.book.addEventListener('pointercancel', release);
    this.book.addEventListener('dragstart', function (e) { e.preventDefault(); });
  };

  /* -------------------------------------------------------------- search */

  P._search = function (q) {
    var self = this;
    q = (q || '').trim();
    this.searchResults.innerHTML = '';
    if (!q) return;

    var hasText = this.pages.some(function (p) { return p.text; });
    if (!hasText) {
      el('div', 'fb-search-empty', this.searchResults).textContent =
        'หนังสือเล่มนี้ไม่มีชั้นข้อความ (นำเข้าจากรูปภาพ) จึงค้นหาไม่ได้';
      return;
    }
    var needle = q.toLowerCase(), hits = 0;
    this.pages.forEach(function (p, i) {
      if (!p.text) return;
      var hay = p.text.toLowerCase(), at = hay.indexOf(needle);
      if (at < 0) return;
      hits++;
      var b = el('button', 'fb-search-hit', self.searchResults);
      el('strong', null, b).textContent = 'หน้า ' + (i + 1);
      var snip = p.text.slice(Math.max(0, at - 40), at + needle.length + 60).replace(/\s+/g, ' ');
      el('span', null, b).textContent = '…' + snip + '…';
      b.onclick = function () { self.toPage(i, true); };
    });
    if (!hits) {
      el('div', 'fb-search-empty', this.searchResults).textContent = 'ไม่พบคำว่า "' + q + '"';
    }
  };

  /* --------------------------------------------------------------- loupe */

  P.toggleLoupe = function (on) {
    this.loupeOn = on === undefined ? !this.loupeOn : !!on;
    this.btnLoupe.classList.toggle('active', this.loupeOn);
    this.root.classList.toggle('fb-loupe-on', this.loupeOn);
    if (this.loupeOn) this._syncLoupe(); else this._hideLoupe();
  };

  P._loupeRadius = function () {
    return Math.round(clamp(this.stage.clientWidth * 0.13, 58, 120));
  };

  P._hideLoupe = function () {
    if (this.loupe) this.loupe.classList.remove('show');
  };

  /* The magnified view is a plain copy of the current spread, so it inherits
     every slot style (gutter shading, single-page mode) for free. */
  P._syncLoupe = function () {
    if (!this.loupeOn || !this.loupeInner) return;
    this.loupeInner.innerHTML = '';
    this.loupeInner.appendChild(this.slotL.cloneNode(true));
    this.loupeInner.appendChild(this.slotR.cloneNode(true));
  };

  P._moveLoupe = function (e) {
    if (!this.loupeOn || this.busy || this.zoom > 1) { this._hideLoupe(); return; }

    var br = this.book.getBoundingClientRect();
    var bx = e.clientX - br.left, by = e.clientY - br.top;
    if (bx < 0 || by < 0 || bx > br.width || by > br.height) { this._hideLoupe(); return; }

    /* nothing to magnify over the empty half of a closed book */
    var over = (!this.isDouble() || bx > br.width / 2) ? this.slotR : this.slotL;
    if (over.classList.contains('fb-blank')) { this._hideLoupe(); return; }

    var sr = this.stage.getBoundingClientRect();
    var R = this._loupeRadius(), k = this.loupeK;

    this.loupe.style.width = this.loupe.style.height = (R * 2) + 'px';
    this.loupe.style.left = (e.clientX - sr.left - R) + 'px';
    this.loupe.style.top = (e.clientY - sr.top - R) + 'px';
    this.loupeInner.style.width = br.width + 'px';
    this.loupeInner.style.height = br.height + 'px';
    this.loupeInner.style.transform =
      'translate(' + (R - bx * k) + 'px,' + (R - by * k) + 'px) scale(' + k + ')';
    this.loupe.classList.add('show');
  };

  /* ------------------------------------------------------------ autoplay */

  P.toggleAutoplay = function () {
    if (this.timer) this.stopAutoplay(); else this.startAutoplay();
  };
  P.startAutoplay = function () {
    var self = this;
    this.stopAutoplay();
    this.btnPlay.innerHTML = '⏸';
    this.btnPlay.classList.add('active');
    this.timer = setInterval(function () {
      if (self.canNext()) self.next();
      else self.toPage(0, true);
    }, this.opt.autoplayDelay);
  };
  P.stopAutoplay = function () {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.btnPlay.innerHTML = '▶';
    this.btnPlay.classList.remove('active');
  };

  /* ---------------------------------------------------------------- misc */

  P.toggleFullscreen = function () {
    var t = this.mount;
    if (!document.fullscreenElement) {
      (t.requestFullscreen || t.webkitRequestFullscreen || function () {}).call(t);
    } else {
      document.exitFullscreen();
    }
  };

  P.setPages = function (pages) {
    this.pages = (pages || []).slice();
    this.cur = clamp(this.cur, 0, this.maxIndex());
    this._buildThumbs();
    this.layout();
  };

  P.setOption = function (key, value) {
    this.opt[key] = value;
    if (key === 'bg') this.root.style.setProperty('--fb-bg', value);
    if (key === 'mode') { this.cur = 0; this.layout(); }
  };

  P.destroy = function () {
    this.stopAutoplay();
    if (this._ro) this._ro.disconnect();
    document.removeEventListener('keydown', this._onKey);
    global.removeEventListener('resize', this._onResize);
    this.mount.innerHTML = '';
    this.mount.classList.remove('fb-mount');
  };

  global.Flipbook = Flipbook;
})(window);
