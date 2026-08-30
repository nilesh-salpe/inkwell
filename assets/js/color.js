/* ============================================================
   Colour converter — hex, rgb, hsl and oklch, with WCAG
   contrast against a chosen background.
   ============================================================ */
(function () {
  'use strict';

  const $ = Shell.$;
  const escapeHtml = Shell.escapeHtml;
  const bgInput = $('#c-bg');

  const NAMED = {
    black: '#000000', white: '#ffffff', red: '#ff0000', lime: '#00ff00', blue: '#0000ff',
    yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff', silver: '#c0c0c0', gray: '#808080',
    grey: '#808080', maroon: '#800000', olive: '#808000', green: '#008000', purple: '#800080',
    teal: '#008080', navy: '#000080', orange: '#ffa500', pink: '#ffc0cb', brown: '#a52a2a',
    coral: '#ff7f50', gold: '#ffd700', indigo: '#4b0082', violet: '#ee82ee', tomato: '#ff6347',
    salmon: '#fa8072', khaki: '#f0e68c', crimson: '#dc143c', orchid: '#da70d6', plum: '#dda0dd',
    turquoise: '#40e0d0', beige: '#f5f5dc', ivory: '#fffff0', lavender: '#e6e6fa'
  };

  /* ---------- parsing ---------- */
  function parse(raw) {
    const s = String(raw).trim().toLowerCase();
    if (!s) return null;

    if (NAMED[s]) return fromHex(NAMED[s]);

    let m = s.match(/^#?([0-9a-f]{3,8})$/);
    if (m) {
      let h = m[1];
      if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
      if (h.length === 6 || h.length === 8) return fromHex('#' + h);
      return { error: 'A hex colour needs 3, 4, 6 or 8 digits' };
    }

    m = s.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[\s,\/]+/).filter(Boolean);
      if (p.length < 3) return { error: 'rgb() needs three components' };
      const conv = (x) => x.endsWith('%') ? Math.round(parseFloat(x) * 2.55) : Math.round(parseFloat(x));
      return make(conv(p[0]), conv(p[1]), conv(p[2]), p[3] == null ? 1 : alpha(p[3]));
    }

    m = s.match(/^hsla?\(([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[\s,\/]+/).filter(Boolean);
      if (p.length < 3) return { error: 'hsl() needs three components' };
      const rgb = hslToRgb(parseFloat(p[0]), parseFloat(p[1]) / 100, parseFloat(p[2]) / 100);
      return make(rgb[0], rgb[1], rgb[2], p[3] == null ? 1 : alpha(p[3]));
    }

    return { error: 'Not a colour we recognise' };
  }

  const alpha = (x) => x.endsWith('%') ? parseFloat(x) / 100 : parseFloat(x);
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  function fromHex(hex) {
    const h = hex.slice(1);
    return make(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16),
      h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1);
  }

  function make(r, g, b, a) {
    if ([r, g, b].some((x) => isNaN(x))) return { error: 'Could not read the components' };
    return { r: clamp(Math.round(r), 0, 255), g: clamp(Math.round(g), 0, 255), b: clamp(Math.round(b), 0, 255),
             a: isNaN(a) ? 1 : clamp(a, 0, 1) };
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = (t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [Math.round(hue(h + 1 / 3) * 255), Math.round(hue(h) * 255), Math.round(hue(h - 1 / 3) * 255)];
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l * 100];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h * 60, s * 100, l * 100];
  }

  /* sRGB -> linear -> OKLab -> OKLCH (Björn Ottosson's transform) */
  const toLinear = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };

  function rgbToOklch(r, g, b) {
    const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    const C = Math.sqrt(A * A + B * B);
    let H = Math.atan2(B, A) * 180 / Math.PI;
    if (H < 0) H += 360;
    return [L, C, H];
  }

  /* ---------- WCAG contrast ---------- */
  const lumChannel = (c) => toLinear(c);
  const luminance = (c) => 0.2126 * lumChannel(c.r) + 0.7152 * lumChannel(c.g) + 0.0722 * lumChannel(c.b);

  function contrast(a, b) {
    const l1 = luminance(a), l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  function wcag(ratio) {
    const badge = (ok, label) => '<span class="badge ' + (ok ? 'is-ok' : 'is-bad') + '">' + label + '</span>';
    return badge(ratio >= 4.5, 'AA text') + ' ' + badge(ratio >= 3, 'AA large') + ' ' + badge(ratio >= 7, 'AAA text');
  }

  /* ---------- formats ---------- */
  const hex2 = (n) => (n + 0x100).toString(16).slice(1);
  const toHex = (c) => '#' + hex2(c.r) + hex2(c.g) + hex2(c.b) + (c.a < 1 ? hex2(Math.round(c.a * 255)) : '');
  const toRgb = (c) => c.a < 1
    ? 'rgb(' + c.r + ' ' + c.g + ' ' + c.b + ' / ' + +c.a.toFixed(3) + ')'
    : 'rgb(' + c.r + ' ' + c.g + ' ' + c.b + ')';
  function toHsl(c) {
    const [h, s, l] = rgbToHsl(c.r, c.g, c.b);
    const base = 'hsl(' + Math.round(h) + ' ' + Math.round(s) + '% ' + Math.round(l) + '%';
    return c.a < 1 ? base + ' / ' + +c.a.toFixed(3) + ')' : base + ')';
  }
  function toOklch(c) {
    const [L, C, H] = rgbToOklch(c.r, c.g, c.b);
    /* hue is meaningless with no chroma — greys would otherwise report a random angle */
    const hue = C < 0.0002 ? 0 : H;
    const base = 'oklch(' + (L * 100).toFixed(1) + '% ' + C.toFixed(4) + ' ' + hue.toFixed(1);
    return c.a < 1 ? base + ' / ' + +c.a.toFixed(3) + ')' : base + ')';
  }

  const line = (label, value) =>
    '<div class="col-row" data-value="' + escapeHtml(value) + '">' +
    '<span class="col-key">' + escapeHtml(label) + '</span>' +
    '<code class="col-val">' + escapeHtml(value) + '</code>' +
    '<button class="mini col-copy" data-tip="Copy ' + escapeHtml(label) + '" aria-label="Copy ' + escapeHtml(label) + '">Copy</button></div>';

  function card(raw, c, bg) {
    if (c.error) {
      return '<section class="esc-card"><div class="esc-head"><span class="esc-label">' +
        escapeHtml(raw.trim()) + '</span></div><p class="esc-fail">' + escapeHtml(c.error) + '</p></section>';
    }
    const ratio = bg ? contrast(c, bg) : null;
    const onWhite = contrast(c, { r: 255, g: 255, b: 255, a: 1 });
    const onBlack = contrast(c, { r: 0, g: 0, b: 0, a: 1 });

    return '<section class="esc-card col-card">' +
      '<div class="col-head">' +
      '<span class="col-swatch" style="background:' + toHex(c) + '"></span>' +
      '<span class="esc-label">' + escapeHtml(raw.trim()) + '</span></div>' +
      line('HEX', toHex(c)) + line('RGB', toRgb(c)) + line('HSL', toHsl(c)) + line('OKLCH', toOklch(c)) +
      '<div class="col-contrast">' +
      (ratio !== null
        ? '<p class="col-ratio">Against the chosen background: <strong>' + ratio.toFixed(2) + ':1</strong> ' + wcag(ratio) + '</p>'
        : '') +
      '<p class="col-ratio">On white <strong>' + onWhite.toFixed(2) + ':1</strong> · on black <strong>' +
      onBlack.toFixed(2) + ':1</strong></p>' +
      '</div></section>';
  }

  /* ---------- go ---------- */
  const api = Shell.create({
    tool: 'color',
    ext: 'txt',
    mime: 'text/plain',
    blank: '',
    sampleTitle: 'Example palette',
    swPath: '../sw.js',
    commands: { clear: (a) => { a.replaceAllText(''); a.el.editor.focus(); } },
    shortcuts: {},
    deriveTitle: (c) => c.trim().split('\n')[0].slice(0, 40) || 'Untitled',
    docSummary: (c) => c.split('\n').filter((l) => l.trim()).length + ' colours',
    updateStatus: (v) => {
      const list = v.split('\n').filter((l) => l.trim());
      $('#st-count').textContent = list.length + (list.length === 1 ? ' colour' : ' colours');
      const bad = list.map(parse).filter((r) => r && r.error).length;
      const badge = $('#st-valid');
      if (!list.length) { badge.textContent = 'Empty'; badge.className = 'badge'; }
      else if (bad) { badge.textContent = bad + ' unreadable'; badge.className = 'badge is-bad'; }
      else { badge.textContent = 'All valid'; badge.className = 'badge is-ok'; }
    },
    render: (src, preview) => {
      const list = src.split('\n').filter((l) => l.trim());
      if (!list.length) {
        preview.innerHTML = '<p class="j-empty">Enter colours on the left, one per line — ' +
          '<code>#3b82f6</code>, <code>rgb(59 130 246)</code>, <code>hsl(217 91% 60%)</code> or a CSS name.</p>';
        return;
      }
      const bgParsed = bgInput && bgInput.value.trim() ? parse(bgInput.value) : null;
      const bg = bgParsed && !bgParsed.error ? bgParsed : null;
      preview.innerHTML = list.slice(0, 40).map((raw) => {
        const c = parse(raw);
        return c ? card(raw, c, bg) : '';
      }).join('') + (list.length > 40 ? '<p class="j-empty">Showing the first 40.</p>' : '');
    },
    htmlDocument: (title, body) =>
      '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>' + escapeHtml(title) + '</title>\n' +
      '<style>body{font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:700px;margin:0 auto;padding:48px 24px}' +
      '.col-swatch{display:inline-block;width:34px;height:34px;border-radius:8px;border:1px solid #ddd;vertical-align:middle;margin-right:10px}' +
      '.col-row{display:flex;gap:12px;padding:3px 0}.col-key{width:64px;color:#666}code{font-family:ui-monospace,Menlo,monospace}' +
      'button{display:none}section{margin-bottom:26px}</style>\n</head>\n<body>\n' + body + '\n</body>\n</html>\n'
  });

  if (bgInput) {
    bgInput.addEventListener('input', () => api.render());
  }
  api.el.preview.addEventListener('click', async (e) => {
    const row = e.target.closest('.col-row');
    if (!row || !e.target.closest('.col-copy')) return;
    const ok = await Shell.copyText(row.dataset.value);
    Shell.toast(ok ? 'Copied ' + row.dataset.value : 'Copy failed');
  });
})();
