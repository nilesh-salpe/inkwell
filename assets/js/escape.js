/* ============================================================
   String escaping and unescaping.
   Encode mode shows every representation of the input at once;
   decode mode tries every decoder and reports which ones apply.
   ============================================================ */
(function () {
  'use strict';

  const $ = Shell.$;
  const escapeHtml = Shell.escapeHtml;
  let mode = 'encode';

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  /* ---------- encoders ---------- */
  const HTML_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function toBase64(s) {
    const bytes = enc.encode(s);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  const ENCODERS = [
    { id: 'json', label: 'JSON string', note: 'Ready to paste between quotes in JSON or JavaScript',
      run: (s) => JSON.stringify(s) },
    { id: 'html', label: 'HTML entities', note: 'Safe to place in markup as text',
      run: (s) => s.replace(/[&<>"']/g, (c) => HTML_MAP[c]) },
    { id: 'url', label: 'URL component', note: 'encodeURIComponent — for a query value or path segment',
      run: (s) => encodeURIComponent(s) },
    { id: 'urlfull', label: 'Full URL', note: 'encodeURI — keeps :/?#[]@ intact',
      run: (s) => encodeURI(s) },
    { id: 'base64', label: 'Base64', note: 'UTF-8 bytes, standard alphabet',
      run: (s) => toBase64(s) },
    { id: 'base64url', label: 'Base64url', note: 'URL-safe alphabet, padding stripped',
      run: (s) => toBase64(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') },
    { id: 'hex', label: 'Hex', note: 'UTF-8 bytes as hexadecimal',
      run: (s) => Array.prototype.map.call(enc.encode(s), (b) => (b + 0x100).toString(16).slice(1)).join('') },
    { id: 'unicode', label: 'Unicode escapes', note: 'Non-ASCII and control characters as \\uXXXX',
      run: (s) => s.replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) },
    { id: 'backslash', label: 'Backslash / C style', note: 'For string literals in most languages',
      run: (s) => s.replace(/[\\"']/g, (c) => '\\' + c)
        .replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, (c) => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')) },
    { id: 'regex', label: 'Regex literal', note: 'Metacharacters escaped so the text matches itself',
      run: (s) => s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&') },
    { id: 'sql', label: 'SQL string', note: "Single quotes doubled, wrapped and ready for a query",
      run: (s) => "'" + s.replace(/'/g, "''") + "'" }
  ];

  /* ---------- decoders ---------- */

  /* Any run of letters is valid base64, and any even run of a-f digits is valid
     hex — so "just plain words" decodes to bytes very happily. Require the
     result to look like text before believing it. */
  function plausible(text) {
    if (!text) return false;
    if (text.indexOf('\uFFFD') > -1) return false;      /* invalid UTF-8 */
    let control = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c < 32 && c !== 9 && c !== 10 && c !== 13) control++;
      if (c === 0) return false;
    }
    return control / text.length < 0.1;
  }

  function fromBase64(s) {
    const clean = s.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
    if (!clean || !/^[A-Za-z0-9+/]+=*$/.test(clean)) throw new Error('not base64');
    let padded = clean;
    while (padded.length % 4) padded += '=';
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const text = dec.decode(bytes);
    if (!plausible(text)) throw new Error('decodes to binary, not text');
    return text;
  }

  const DECODERS = [
    { id: 'json', label: 'JSON string', run: (s) => {
      const t = s.trim();
      if (t[0] === '"' && t[t.length - 1] === '"') {
        const v = JSON.parse(t);
        if (typeof v !== 'string') throw new Error('not a string');
        return v;
      }
      return JSON.parse('"' + t.replace(/"/g, '\\"') + '"');
    } },
    { id: 'html', label: 'HTML entities', run: (s) => {
      if (s.indexOf('&') === -1) throw new Error('no entities');
      /* parsed as inert markup — nothing is executed or fetched */
      const doc = new DOMParser().parseFromString('<!doctype html><body>' + s, 'text/html');
      return doc.body.textContent;
    } },
    { id: 'url', label: 'URL decoded', run: (s) => {
      if (s.indexOf('%') === -1 && s.indexOf('+') === -1) throw new Error('nothing encoded');
      return decodeURIComponent(s.replace(/\+/g, ' '));
    } },
    { id: 'base64', label: 'Base64 / Base64url', run: (s) => fromBase64(s) },
    { id: 'hex', label: 'Hex', run: (s) => {
      const clean = s.trim().replace(/^0x/i, '').replace(/[\s:-]/g, '');
      if (!/^[0-9a-f]+$/i.test(clean) || clean.length % 2) throw new Error('not hex');
      const bytes = new Uint8Array(clean.length / 2);
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
      const text = dec.decode(bytes);
      if (!plausible(text)) throw new Error('decodes to binary, not text');
      return text;
    } },
    { id: 'unicode', label: 'Unicode escapes', run: (s) => {
      if (s.indexOf('\\u') === -1) throw new Error('no escapes');
      return s.replace(/\\u\{([0-9a-f]+)\}/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/\\u([0-9a-f]{4})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
    } },
    { id: 'backslash', label: 'Backslash / C style', run: (s) => {
      if (s.indexOf('\\') === -1) throw new Error('no escapes');
      return s.replace(/\\x([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
        .replace(/\\0/g, '\0').replace(/\\(['"\\])/g, '$1');
    } }
  ];

  /* ---------- rendering ---------- */
  function card(label, note, value, ok) {
    const body = ok
      ? '<pre class="esc-out">' + escapeHtml(value) + '</pre>'
      : '<p class="esc-fail">' + escapeHtml(note) + '</p>';
    return '<section class="esc-card" data-value="' + escapeHtml(ok ? value : '') + '">' +
      '<div class="esc-head"><span class="esc-label">' + escapeHtml(label) + '</span>' +
      (ok ? '<button class="mini esc-copy">Copy</button><button class="mini esc-use">Use</button>' : '') +
      '</div>' +
      (ok && note ? '<p class="esc-note">' + escapeHtml(note) + '</p>' : '') +
      body + '</section>';
  }

  function render(src, preview) {
    if (!src) {
      preview.innerHTML = '<p class="j-empty">Type or paste text on the left.</p>';
      return;
    }
    let html = '';
    if (mode === 'encode') {
      ENCODERS.forEach((e) => {
        let out;
        try { out = e.run(src); } catch (err) { html += card(e.label, err.message, '', false); return; }
        html += card(e.label, e.note, out, true);
      });
    } else {
      let any = 0;
      DECODERS.forEach((d) => {
        let out;
        try { out = d.run(src); } catch (err) { html += card(d.label, 'Does not apply', '', false); return; }
        if (out === src) { html += card(d.label, 'No change', '', false); return; }
        any++;
        html += card(d.label, '', out, true);
      });
      if (!any) html = '<p class="j-empty">Nothing here looks encoded. Switch to Encode to escape it instead.</p>' + html;
    }
    preview.innerHTML = html;
  }

  /* ---------- go ---------- */
  const api = Shell.create({
    tool: 'escape',
    ext: 'txt',
    mime: 'text/plain',
    blank: '',
    sampleTitle: 'Example text',
    swPath: '../sw.js',
    commands: {
      clear: (a) => { a.replaceAllText(''); a.el.editor.focus(); },
      swap: () => setMode(mode === 'encode' ? 'decode' : 'encode')
    },
    shortcuts: {},
    deriveTitle: (content) => content.trim().split('\n')[0].slice(0, 50) || 'Untitled',
    docSummary: (content) => content.length + (content.length === 1 ? ' character' : ' characters'),
    updateStatus: (v) => {
      $('#st-chars').textContent = v.length.toLocaleString() + (v.length === 1 ? ' character' : ' characters');
      $('#st-size').textContent = new Blob([v]).size + ' B';
      $('#st-lines').textContent = v.split('\n').length.toLocaleString() + ' lines';
    },
    render: render,
    htmlDocument: (title, body) =>
      '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>' + escapeHtml(title) + '</title>\n' +
      '<style>body{font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:820px;margin:0 auto;padding:48px 24px}' +
      'pre{background:#f4f5f7;border:1px solid #e6e8ec;border-radius:8px;padding:10px 12px;white-space:pre-wrap;word-break:break-all;font-size:12.5px}' +
      '.esc-label{font-weight:650}button{display:none}</style>\n</head>\n<body>\n' + body + '\n</body>\n</html>\n'
  });

  function setMode(next) {
    mode = next;
    Shell.$$('.esc-mode').forEach((b) => b.classList.toggle('is-active', b.dataset.mode === mode));
    api.render();
  }
  Shell.$$('.esc-mode').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  api.el.preview.addEventListener('click', async (e) => {
    const card = e.target.closest('.esc-card');
    if (!card) return;
    const value = card.dataset.value;
    if (e.target.closest('.esc-copy')) {
      const ok = await Shell.copyText(value);
      Shell.toast(ok ? 'Copied' : 'Copy failed');
    } else if (e.target.closest('.esc-use')) {
      api.replaceAllText(value);
      Shell.toast('Replaced the input — undo with Ctrl+Z');
    }
  });

  setMode('encode');
})();
