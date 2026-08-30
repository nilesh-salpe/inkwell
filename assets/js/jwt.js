/* ============================================================
   JWT tool — decode a token, read its claims, check whether it
   is still valid and verify the signature.

   Tokens are credentials, so this page opts out of persistence:
   nothing typed here is written to disk.
   ============================================================ */
(function () {
  'use strict';

  const $ = Shell.$;
  const escapeHtml = Shell.escapeHtml;

  const vInput = $('#v-secret');
  const vStatus = $('#v-status');
  let lastToken = null;

  /* ---------- base64url ---------- */
  function b64urlToBytes(str) {
    let b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const b64urlToText = (str) => new TextDecoder().decode(b64urlToBytes(str));

  /* ---------- decoding ---------- */
  function decode(src) {
    const token = src.trim().replace(/\s+/g, '');
    if (!token) return { empty: true };

    const parts = token.split('.');
    if (parts.length !== 3) {
      return { error: {
        message: 'A JWT has three dot-separated parts (header.payload.signature); this has ' + parts.length + '.',
        line: null
      } };
    }

    const out = { token: token, parts: parts };
    for (const which of ['header', 'payload']) {
      const raw = which === 'header' ? parts[0] : parts[1];
      let text;
      try { text = b64urlToText(raw); }
      catch (e) {
        return { error: { message: 'The ' + which + ' is not valid base64url.' } };
      }
      try { out[which] = JSON.parse(text); }
      catch (e) {
        return { error: { message: 'The ' + which + ' is not valid JSON once decoded: ' + e.message } };
      }
    }
    return out;
  }

  /* ---------- time helpers ---------- */
  const TIME_CLAIMS = { exp: 'Expires', iat: 'Issued at', nbf: 'Not valid before', auth_time: 'Authenticated at' };

  function fromNow(seconds) {
    const diff = seconds * 1000 - Date.now();
    const abs = Math.abs(diff);
    const unit = abs < 60000 ? [1000, 'second']
      : abs < 3600000 ? [60000, 'minute']
      : abs < 86400000 ? [3600000, 'hour']
      : abs < 2592000000 ? [86400000, 'day']
      : abs < 31536000000 ? [2592000000, 'month']
      : [31536000000, 'year'];
    const n = Math.round(abs / unit[0]);
    const label = n + ' ' + unit[1] + (n === 1 ? '' : 's');
    return diff >= 0 ? 'in ' + label : label + ' ago';
  }

  const asDate = (seconds) => {
    const d = new Date(seconds * 1000);
    return isNaN(d.getTime()) ? String(seconds) : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  };

  /* Overall validity from the time-based claims. */
  function validity(payload) {
    if (!payload || typeof payload !== 'object') return { state: 'unknown', label: 'No claims' };
    const now = Date.now() / 1000;
    if (typeof payload.exp === 'number' && now > payload.exp) {
      return { state: 'bad', label: 'Expired', detail: 'Expired ' + fromNow(payload.exp) };
    }
    if (typeof payload.nbf === 'number' && now < payload.nbf) {
      return { state: 'warn', label: 'Not yet valid', detail: 'Becomes valid ' + fromNow(payload.nbf) };
    }
    if (typeof payload.exp === 'number') {
      return { state: 'ok', label: 'Not expired', detail: 'Expires ' + fromNow(payload.exp) };
    }
    return { state: 'warn', label: 'No expiry', detail: 'This token has no exp claim — it never expires on its own' };
  }

  /* ---------- rendering ---------- */
  function claimsTable(payload) {
    const rows = [];
    Object.keys(TIME_CLAIMS).forEach((k) => {
      if (typeof payload[k] !== 'number') return;
      rows.push('<tr><td><code>' + k + '</code></td><td>' + escapeHtml(TIME_CLAIMS[k]) + '</td>' +
        '<td>' + escapeHtml(asDate(payload[k])) + ' <span class="jwt-rel">(' + escapeHtml(fromNow(payload[k])) + ')</span></td></tr>');
    });
    const named = { iss: 'Issuer', sub: 'Subject', aud: 'Audience', jti: 'Token ID' };
    Object.keys(named).forEach((k) => {
      if (payload[k] == null) return;
      const v = Array.isArray(payload[k]) ? payload[k].join(', ') : String(payload[k]);
      rows.push('<tr><td><code>' + k + '</code></td><td>' + named[k] + '</td><td>' + escapeHtml(v) + '</td></tr>');
    });
    if (!rows.length) return '';
    return '<table class="jwt-claims"><tbody>' + rows.join('') + '</tbody></table>';
  }

  function render(src, preview) {
    const r = decode(src);
    lastToken = null;

    if (r.empty) {
      preview.innerHTML = '<p class="j-empty">Paste a JSON Web Token on the left.</p>';
      setStatusBar(null);
      return;
    }
    if (r.error) {
      preview.innerHTML = DataTools.errorCard('Not a valid JWT', r.error);
      setStatusBar(null);
      return;
    }

    lastToken = r;
    const alg = r.header && r.header.alg;
    const v = validity(r.payload);

    let html = '';

    if (alg === 'none') {
      html += '<div class="jwt-warn"><strong>alg: none</strong> — this token is unsigned, so anyone can alter its ' +
        'claims. Never accept it as proof of anything.</div>';
    }

    html += '<section class="jwt-block">' +
      '<h3>Header' + (alg ? '<span class="jwt-alg">' + escapeHtml(String(alg)) + '</span>' : '') + '</h3>' +
      DataTools.renderValue(r.header) + '</section>';

    html += '<section class="jwt-block">' +
      '<h3>Payload<span class="badge is-' + (v.state === 'ok' ? 'ok' : v.state === 'bad' ? 'bad' : 'warn') + '">' +
      escapeHtml(v.label) + '</span></h3>' +
      (v.detail ? '<p class="jwt-detail">' + escapeHtml(v.detail) + '</p>' : '') +
      claimsTable(r.payload || {}) +
      DataTools.renderValue(r.payload) + '</section>';

    html += '<section class="jwt-block"><h3>Signature</h3>' +
      '<pre class="jwt-sig">' + escapeHtml(r.parts[2] || '(empty)') + '</pre>' +
      '<p class="jwt-detail" id="verify-hint">Paste the secret or public key above to check it.</p>' +
      '</section>';

    preview.innerHTML = html;
    setStatusBar(r);
    if (vInput && vInput.value.trim()) verify();
  }

  function setStatusBar(r) {
    const badge = $('#st-valid');
    const alg = r && r.header && r.header.alg;
    $('#st-alg').textContent = alg ? String(alg) : '—';
    if (!r) {
      badge.textContent = 'No token'; badge.className = 'badge';
      $('#st-shape').textContent = '—';
      return;
    }
    const v = validity(r.payload);
    badge.textContent = v.label;
    badge.className = 'badge is-' + (v.state === 'ok' ? 'ok' : v.state === 'bad' ? 'bad' : 'warn');
    const claims = r.payload && typeof r.payload === 'object' ? Object.keys(r.payload).length : 0;
    $('#st-shape').textContent = claims + (claims === 1 ? ' claim' : ' claims');
  }

  /* ---------- signature verification ---------- */
  const HASH = { '256': 'SHA-256', '384': 'SHA-384', '512': 'SHA-512' };

  function pemToBytes(pem) {
    const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    return b64urlToBytes(body.replace(/\+/g, '-').replace(/\//g, '_'));
  }

  async function importKey(alg, secret) {
    const bits = alg.slice(2);
    const hash = HASH[bits];
    if (!hash) throw new Error('Unsupported algorithm ' + alg);
    const family = alg.slice(0, 2);

    if (family === 'HS') {
      return {
        key: await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash }, false, ['verify']),
        params: { name: 'HMAC' }
      };
    }
    if (!/-----BEGIN/.test(secret)) throw new Error(alg + ' needs a PEM public key (-----BEGIN PUBLIC KEY-----)');
    const der = pemToBytes(secret);
    if (family === 'RS') {
      return {
        key: await crypto.subtle.importKey('spki', der, { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['verify']),
        params: { name: 'RSASSA-PKCS1-v1_5' }
      };
    }
    if (family === 'PS') {
      return {
        key: await crypto.subtle.importKey('spki', der, { name: 'RSA-PSS', hash }, false, ['verify']),
        params: { name: 'RSA-PSS', saltLength: parseInt(bits, 10) / 8 }
      };
    }
    if (family === 'ES') {
      const curve = bits === '256' ? 'P-256' : bits === '384' ? 'P-384' : 'P-521';
      return {
        key: await crypto.subtle.importKey('spki', der, { name: 'ECDSA', namedCurve: curve }, false, ['verify']),
        params: { name: 'ECDSA', hash }
      };
    }
    throw new Error('Unsupported algorithm ' + alg);
  }

  async function verify() {
    if (!vStatus) return;
    const secret = vInput.value;
    if (!lastToken) { setVerify('', ''); return; }
    if (!secret.trim()) { setVerify('', ''); return; }

    const alg = lastToken.header && lastToken.header.alg;
    if (!alg || alg === 'none') { setVerify('bad', 'Nothing to verify'); return; }
    if (!window.crypto || !crypto.subtle) { setVerify('warn', 'Verification unavailable here'); return; }

    try {
      const { key, params } = await importKey(String(alg), secret);
      const data = new TextEncoder().encode(lastToken.parts[0] + '.' + lastToken.parts[1]);
      const sig = b64urlToBytes(lastToken.parts[2]);
      const ok = await crypto.subtle.verify(params, key, sig, data);
      setVerify(ok ? 'ok' : 'bad', ok ? 'Signature valid' : 'Signature does NOT match');
    } catch (e) {
      setVerify('warn', e.message.slice(0, 70));
    }
  }

  function setVerify(state, text) {
    vStatus.textContent = text;
    vStatus.className = 'v-status' + (state ? ' is-' + state : '');
    const hint = $('#verify-hint');
    if (hint && text) hint.textContent = text;
  }

  /* ---------- commands ---------- */
  const commands = {
    copyPayload: () => copyPart('payload'),
    copyHeader: () => copyPart('header'),
    clear: (a) => { a.replaceAllText(''); a.el.editor.focus(); },
    expandAll: () => Shell.$$('#preview details').forEach((d) => { d.open = true; }),
    collapseAll: () => Shell.$$('#preview details').forEach((d, i) => { d.open = i === 0; })
  };

  async function copyPart(which) {
    if (!lastToken) return Shell.toast('Paste a token first');
    const ok = await Shell.copyText(JSON.stringify(lastToken[which], null, 2));
    Shell.toast(ok ? 'Copied the ' + which : 'Copy failed');
  }

  /* ---------- go ---------- */
  const api = Shell.create({
    tool: 'jwt',
    ext: 'txt',
    mime: 'text/plain',
    blank: '',
    sampleTitle: 'Example token',
    swPath: '../sw.js',
    persist: false,                 /* never write a credential to disk */
    commands: commands,
    shortcuts: { d: () => commands.copyPayload() },
    deriveTitle: (content) => {
      const r = decode(content);
      if (r.empty || r.error) return 'Untitled';
      const p = r.payload || {};
      return String(p.sub || p.name || p.iss || 'Token').slice(0, 60);
    },
    docSummary: (content) => {
      const r = decode(content);
      if (r.empty) return 'empty';
      if (r.error) return 'not a JWT';
      return validity(r.payload).label.toLowerCase();
    },
    updateStatus: (v) => {
      $('#st-size').textContent = new Blob([v]).size + ' B';
    },
    render: render,
    htmlDocument: (title, body) =>
      '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>' + escapeHtml(title) + '</title>\n' +
      '<style>body{font:14px/1.7 ui-monospace,Menlo,Consolas,monospace;max-width:900px;margin:0 auto;padding:48px 24px}' +
      '.j-row{padding-left:18px;border-left:1px solid #e6e8ec}.j-key{color:#6b3fa0}.j-str{color:#0a7d4f}' +
      '.j-num{color:#0550ae}.j-bool{color:#b7791f}.j-null{color:#8b94a3}.j-punc{color:#8b94a3}' +
      'table{border-collapse:collapse;margin:12px 0}td{border:1px solid #ddd;padding:5px 10px}' +
      '.jwt-sig{word-break:break-all;white-space:pre-wrap;background:#f4f5f7;padding:10px;border-radius:8px}</style>\n' +
      '</head>\n<body>\n' + body + '\n</body>\n</html>\n'
  });

  if (vInput) {
    let t = null;
    vInput.addEventListener('input', () => { clearTimeout(t); t = setTimeout(verify, 200); });
  }

  const btnCopyPayload = $('#btn-copy-payload');
  if (btnCopyPayload) btnCopyPayload.addEventListener('click', () => commands.copyPayload());

  /* claim keys copy their path, same as the JSON tool */
  api.el.preview.addEventListener('click', async (e) => {
    const key = e.target.closest('.j-key[data-path]');
    if (!key) return;
    const ok = await Shell.copyText(key.dataset.path);
    Shell.toast(ok ? 'Copied ' + key.dataset.path : 'Copy failed');
  });
})();
