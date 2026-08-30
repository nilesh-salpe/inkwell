/* ============================================================
   ID generator and inspector.

   UUIDs are 128 bits by specification (RFC 9562), so their
   length is not configurable — only their version is. Formats
   where length *is* a real choice (NanoID, random tokens) are
   grouped separately.
   ============================================================ */
(function () {
  'use strict';

  const $ = Shell.$;
  const escapeHtml = Shell.escapeHtml;

  const els = {
    type: $('#g-type'), count: $('#g-count'), len: $('#g-len'),
    lenWrap: $('#g-len-wrap'), nameWrap: $('#g-name-wrap'),
    ns: $('#g-ns'), name: $('#g-name'), upper: $('#g-upper'), hyphens: $('#g-hyphens')
  };

  /* ---------- bytes ---------- */
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
  const HEX = [];
  for (let i = 0; i < 256; i++) HEX.push((i + 0x100).toString(16).slice(1));

  function toUuid(b) {
    return HEX[b[0]] + HEX[b[1]] + HEX[b[2]] + HEX[b[3]] + '-' +
      HEX[b[4]] + HEX[b[5]] + '-' + HEX[b[6]] + HEX[b[7]] + '-' +
      HEX[b[8]] + HEX[b[9]] + '-' +
      HEX[b[10]] + HEX[b[11]] + HEX[b[12]] + HEX[b[13]] + HEX[b[14]] + HEX[b[15]];
  }
  function stamp(b, version) {                    /* set version + RFC 9562 variant */
    b[6] = (b[6] & 0x0f) | (version << 4);
    b[8] = (b[8] & 0x3f) | 0x80;
    return b;
  }
  const hexToBytes = (hex) => {
    const clean = hex.replace(/[^0-9a-f]/gi, '');
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
    return out;
  };

  /* ---------- MD5, for v3 (WebCrypto deliberately has no MD5) ---------- */
  function md5(bytes) {
    const S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22, 5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
               4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23, 6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
    const K = new Uint32Array(64);
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);

    const len = bytes.length;
    const withPad = new Uint8Array(((len + 8) >> 6 << 6) + 64);
    withPad.set(bytes);
    withPad[len] = 0x80;
    const bitLen = len * 8;
    const dv = new DataView(withPad.buffer);
    dv.setUint32(withPad.length - 8, bitLen >>> 0, true);
    dv.setUint32(withPad.length - 4, Math.floor(bitLen / 4294967296), true);

    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    const rotl = (x, c) => (x << c) | (x >>> (32 - c));

    for (let chunk = 0; chunk < withPad.length; chunk += 64) {
      const M = new Uint32Array(16);
      for (let i = 0; i < 16; i++) M[i] = dv.getUint32(chunk + i * 4, true);
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        F = (F + A + K[i] + M[g]) >>> 0;
        A = D; D = C; C = B;
        B = (B + rotl(F, S[i])) >>> 0;
      }
      a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
    }
    const out = new Uint8Array(16);
    const odv = new DataView(out.buffer);
    odv.setUint32(0, a0, true); odv.setUint32(4, b0, true);
    odv.setUint32(8, c0, true); odv.setUint32(12, d0, true);
    return out;
  }


  /* SHA-1 for v5. Kept synchronous — crypto.subtle is async and needs a
     secure context, and neither is worth it for 20 bytes of digest. */
  function sha1(bytes) {
    const len = bytes.length;
    const total = ((len + 8) >> 6 << 6) + 64;
    const buf = new Uint8Array(total);
    buf.set(bytes);
    buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    const bitLen = len * 8;
    dv.setUint32(total - 8, Math.floor(bitLen / 4294967296));
    dv.setUint32(total - 4, bitLen >>> 0);

    let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    const rotl = (x, c) => (x << c) | (x >>> (32 - c));
    const w = new Int32Array(80);

    for (let chunk = 0; chunk < total; chunk += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getInt32(chunk + i * 4);
      for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let i = 0; i < 80; i++) {
        let f, k;
        if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
        else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
        else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
        else { f = b ^ c ^ d; k = 0xca62c1d6; }
        const t = (rotl(a, 5) + f + e + k + w[i]) | 0;
        e = d; d = c; c = rotl(b, 30); b = a; a = t;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
    }
    const out = new Uint8Array(20);
    const odv = new DataView(out.buffer);
    [h0, h1, h2, h3, h4].forEach((h, i) => odv.setInt32(i * 4, h));
    return out;
  }

  /* ---------- UUID versions ---------- */
  const NAMESPACES = {
    DNS:  '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    URL:  '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
    OID:  '6ba7b812-9dad-11d1-80b4-00c04fd430c8',
    X500: '6ba7b814-9dad-11d1-80b4-00c04fd430c8'
  };

  const GREGORIAN_OFFSET = 12219292800000;    /* ms between 1582-10-15 and the epoch */
  let clockSeq = null, nodeId = null;

  function v1Fields() {
    if (!nodeId) {
      nodeId = rand(6);
      nodeId[0] |= 0x01;                        /* multicast bit: not a real MAC */
    }
    if (clockSeq === null) clockSeq = rand(2)[0] << 8 | rand(1)[0];
    const ts = (BigInt(Date.now() + GREGORIAN_OFFSET) * 10000n) + BigInt(Math.floor(Math.random() * 10000));
    return { ts, node: nodeId, seq: clockSeq & 0x3fff };
  }

  function v1() {
    const f = v1Fields();
    const b = new Uint8Array(16);
    const lo = Number(f.ts & 0xffffffffn);
    const mid = Number((f.ts >> 32n) & 0xffffn);
    const hi = Number((f.ts >> 48n) & 0x0fffn);
    b[0] = lo >>> 24; b[1] = lo >>> 16 & 255; b[2] = lo >>> 8 & 255; b[3] = lo & 255;
    b[4] = mid >>> 8; b[5] = mid & 255;
    b[6] = hi >>> 8; b[7] = hi & 255;
    b[8] = f.seq >>> 8; b[9] = f.seq & 255;
    b.set(f.node, 10);
    return toUuid(stamp(b, 1));
  }

  function v6() {                                /* v1 with the time fields reordered so it sorts */
    const f = v1Fields();
    const b = new Uint8Array(16);
    const hi32 = Number((f.ts >> 28n) & 0xffffffffn);
    const mid16 = Number((f.ts >> 12n) & 0xffffn);
    const lo12 = Number(f.ts & 0x0fffn);
    b[0] = hi32 >>> 24; b[1] = hi32 >>> 16 & 255; b[2] = hi32 >>> 8 & 255; b[3] = hi32 & 255;
    b[4] = mid16 >>> 8; b[5] = mid16 & 255;
    b[6] = lo12 >>> 8; b[7] = lo12 & 255;
    b[8] = f.seq >>> 8; b[9] = f.seq & 255;
    b.set(f.node, 10);
    return toUuid(stamp(b, 6));
  }

  function v4() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return toUuid(stamp(rand(16), 4));
  }

  /* Within one millisecond a plain v7 is only as ordered as its random tail,
     which breaks sorting when you generate a batch. RFC 9562's monotonic
     method: keep a counter in rand_a and bump it while the clock stands still. */
  let lastMs7 = 0, seq7 = 0;

  function v7() {                                /* 48-bit Unix ms, then randomness */
    const b = rand(16);
    const ms = Date.now();
    if (ms === lastMs7) seq7 = (seq7 + 1) & 0x0fff;
    else { lastMs7 = ms; seq7 = rand(2)[0] & 0x0f; }
    b[0] = Math.floor(ms / 2 ** 40) & 255;
    b[1] = Math.floor(ms / 2 ** 32) & 255;
    b[2] = Math.floor(ms / 2 ** 24) & 255;
    b[3] = Math.floor(ms / 2 ** 16) & 255;
    b[4] = Math.floor(ms / 2 ** 8) & 255;
    b[5] = ms & 255;
    b[6] = seq7 >> 8;                            /* rand_a: the monotonic counter */
    b[7] = seq7 & 255;
    return toUuid(stamp(b, 7));
  }

  function nameBased(version, nsUuid, name) {
    const ns = hexToBytes(nsUuid);
    if (ns.length !== 16) throw new Error('The namespace must be a UUID');
    const nameBytes = new TextEncoder().encode(name);
    const input = new Uint8Array(16 + nameBytes.length);
    input.set(ns); input.set(nameBytes, 16);
    const digest = version === 3 ? md5(input) : sha1(input);
    return toUuid(stamp(digest.slice(0, 16), version));
  }

  /* ---------- other formats ---------- */
  const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let lastMsU = 0, lastBody = null;

  /* The ULID spec defines the same monotonic rule: inside one millisecond,
     increment the random component instead of drawing a fresh one. */
  function ulid() {
    const now = Date.now();
    let ms = now, time = '';
    for (let i = 0; i < 10; i++) { time = CROCKFORD[ms % 32] + time; ms = Math.floor(ms / 32); }

    if (now === lastMsU && lastBody) {
      const chars = lastBody.split('');
      let i = chars.length - 1;
      while (i >= 0) {
        const next = CROCKFORD.indexOf(chars[i]) + 1;
        if (next < 32) { chars[i] = CROCKFORD[next]; break; }
        chars[i] = CROCKFORD[0]; i--;
      }
      lastBody = chars.join('');
    } else {
      const r = rand(16);
      let body = '';
      for (let i = 0; i < 16; i++) body += CROCKFORD[r[i] % 32];
      lastMsU = now; lastBody = body;
    }
    return time + lastBody;
  }

  const NANO_ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
  function nanoid(size) {
    const bytes = rand(size);
    let out = '';
    for (let i = 0; i < size; i++) out += NANO_ALPHABET[bytes[i] & 63];
    return out;
  }

  const hexToken = (n) => Array.prototype.map.call(rand(n), (b) => HEX[b]).join('');
  function b64Token(n) {
    const bytes = rand(n);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function objectId() {
    const ts = Math.floor(Date.now() / 1000);
    return HEX[ts >>> 24 & 255] + HEX[ts >>> 16 & 255] + HEX[ts >>> 8 & 255] + HEX[ts & 255] +
      Array.prototype.map.call(rand(8), (b) => HEX[b]).join('');
  }

  /* ---------- generation ---------- */
  const VARIABLE = { nanoid: true, hex: true, base64: true };
  const NAMED = { v3: true, v5: true };

  function generateOne(type, len) {
    switch (type) {
      case 'v1': return v1();
      case 'v4': return v4();
      case 'v6': return v6();
      case 'v7': return v7();
      case 'v3': return nameBased(3, els.ns.value.trim(), els.name.value);
      case 'v5': return nameBased(5, els.ns.value.trim(), els.name.value);
      case 'ulid': return ulid();
      case 'nanoid': return nanoid(len);
      case 'hex': return hexToken(Math.max(1, Math.round(len / 2)));
      case 'base64': return b64Token(Math.max(1, Math.round(len * 3 / 4)));
      case 'objectid': return objectId();
      default: return v4();
    }
  }

  function generate(api) {
    const type = els.type.value;
    const n = Math.max(1, Math.min(10000, parseInt(els.count.value, 10) || 1));
    const len = Math.max(1, Math.min(256, parseInt(els.len.value, 10) || 21));
    const out = [];
    try {
      for (let i = 0; i < n; i++) out.push(generateOne(type, len));
    } catch (e) {
      Shell.toast(e.message);
      return;
    }
    let text = out.join('\n');
    if (els.hyphens && !els.hyphens.checked) text = text.replace(/-/g, '');
    if (els.upper && els.upper.checked) text = text.toUpperCase();
    api.replaceAllText(text + '\n');
    Shell.toast('Generated ' + n + ' ' + (n === 1 ? 'value' : 'values'));
  }

  /* ---------- inspection ---------- */
  const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

  function variantOf(b) {
    const n = b[8];
    if ((n & 0x80) === 0) return 'NCS (legacy)';
    if ((n & 0xc0) === 0x80) return 'RFC 4122 / 9562';
    if ((n & 0xe0) === 0xc0) return 'Microsoft';
    return 'reserved';
  }

  function inspect(value) {
    const v = value.trim();
    if (!v) return null;

    if (UUID_RE.test(v)) {
      const b = hexToBytes(v);
      const version = b[6] >> 4;
      const info = { kind: 'UUID', version: 'v' + version, variant: variantOf(b), bits: 128 };
      if (version === 1 || version === 6) {
        let ts;
        if (version === 1) {
          ts = (BigInt(b[6] & 0x0f) << 56n) | (BigInt(b[7]) << 48n) |
               (BigInt(b[4]) << 40n) | (BigInt(b[5]) << 32n) |
               (BigInt(b[0]) << 24n) | (BigInt(b[1]) << 16n) | (BigInt(b[2]) << 8n) | BigInt(b[3]);
        } else {
          ts = (BigInt(b[0]) << 52n) | (BigInt(b[1]) << 44n) | (BigInt(b[2]) << 36n) | (BigInt(b[3]) << 28n) |
               (BigInt(b[4]) << 20n) | (BigInt(b[5]) << 12n) |
               (BigInt(b[6] & 0x0f) << 8n) | BigInt(b[7]);
        }
        const ms = Number(ts / 10000n) - GREGORIAN_OFFSET;
        info.created = new Date(ms);
        info.node = Array.prototype.slice.call(b, 10).map((x) => HEX[x]).join(':');
        info.random = false;
      } else if (version === 7) {
        const ms = b[0] * 2 ** 40 + b[1] * 2 ** 32 + b[2] * 2 ** 24 + b[3] * 2 ** 16 + b[4] * 2 ** 8 + b[5];
        info.created = new Date(ms);
        info.sortable = true;
      } else if (version === 4) {
        info.entropy = '122 random bits';
      } else if (version === 3 || version === 5) {
        info.derived = version === 3 ? 'MD5 of a namespace and name' : 'SHA-1 of a namespace and name';
      }
      return info;
    }

    if (/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(v)) {
      let ms = 0;
      for (let i = 0; i < 10; i++) ms = ms * 32 + CROCKFORD.indexOf(v[i].toUpperCase());
      return { kind: 'ULID', bits: 128, created: new Date(ms), sortable: true };
    }
    if (/^[0-9a-f]{24}$/i.test(v)) {
      return { kind: 'ObjectId', bits: 96, created: new Date(parseInt(v.slice(0, 8), 16) * 1000) };
    }
    return { kind: 'Opaque string', length: v.length, bits: null };
  }

  function card(value, info) {
    if (!info) return '';
    const rows = [];
    const add = (k, v) => rows.push('<tr><td>' + escapeHtml(k) + '</td><td>' + v + '</td></tr>');
    add('Format', '<strong>' + escapeHtml(info.kind) + (info.version ? ' ' + info.version : '') + '</strong>');
    if (info.variant) add('Variant', escapeHtml(info.variant));
    if (info.bits) add('Size', info.bits + ' bits');
    if (info.length) add('Length', info.length + ' characters');
    if (info.created && !isNaN(info.created.getTime())) {
      add('Created', escapeHtml(info.created.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })));
    }
    if (info.node) add('Node', '<code>' + escapeHtml(info.node) + '</code> <span class="id-hint">(random, not a MAC address, if we made it)</span>');
    if (info.entropy) add('Entropy', escapeHtml(info.entropy));
    if (info.derived) add('Derived from', escapeHtml(info.derived));
    if (info.sortable) add('Sortable', 'Yes — lexicographic order matches creation order');
    return '<section class="id-card"><div class="id-value">' + escapeHtml(value) + '</div>' +
      '<table class="jwt-claims"><tbody>' + rows.join('') + '</tbody></table></section>';
  }

  /* ---------- go ---------- */
  const api = Shell.create({
    tool: 'ids',
    ext: 'txt',
    mime: 'text/plain',
    blank: '',
    sampleTitle: 'Generated identifiers',
    swPath: '../sw.js',
    persist: false,             /* generated secrets should not linger on disk */
    commands: {
      generate: (a) => generate(a),
      clear: (a) => { a.replaceAllText(''); a.el.editor.focus(); },
      sort: (a) => {
        const lines = a.source.split('\n').filter((l) => l.trim());
        a.replaceAllText(lines.sort().join('\n') + '\n');
        Shell.toast('Sorted');
      },
      dedupe: (a) => {
        const lines = a.source.split('\n').filter((l) => l.trim());
        const seen = {}, out = [];
        lines.forEach((l) => { if (!seen[l]) { seen[l] = 1; out.push(l); } });
        a.replaceAllText(out.join('\n') + '\n');
        Shell.toast(lines.length - out.length ? 'Removed ' + (lines.length - out.length) + ' duplicates' : 'No duplicates');
      }
    },
    shortcuts: { g: (a) => generate(a) },
    deriveTitle: () => 'Generated identifiers',
    docSummary: (content) => {
      const n = content.split('\n').filter((l) => l.trim()).length;
      return n + (n === 1 ? ' value' : ' values');
    },
    updateStatus: (v) => {
      const lines = v.split('\n').filter((l) => l.trim());
      $('#st-count').textContent = lines.length.toLocaleString() + (lines.length === 1 ? ' value' : ' values');
      const uniq = {};
      let dupes = 0;
      lines.forEach((l) => { if (uniq[l]) dupes++; else uniq[l] = 1; });
      const badge = $('#st-valid');
      if (!lines.length) { badge.textContent = 'Empty'; badge.className = 'badge'; }
      else if (dupes) { badge.textContent = dupes + ' duplicate' + (dupes === 1 ? '' : 's'); badge.className = 'badge is-bad'; }
      else { badge.textContent = 'All unique'; badge.className = 'badge is-ok'; }
      $('#st-size').textContent = new Blob([v]).size + ' B';
    },
    render: (src, preview) => {
      const lines = src.split('\n').map((l) => l.trim()).filter(Boolean);
      if (!lines.length) {
        preview.innerHTML = '<p class="j-empty">Generate values, or paste an existing ID to identify it.</p>';
        return;
      }
      /* When every value is the same format and carries nothing per-value —
         a batch of v4, say — one card says everything twelve would. */
      const infos = lines.slice(0, 12).map(inspect);
      const first = infos[0];
      const sameKind = infos.every((i) => i && first && i.kind === first.kind && i.version === first.version);
      const perValue = infos.some((i) => i && i.created);

      if (lines.length > 1 && sameKind && !perValue) {
        preview.innerHTML = card(lines[0], first) +
          '<p class="j-empty">' + lines.length.toLocaleString() + ' values, all ' +
          escapeHtml(first.kind + (first.version ? ' ' + first.version : '')) +
          '. Nothing is encoded in them beyond randomness, so they share these properties.</p>';
        return;
      }

      let html = infos.map((info, i) => card(lines[i], info)).join('');
      if (lines.length > infos.length) {
        html += '<p class="j-empty">' + (lines.length - infos.length).toLocaleString() +
          ' more not shown — the panel explains the first ' + infos.length + '.</p>';
      }
      preview.innerHTML = html;
    },
    htmlDocument: (title, body) =>
      '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>' + escapeHtml(title) + '</title>\n' +
      '<style>body{font:14px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:800px;margin:0 auto;padding:48px 24px}' +
      '.id-value{font-family:ui-monospace,Menlo,monospace;font-weight:600;margin-bottom:8px}' +
      'table{border-collapse:collapse;margin-bottom:24px}td{border-bottom:1px solid #eee;padding:4px 12px 4px 0}</style>\n' +
      '</head>\n<body>\n' + body + '\n</body>\n</html>\n'
  });

  /* ---------- controls ---------- */
  function syncControls() {
    const t = els.type.value;
    els.lenWrap.hidden = !VARIABLE[t];
    els.nameWrap.hidden = !NAMED[t];
    els.hyphens.parentElement.hidden = !/^v[13-7]$/.test(t);
  }
  els.type.addEventListener('change', () => { syncControls(); generate(api); });
  [els.count, els.len, els.ns, els.name].forEach((n) => {
    if (n) n.addEventListener('change', () => generate(api));
  });
  [els.upper, els.hyphens].forEach((n) => {
    if (n) n.addEventListener('change', () => generate(api));
  });
  $('#btn-generate').addEventListener('click', () => generate(api));

  /* namespace presets */
  Shell.$$('[data-ns]').forEach((b) => b.addEventListener('click', () => {
    els.ns.value = NAMESPACES[b.dataset.ns];
    generate(api);
  }));

  syncControls();
  if (!api.source.trim()) generate(api);
})();
