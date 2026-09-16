/* Password protection for exported books — real encryption, not a JS gate.

   Every page image (and its text layer) is encrypted with AES-256-GCM before
   it ever leaves the editor. The key is derived from the password with
   PBKDF2-SHA256. Nothing in the published files can be read without the
   password: downloading pages/001.bin gets you ciphertext.

   What this protects against: someone who has the link, or who downloads the
   files, reading the book without the password.
   What it does not protect against: someone who knows the password passing it
   on, or passing on what they decrypted. And because the ciphertext is public,
   a weak password can be attacked offline — so use a long one.

   Requires window.crypto.subtle, i.e. an https:// (or localhost/file://) page.

   Used by the editor to encrypt, and inlined into encrypted exports to unlock.
*/
(function (global) {
  'use strict';

  var ITERATIONS = 250000;
  var TOKEN = 'flipbook-ok';           // plaintext of the password check blob

  function subtle() {
    var c = global.crypto && global.crypto.subtle;
    if (!c) throw new Error('เบราว์เซอร์นี้ไม่รองรับการเข้ารหัส (ต้องเปิดผ่าน https)');
    return c;
  }

  function rand(n) {
    var b = new Uint8Array(n);
    global.crypto.getRandomValues(b);
    return b;
  }

  function utf8(s) { return new TextEncoder().encode(s); }
  function fromUtf8(b) { return new TextDecoder().decode(b); }

  function toB64(bytes) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(s);
  }

  function fromB64(b64) {
    var s = atob(b64), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  /* iv is prepended to the ciphertext so one blob carries everything. */
  function seal(key, bytes) {
    var iv = rand(12);
    return subtle().encrypt({ name: 'AES-GCM', iv: iv }, key, bytes).then(function (ct) {
      var out = new Uint8Array(12 + ct.byteLength);
      out.set(iv, 0);
      out.set(new Uint8Array(ct), 12);
      return out;
    });
  }

  function open(key, blob) {
    var iv = blob.subarray(0, 12);
    return subtle().decrypt({ name: 'AES-GCM', iv: iv }, key, blob.subarray(12))
      .then(function (buf) { return new Uint8Array(buf); });
  }

  function deriveKey(password, salt, iterations) {
    return subtle().importKey('raw', utf8(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return subtle().deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
          base,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
      });
  }

  /* ------------------------------------------------------- editor side */

  /* pages: [{ src: dataURI, w, h, text }]
     -> { meta, items: [{ w, h, bytes, text }] }  (bytes/text are Uint8Array) */
  function encryptPages(pages, password, onProgress) {
    var salt = rand(16);
    var meta = {
      v: 1,
      kdf: 'PBKDF2-SHA256',
      iterations: ITERATIONS,
      cipher: 'AES-GCM',
      salt: toB64(salt)
    };
    var key;

    return deriveKey(password, salt, ITERATIONS)
      .then(function (k) { key = k; return seal(key, utf8(TOKEN)); })
      .then(function (check) {
        meta.check = toB64(check);
        var items = [];

        return pages.reduce(function (chain, p, i) {
          return chain.then(function () {
            var m = /^data:image\/(\w+);base64,(.*)$/.exec(p.src);
            if (!m) throw new Error('หน้า ' + (i + 1) + ' ไม่ใช่รูปแบบที่รองรับ');
            var item = { w: p.w, h: p.h, type: m[1] === 'jpeg' ? 'jpeg' : m[1] };
            return seal(key, fromB64(m[2]))
              .then(function (b) {
                item.bytes = b;
                return p.text ? seal(key, utf8(p.text)) : null;
              })
              .then(function (t) {
                item.text = t;
                items.push(item);
                if (onProgress) onProgress((i + 1) / pages.length);
              });
          });
        }, Promise.resolve()).then(function () {
          return { meta: meta, items: items };
        });
      });
  }

  /* ------------------------------------------------------- viewer side */

  function el(tag, cls, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }

  /* book.pages entries carry either `data` (base64) or `file` (a relative
     path to the ciphertext), plus optional `text` (base64). */
  function fetchCipher(p) {
    if (p.data) return Promise.resolve(fromB64(p.data));
    return fetch(p.file).then(function (r) {
      if (!r.ok) throw new Error('โหลด ' + p.file + ' ไม่สำเร็จ');
      return r.arrayBuffer();
    }).then(function (b) { return new Uint8Array(b); });
  }

  function blobUrl(bytes, type) {
    return URL.createObjectURL(new Blob([bytes], { type: 'image/' + (type || 'jpeg') }));
  }

  /* Renders the lock screen, then boots the reader once unlocked. */
  function mount(host, book) {
    var meta = book.meta;
    var wrap = el('div', 'fb-lock', host);
    var card = el('form', 'fb-lock-card', wrap);
    el('div', 'fb-lock-icon', card).textContent = '🔒';
    el('h1', null, card).textContent = book.title || 'หนังสือนี้ถูกล็อกไว้';
    el('p', null, card).textContent = 'กรอกรหัสผ่านเพื่อเปิดอ่าน';

    var input = el('input', 'fb-lock-input', card);
    input.type = 'password';
    input.autocomplete = 'current-password';
    input.placeholder = 'รหัสผ่าน';
    input.setAttribute('aria-label', 'รหัสผ่าน');

    var btn = el('button', 'fb-lock-btn', card);
    btn.type = 'submit';
    btn.textContent = 'เปิดอ่าน';

    var msg = el('div', 'fb-lock-msg', card);
    setTimeout(function () { input.focus(); }, 60);

    function fail(text) {
      msg.textContent = text;
      msg.className = 'fb-lock-msg error';
      card.classList.remove('busy');
      card.classList.add('shake');
      setTimeout(function () { card.classList.remove('shake'); }, 500);
      btn.disabled = false;
      input.disabled = false;
      input.select();
    }

    card.addEventListener('submit', function (e) {
      e.preventDefault();
      var pw = input.value;
      if (!pw) { fail('กรุณากรอกรหัสผ่าน'); return; }

      btn.disabled = true;
      input.disabled = true;
      card.classList.add('busy');
      msg.className = 'fb-lock-msg';
      msg.textContent = 'กำลังตรวจสอบรหัสผ่าน…';

      var key;
      // let the message paint before the CPU-bound key derivation starts
      setTimeout(function () {
        deriveKey(pw, fromB64(meta.salt), meta.iterations)
          .then(function (k) {
            key = k;
            return open(key, fromB64(meta.check));
          })
          .then(function (tok) {
            if (fromUtf8(tok) !== TOKEN) throw new Error('bad');
            msg.textContent = 'กำลังถอดรหัสหน้าแรก…';
            return unlock(host, wrap, book, key, msg);
          })
          .catch(function (err) {
            if (err && /https|รองรับ/.test(err.message)) fail(err.message);
            else fail('รหัสผ่านไม่ถูกต้อง');
          });
      }, 30);
    });
  }

  /* Decrypt page 1, start the reader, then fill in the rest in the
     background so a big book still opens quickly. */
  function unlock(host, lockEl, book, key, msg) {
    var pages = book.pages.map(function (p) {
      return { src: '', w: p.w, h: p.h, text: '' };
    });

    function decryptOne(i) {
      var p = book.pages[i];
      return fetchCipher(p)
        .then(function (ct) { return open(key, ct); })
        .then(function (bytes) {
          pages[i].src = blobUrl(bytes, p.type);
          if (!p.text) return null;
          return open(key, fromB64(p.text)).then(function (t) {
            pages[i].text = fromUtf8(t);
          });
        });
    }

    return decryptOne(0).then(function () {
      lockEl.remove();
      var fb = new global.Flipbook(host, {
        pages: pages,
        mode: book.mode,
        duration: book.duration,
        sound: book.sound,
        bg: book.bg
      });

      var i = 1;
      (function next() {
        if (i >= book.pages.length) { fb.setPages(pages); return; }
        var at = i++;
        decryptOne(at)
          .then(function () {
            fb.setPages(pages);       // refresh thumbnails and the live spread
            next();
          })
          .catch(function (e) { console.error('หน้า ' + (at + 1), e); next(); });
      })();
      return fb;
    });
  }

  global.FlipbookProtect = {
    encryptPages: encryptPages,
    mount: mount,
    ITERATIONS: ITERATIONS
  };
})(window);
