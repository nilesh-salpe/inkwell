/* ============================================================
   Hash primitives the platform does not provide.

   WebCrypto covers SHA-1/256/384/512 but has no MD5 and no CRC32,
   and its API is async — awkward inside a synchronous UUID
   generator. These are the synchronous fallbacks, shared by the
   ID generator and the hash tool.
   ============================================================ */
window.Hashes = (function () {
  'use strict';

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


  /* CRC32 — a checksum, not a hash: fine for spotting corruption,
     useless against anything deliberate. */
  const TABLE = (function () {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    c = (c ^ 0xffffffff) >>> 0;
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, c);
    return out;
  }

  return { md5, sha1, crc32 };
})();
