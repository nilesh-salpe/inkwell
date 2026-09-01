/* ============================================================
   AES-GCM encryption with a passphrase.

   Key derivation is PBKDF2-SHA256; the output carries its own
   salt and IV so a message is self-contained. This protects a
   message in transit between two people who already share a
   passphrase — it is not a key-management system, and the
   passphrase is the whole of the security.
   ============================================================ */
(function () {
  'use strict';

  const $ = Shell.$;
  const escapeHtml = Shell.escapeHtml;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const els = { pass: $('#a-pass'), iter: $('#a-iter'), status: $('#a-status') };
  const MODE_KEY = 'inkwell.aes.mode';
  let mode = Shell.lsGet(MODE_KEY, 'encrypt');

  const SALT_LEN = 16, IV_LEN = 12;
  const MAGIC = [0x49, 0x57, 0x31];        /* "IW1" — so we can recognise our own output */

  function b64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function unb64(s) {
    const clean = s.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    if (!/^[A-Za-z0-9+/]+=*$/.test(clean)) throw new Error('This does not look like an encrypted message');
    let p = clean; while (p.length % 4) p += '=';
    const bin = atob(p);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function deriveKey(pass, salt, iterations) {
    return crypto.subtle
      .importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey'])
      .then((base) => crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
        base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
  }

  const iterations = () => Math.max(10000, Math.min(2000000, parseInt(els.iter.value, 10) || 250000));

  async function encrypt(text, pass) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
    const iter = iterations();
    const key = await deriveKey(pass, salt, iter);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text)));

    /* magic | iterations (4 bytes) | salt | iv | ciphertext+tag */
    const out = new Uint8Array(3 + 4 + SALT_LEN + IV_LEN + ct.length);
    out.set(MAGIC, 0);
    new DataView(out.buffer).setUint32(3, iter);
    out.set(salt, 7);
    out.set(iv, 7 + SALT_LEN);
    out.set(ct, 7 + SALT_LEN + IV_LEN);
    return { text: b64(out), iter, bytes: out.length };
  }

  async function decrypt(blob, pass) {
    const raw = unb64(blob);
    if (raw.length < 7 + SALT_LEN + IV_LEN + 16) throw new Error('The message is too short to be valid');
    if (raw[0] !== MAGIC[0] || raw[1] !== MAGIC[1] || raw[2] !== MAGIC[2]) {
      throw new Error('Not a message produced by this tool');
    }
    const iter = new DataView(raw.buffer, raw.byteOffset).getUint32(3);
    const salt = raw.slice(7, 7 + SALT_LEN);
    const iv = raw.slice(7 + SALT_LEN, 7 + SALT_LEN + IV_LEN);
    const ct = raw.slice(7 + SALT_LEN + IV_LEN);
    const key = await deriveKey(pass, salt, iter);
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
      return { text: dec.decode(plain), iter, bytes: raw.length };
    } catch (e) {
      throw new Error('Wrong passphrase, or the message has been altered');
    }
  }

  /* ---------- rendering ---------- */
  let token = 0;

  function render(src, preview) {
    const mine = ++token;
    const pass = els.pass ? els.pass.value : '';

    if (!src.trim()) {
      preview.innerHTML = '<p class="j-empty">' +
        (mode === 'encrypt' ? 'Type the message to encrypt on the left.' : 'Paste an encrypted message on the left.') +
        '</p>';
      setStatus('', '');
      return;
    }
    if (!pass) {
      preview.innerHTML = '<div class="csv-note">Enter a passphrase above to ' + mode + '.</div>';
      setStatus('warn', 'passphrase needed');
      return;
    }
    if (!window.crypto || !crypto.subtle) {
      preview.innerHTML = '<div class="jwt-warn">This browser does not expose WebCrypto here.</div>';
      return;
    }

    preview.innerHTML = '<p class="j-empty">Deriving the key…</p>';
    setStatus('', 'working');

    const job = mode === 'encrypt' ? encrypt(src, pass) : decrypt(src, pass);
    job.then((r) => {
      if (mine !== token) return;
      setStatus('ok', mode === 'encrypt' ? 'encrypted' : 'decrypted');
      preview.innerHTML =
        '<section class="esc-card" data-value="' + escapeHtml(r.text) + '">' +
        '<div class="esc-head"><span class="esc-label">' +
        (mode === 'encrypt' ? 'Encrypted message' : 'Decrypted text') + '</span>' +
        '<button class="mini esc-copy" data-tip="Copy the result" aria-label="Copy the result">Copy</button>' +
        '<button class="mini esc-use" data-tip="Put this in the editor" aria-label="Put this in the editor">Use</button>' +
        '</div><pre class="esc-out">' + escapeHtml(r.text) + '</pre></section>' +
        '<section class="esc-card"><div class="esc-head"><span class="esc-label">Parameters</span></div>' +
        '<table class="jwt-claims"><tbody>' +
        '<tr><td>Cipher</td><td>AES-256-GCM</td></tr>' +
        '<tr><td>Key derivation</td><td>PBKDF2-SHA256, ' + r.iter.toLocaleString() + ' iterations</td></tr>' +
        '<tr><td>Salt / IV</td><td>' + SALT_LEN + ' and ' + IV_LEN + ' random bytes, carried in the message</td></tr>' +
        '<tr><td>Message size</td><td>' + r.bytes.toLocaleString() + ' bytes before base64</td></tr>' +
        '</tbody></table></section>';
    }).catch((e) => {
      if (mine !== token) return;
      setStatus('bad', 'failed');
      preview.innerHTML = DataTools
        ? DataTools.errorCard(mode === 'encrypt' ? 'Could not encrypt' : 'Could not decrypt', { message: e.message })
        : '<div class="jwt-warn">' + escapeHtml(e.message) + '</div>';
    });
  }

  function setStatus(state, text) {
    if (!els.status) return;
    els.status.textContent = text;
    els.status.className = 'v-status' + (state ? ' is-' + state : '');
  }

  /* ---------- go ---------- */
  const api = Shell.create({
    tool: 'aes',
    ext: 'txt',
    mime: 'text/plain',
    blank: '',
    sampleTitle: 'Example message',
    swPath: '../sw.js',
    focusControl: '#a-pass',
    persist: false,               /* plaintext and passphrases stay out of storage */
    commands: {
      clear: (a) => { a.replaceAllText(''); a.el.editor.focus(); },
      swap: () => setMode(mode === 'encrypt' ? 'decrypt' : 'encrypt')
    },
    shortcuts: {},
    deriveTitle: () => mode === 'encrypt' ? 'Message' : 'Encrypted message',
    docSummary: (c) => c.length + ' characters',
    updateStatus: (v) => {
      $('#st-chars').textContent = v.length.toLocaleString() + ' characters';
      $('#st-mode').textContent = mode;
    },
    render: render,
    htmlDocument: (title, body) =>
      '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>' + escapeHtml(title) + '</title>\n' +
      '<style>body{font:14px/1.6 -apple-system,sans-serif;max-width:760px;margin:0 auto;padding:48px 24px}' +
      'pre{background:#f4f5f7;padding:10px;border-radius:8px;white-space:pre-wrap;word-break:break-all}' +
      'button{display:none}</style>\n</head>\n<body>\n' + body + '\n</body>\n</html>\n'
  });

  function setMode(next) {
    mode = next;
    Shell.lsSet(MODE_KEY, mode);
    Shell.$$('.esc-mode').forEach((b) => b.classList.toggle('is-active', b.dataset.mode === mode));
    api.el.editor.placeholder = mode === 'encrypt'
      ? 'Type the message to encrypt…' : 'Paste the encrypted message…';
    api.render();
    api.el.editor.dispatchEvent(new Event('input', { bubbles: true }));
  }
  Shell.$$('.esc-mode').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  let t = null;
  [els.pass, els.iter].forEach((n) => {
    if (n) n.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => api.render(), 350); });
  });

  api.el.preview.addEventListener('click', async (e) => {
    const card = e.target.closest('.esc-card');
    if (!card || !card.dataset.value) return;
    if (e.target.closest('.esc-copy')) {
      Shell.toast(await Shell.copyText(card.dataset.value) ? 'Copied' : 'Copy failed');
    } else if (e.target.closest('.esc-use')) {
      api.replaceAllText(card.dataset.value);
      setMode(mode === 'encrypt' ? 'decrypt' : 'encrypt');
    }
  });

  setMode(mode);
})();
