/* ============================================================
   Number base converter — binary, octal, decimal, hex and any
   base from 2 to 36, plus bitwise operations. BigInt throughout,
   so precision does not quietly disappear past 2^53.
   ============================================================ */
(function () {
  'use strict';

  const $ = Shell.$;
  const escapeHtml = Shell.escapeHtml;

  const els = { base: $('#b-base'), op: $('#b-op'), operand: $('#b-operand'), width: $('#b-width') };

  const PREFIX = { '0x': 16, '0b': 2, '0o': 8 };

  /* Returns { value: BigInt, base } or { error }. */
  function parseValue(raw, forced) {
    let s = String(raw).trim().replace(/[_\s,]/g, '');
    if (!s) return null;
    let negative = false;
    if (s[0] === '-') { negative = true; s = s.slice(1); }

    let base = forced && forced !== 'auto' ? parseInt(forced, 10) : null;
    const pre = s.slice(0, 2).toLowerCase();
    if (PREFIX[pre]) {
      if (!base) base = PREFIX[pre];
      s = s.slice(2);
    } else if (!base) {
      base = /^[0-9]+$/.test(s) ? 10 : /^[0-9a-fA-F]+$/.test(s) ? 16 : null;
      if (!base) return { error: 'Cannot tell which base "' + raw.trim() + '" is in — pick one above.' };
    }
    if (!s) return { error: 'No digits after the prefix' };

    const digits = '0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, base);
    let value = 0n;
    const big = BigInt(base);
    for (const ch of s.toLowerCase()) {
      const d = digits.indexOf(ch);
      if (d === -1) return { error: '"' + ch + '" is not a valid digit in base ' + base };
      value = value * big + BigInt(d);
    }
    return { value: negative ? -value : value, base };
  }

  const inBase = (v, base) => (v < 0n ? '-' : '') + (v < 0n ? -v : v).toString(base);

  const group = (s, n) => s.replace(new RegExp('\\B(?=(.{' + n + '})+$)', 'g'), ' ');

  function bitWidth(v) {
    const abs = v < 0n ? -v : v;
    return abs === 0n ? 1 : abs.toString(2).length;
  }

  /* Two's complement at a chosen width, which is what people actually
     mean when they ask what a negative number "looks like". */
  function twos(v, bits) {
    const mod = 1n << BigInt(bits);
    return ((v % mod) + mod) % mod;
  }

  function applyOp(a, b, op, bits) {
    const mask = (1n << BigInt(bits)) - 1n;
    switch (op) {
      case 'and': return (twos(a, bits) & twos(b, bits)) & mask;
      case 'or':  return (twos(a, bits) | twos(b, bits)) & mask;
      case 'xor': return (twos(a, bits) ^ twos(b, bits)) & mask;
      case 'not': return (~twos(a, bits)) & mask;
      case 'shl': return (twos(a, bits) << b) & mask;
      case 'shr': return twos(a, bits) >> b;
      case 'add': return a + b;
      case 'sub': return a - b;
      case 'mul': return a * b;
      default: return null;
    }
  }

  const OP_LABEL = { and: 'AND', or: 'OR', xor: 'XOR', not: 'NOT', shl: '<<', shr: '>>', add: '+', sub: '-', mul: '×' };

  function row(k, v, mono) {
    return '<tr><td>' + escapeHtml(k) + '</td><td' + (mono ? ' class="b-mono"' : '') + '>' +
      escapeHtml(v) + '</td><td class="b-act"><button class="mini row-copy" data-value="' + escapeHtml(v) +
      '" data-tip="Copy this value" aria-label="Copy this value">Copy</button></td></tr>';
  }

  function card(raw, r, bits) {
    if (r.error) {
      return '<section class="esc-card"><div class="esc-head"><span class="esc-label">' +
        escapeHtml(raw.trim()) + '</span></div><p class="esc-fail">' + escapeHtml(r.error) + '</p></section>';
    }
    const v = r.value;
    const negative = v < 0n;
    let html = '<section class="esc-card"><div class="esc-head"><span class="esc-label">' +
      escapeHtml(raw.trim()) + '</span><span class="badge">read as base ' + r.base + '</span></div>' +
      '<table class="jwt-claims"><tbody>' +
      row('Decimal', inBase(v, 10), true) +
      row('Hexadecimal', (negative ? '-0x' : '0x') + (negative ? -v : v).toString(16).toUpperCase(), true) +
      row('Octal', (negative ? '-0o' : '0o') + (negative ? -v : v).toString(8), true) +
      row('Binary', (negative ? '-0b' : '0b') + group((negative ? -v : v).toString(2), 4), true) +
      row('Base 36', inBase(v, 36), true) +
      row('Bit length', bitWidth(v) + ' bits');

    if (negative) {
      html += row('Two’s complement (' + bits + '-bit)', '0b' + group(twos(v, bits).toString(2), 4), true);
    }
    html += '</tbody></table></section>';
    return html;
  }

  /* ---------- go ---------- */
  const api = Shell.create({
    tool: 'base',
    ext: 'txt',
    mime: 'text/plain',
    blank: '',
    sampleTitle: 'Example numbers',
    swPath: '../sw.js',
    focusControl: '#b-operand',
    commands: {
      clear: (a) => { a.replaceAllText(''); a.el.editor.focus(); }
    },
    shortcuts: {},
    deriveTitle: (c) => {
      const n = c.split('\n').filter((l) => l.trim()).length;
      return n === 0 ? 'Untitled' : n === 1 ? c.trim().split('\n')[0].slice(0, 40) : n + ' numbers';
    },
    docSummary: (c) => c.split('\n').filter((l) => l.trim()).length + ' values',
    updateStatus: (v) => {
      const list = v.split('\n').filter((l) => l.trim());
      $('#st-count').textContent = list.length + (list.length === 1 ? ' value' : ' values');
      const bad = list.map((l) => parseValue(l, els.base.value)).filter((r) => r && r.error).length;
      const badge = $('#st-valid');
      if (!list.length) { badge.textContent = 'Empty'; badge.className = 'badge'; }
      else if (bad) { badge.textContent = bad + ' unreadable'; badge.className = 'badge is-bad'; }
      else { badge.textContent = 'All valid'; badge.className = 'badge is-ok'; }
    },
    render: (src, preview) => {
      const list = src.split('\n').filter((l) => l.trim());
      if (!list.length) {
        preview.innerHTML = '<p class="j-empty">Enter numbers on the left, one per line. ' +
          '<code>0x</code>, <code>0b</code> and <code>0o</code> prefixes are understood.</p>';
        return;
      }
      const bits = parseInt(els.width.value, 10) || 32;
      const op = els.op.value;
      const operandRaw = els.operand.value.trim();
      const operand = operandRaw ? parseValue(operandRaw, els.base.value) : null;

      let html = '';
      if (op !== 'none') {
        if (op !== 'not' && (!operand || operand.error)) {
          html += '<div class="csv-note">Enter a second value above to use ' + OP_LABEL[op] + '.</div>';
        }
      }

      list.slice(0, 40).forEach((raw) => {
        const r = parseValue(raw, els.base.value);
        if (!r) return;
        html += card(raw, r, bits);
        if (!r.error && op !== 'none' && (op === 'not' || (operand && !operand.error))) {
          const b = operand ? operand.value : 0n;
          const out = applyOp(r.value, b, op, bits);
          if (out !== null) {
            const label = op === 'not' ? 'NOT ' + inBase(r.value, 10)
              : inBase(r.value, 10) + ' ' + OP_LABEL[op] + ' ' + inBase(b, 10);
            html += '<section class="esc-card is-result"><div class="esc-head">' +
              '<span class="esc-label">' + escapeHtml(label) + '</span></div>' +
              '<table class="jwt-claims"><tbody>' +
              row('Decimal', inBase(out, 10), true) +
              row('Hexadecimal', '0x' + (out < 0n ? -out : out).toString(16).toUpperCase(), true) +
              row('Binary', '0b' + group((out < 0n ? -out : out).toString(2), 4), true) +
              '</tbody></table></section>';
          }
        }
      });
      if (list.length > 40) html += '<p class="j-empty">Showing the first 40 of ' + list.length + ' values.</p>';
      preview.innerHTML = html;
    },
    htmlDocument: (title, body) =>
      '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>' + escapeHtml(title) + '</title>\n' +
      '<style>body{font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:760px;margin:0 auto;padding:48px 24px}' +
      'table{border-collapse:collapse;margin-bottom:24px}td{border-bottom:1px solid #eee;padding:5px 14px 5px 0}' +
      '.b-mono{font-family:ui-monospace,Menlo,Consolas,monospace}</style>\n</head>\n<body>\n' + body + '\n</body>\n</html>\n'
  });

  api.el.preview.addEventListener('click', async (e) => {
    const b = e.target.closest('.row-copy');
    if (!b) return;
    Shell.toast(await Shell.copyText(b.dataset.value) ? 'Copied ' + b.dataset.value : 'Copy failed');
  });

  [els.base, els.op, els.operand, els.width].forEach((n) => {
    if (!n) return;
    n.addEventListener('input', () => api.render());
    n.addEventListener('change', () => { api.render(); api.el.editor.dispatchEvent(new Event('input', { bubbles: true })); });
  });
})();
