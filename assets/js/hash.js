/* ============================================================
   Hash and HMAC.

   Hashing is one-way: there is no "decode" here, and any site
   offering to reverse SHA-256 is running a lookup table, not
   an algorithm. Reversible encodings live on the escape page.
   ============================================================ */
(function () {
  'use strict';

  const $ = Shell.$;
  const escapeHtml = Shell.escapeHtml;
  const enc = new TextEncoder();

  const els = {
    key: $('#h-key'), expect: $('#h-expect'), verdict: $('#h-verdict'),
    format: $('#h-format'), upper: $('#h-upper'), file: $('#h-file')
  };

  /* When a file is loaded we hash its bytes, not the editor text. */
  let fileData = null;      /* { name, size, bytes } */

  const ALGOS = [
    { id: 'md5',     label: 'MD5',     note: 'Broken for security — fine only as a checksum' },
    { id: 'sha1',    label: 'SHA-1',   note: 'Collisions are practical; do not use for signatures' },
    { id: 'sha256',  label: 'SHA-256', note: 'The sensible default' },
    { id: 'sha384',  label: 'SHA-384' },
    { id: 'sha512',  label: 'SHA-512' },
    { id: 'crc32',   label: 'CRC32',   note: 'Error detection only, not a hash' }
  ];
  const SUBTLE = { sha1: 'SHA-1', sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' };

  function digest(algo, bytes) {
    if (algo === 'md5') return Promise.resolve(Hashes.md5(bytes));
    if (algo === 'crc32') return Promise.resolve(Hashes.crc32(bytes));
    return crypto.subtle.digest(SUBTLE[algo], bytes).then((b) => new Uint8Array(b));
  }

  function hmac(algo, keyBytes, bytes) {
    if (!SUBTLE[algo]) return Promise.resolve(null);      /* WebCrypto has no HMAC-MD5 */
    return crypto.subtle
      .importKey('raw', keyBytes, { name: 'HMAC', hash: SUBTLE[algo] }, false, ['sign'])
      .then((k) => crypto.subtle.sign('HMAC', k, bytes))
      .then((b) => new Uint8Array(b));
  }

  const toHex = (bytes) => Array.prototype.map.call(bytes, (b) => (b + 0x100).toString(16).slice(1)).join('');
  function toBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function format(bytes) {
    const out = (els.format && els.format.value === 'base64') ? toBase64(bytes) : toHex(bytes);
    return (els.upper && els.upper.checked) ? out.toUpperCase() : out;
  }

  const fmtSize = (n) => n < 1024 ? n + ' B'
    : n < 1048576 ? (n / 1024).toFixed(1) + ' KB'
    : (n / 1048576).toFixed(2) + ' MB';

  /* ---------- rendering ---------- */
  let token = 0;

  function render(src, preview) {
    const mine = ++token;
    const bytes = fileData ? fileData.bytes : enc.encode(src);
    const keyText = els.key ? els.key.value : '';
    const keyed = !!keyText;

    if (!fileData && !src) {
      preview.innerHTML = '<p class="j-empty">Type text on the left, or drop a file to checksum it.</p>';
      setVerdict('', '');
      return;
    }

    const source = fileData
      ? '<div class="hash-source"><strong>' + escapeHtml(fileData.name) + '</strong> · ' +
        fmtSize(fileData.size) + ' <button class="mini" id="h-clear">Use the text instead</button></div>'
      : '';

    const jobs = ALGOS.map((a) => {
      if (keyed && !SUBTLE[a.id]) return Promise.resolve({ algo: a, skip: 'HMAC needs SHA — not available for ' + a.label });
      const p = keyed ? hmac(a.id, enc.encode(keyText), bytes) : digest(a.id, bytes);
      return p.then((d) => ({ algo: a, value: d ? format(d) : null }))
        .catch((e) => ({ algo: a, skip: e.message }));
    });

    Promise.all(jobs).then((results) => {
      if (mine !== token) return;                    /* a newer keystroke won */
      const expect = (els.expect ? els.expect.value : '').trim().toLowerCase().replace(/\s+/g, '');
      let matched = null;

      let html = source + '<p class="hash-mode">' +
        (keyed ? 'HMAC over ' + (fileData ? 'the file' : 'the text') + ', keyed'
               : (fileData ? 'Checksums of the file' : 'Hashes of the text')) +
        ' · ' + fmtSize(bytes.length) + '</p>';

      results.forEach((r) => {
        if (r.skip) {
          html += '<section class="esc-card"><div class="esc-head"><span class="esc-label">' +
            escapeHtml(r.algo.label) + '</span></div><p class="esc-fail">' + escapeHtml(r.skip) + '</p></section>';
          return;
        }
        const hit = expect && r.value.toLowerCase() === expect;
        if (hit) matched = r.algo.label;
        html += '<section class="esc-card' + (hit ? ' is-match' : '') + '" data-value="' + escapeHtml(r.value) + '">' +
          '<div class="esc-head"><span class="esc-label">' + escapeHtml(r.algo.label) + '</span>' +
          (hit ? '<span class="badge is-ok">matches</span>' : '') +
          '<button class="mini esc-copy" data-tip="Copy this digest" aria-label="Copy this digest">Copy</button></div>' +
          (r.algo.note ? '<p class="esc-note">' + escapeHtml(r.algo.note) + '</p>' : '') +
          '<pre class="esc-out">' + escapeHtml(r.value) + '</pre></section>';
      });

      preview.innerHTML = html;
      if (expect) {
        setVerdict(matched ? 'ok' : 'bad',
          matched ? 'Matches ' + matched : 'No algorithm here produces that digest');
      } else setVerdict('', '');
    });
  }

  function setVerdict(state, text) {
    if (!els.verdict) return;
    els.verdict.textContent = text;
    els.verdict.className = 'v-status' + (state ? ' is-' + state : '');
  }

  /* ---------- go ---------- */
  const api = Shell.create({
    tool: 'hash',
    ext: 'txt',
    mime: 'text/plain',
    blank: '',
    sampleTitle: 'Example text',
    swPath: '../sw.js',
    focusControl: '#h-key',
    commands: {
      clear: (a) => { fileData = null; a.replaceAllText(''); a.el.editor.focus(); }
    },
    onFile: (file, a) => {
      const reader = new FileReader();
      reader.onload = () => {
        fileData = { name: file.name, size: file.size, bytes: new Uint8Array(reader.result) };
        a.replaceAllText('');
        a.render();
        Shell.toast('Hashing ' + file.name);
      };
      reader.onerror = () => Shell.toast('Could not read that file');
      reader.readAsArrayBuffer(file);
    },
    deriveTitle: (content) => fileData ? fileData.name : (content.trim().split('\n')[0].slice(0, 50) || 'Untitled'),
    docSummary: (content) => fileData ? fmtSize(fileData.size) : content.length + ' characters',
    updateStatus: (v) => {
      const n = fileData ? fileData.size : new Blob([v]).size;
      $('#st-size').textContent = fmtSize(n);
      $('#st-mode').textContent = fileData ? 'file' : 'text';
      $('#st-chars').textContent = fileData ? fileData.name : v.length.toLocaleString() + ' characters';
    },
    render: render,
    htmlDocument: (title, body) =>
      '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>' + escapeHtml(title) + '</title>\n' +
      '<style>body{font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:820px;margin:0 auto;padding:48px 24px}' +
      'pre{background:#f4f5f7;border:1px solid #e6e8ec;border-radius:8px;padding:10px 12px;white-space:pre-wrap;word-break:break-all;font-size:12.5px}' +
      '.esc-label{font-weight:650}button{display:none}</style>\n</head>\n<body>\n' + body + '\n</body>\n</html>\n'
  });

  [els.key, els.expect, els.format, els.upper].forEach((n) => {
    if (!n) return;
    n.addEventListener('input', () => api.render());
    n.addEventListener('change', () => api.render());
  });

  api.el.preview.addEventListener('click', async (e) => {
    if (e.target.id === 'h-clear') { fileData = null; api.render(); api.el.editor.focus(); return; }
    const card = e.target.closest('.esc-card');
    if (card && e.target.closest('.esc-copy')) {
      const ok = await Shell.copyText(card.dataset.value);
      Shell.toast(ok ? 'Copied' : 'Copy failed');
    }
  });

  /* typing replaces a loaded file */
  api.el.editor.addEventListener('input', () => {
    if (fileData && api.el.editor.value) { fileData = null; }
  });

  if (els.file) {
    els.file.addEventListener('click', () => $('#file-input').click());
  }
})();
