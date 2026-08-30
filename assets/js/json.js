/* ============================================================
   JSON tool — validate, format, minify and explore.
   Chrome and layout come from shell.js.
   ============================================================ */
(function () {
  'use strict';

  const $ = Shell.$;
  const escapeHtml = Shell.escapeHtml;

  /* JSONPath box — declared up front because the shell renders during boot */
  const qInput = $('#q-input');
  const qCount = $('#q-count');
  let lastMatches = null;
  const setCount = (t) => { if (qCount) qCount.textContent = t; };

  /* ---------- parsing ---------- */
  function parse(src) {
    if (!src.trim()) return { empty: true };
    try { return { value: JSON.parse(src) }; }
    catch (e) { return { error: locate(e, src) }; }
  }

  /* Chrome, Firefox and Safari all word JSON errors differently and newer
     V8 often omits the position entirely — so we locate the fault ourselves
     with a scanner that reports the exact offset it gave up at. */
  function scan(src) {
    let i = 0;
    const n = src.length;
    const err = (msg, at) => {
      const e = new Error(msg);
      e.at = at == null ? i : at;
      throw e;
    };
    const ws = () => { while (i < n && (src[i] === ' ' || src[i] === '\t' || src[i] === '\n' || src[i] === '\r')) i++; };

    function string() {
      i++;
      for (;;) {
        if (i >= n) err('Unterminated string');
        const c = src[i];
        if (c === '"') { i++; return; }
        if (c === '\\') {
          i++;
          const e = src[i];
          if ('"\\/bfnrt'.indexOf(e) > -1) { i++; continue; }
          if (e === 'u') {
            if (!/^[0-9a-fA-F]{4}$/.test(src.substr(i + 1, 4))) err('Invalid \\u escape — it needs four hex digits');
            i += 5; continue;
          }
          err('Invalid escape sequence \\' + (e || ''));
        }
        if (c === '\n') err('Unterminated string — a line break inside a string must be written as \\n');
        i++;
      }
    }
    function number() {
      const st = i;
      if (src[i] === '-') i++;
      while (i < n && src[i] >= '0' && src[i] <= '9') i++;
      if (src[i] === '.') { i++; while (i < n && src[i] >= '0' && src[i] <= '9') i++; }
      if (src[i] === 'e' || src[i] === 'E') {
        i++;
        if (src[i] === '+' || src[i] === '-') i++;
        while (i < n && src[i] >= '0' && src[i] <= '9') i++;
      }
      if (i === st) err('Invalid number');
    }
    function object() {
      i++; ws();
      if (src[i] === '}') { i++; return; }
      for (;;) {
        ws();
        if (src[i] === '}') err('Trailing comma before "}"');
        if (src[i] !== '"') err(src[i] === "'" ? 'Keys must use double quotes, not single quotes' : 'Expected a key in double quotes');
        string(); ws();
        if (src[i] !== ':') err('Expected ":" after the key');
        i++; value(); ws();
        if (src[i] === ',') { i++; continue; }
        if (src[i] === '}') { i++; return; }
        err(i >= n ? 'Unexpected end of input — "}" is missing' : 'Expected "," or "}"');
      }
    }
    function array() {
      i++; ws();
      if (src[i] === ']') { i++; return; }
      for (;;) {
        ws();
        if (src[i] === ']') err('Trailing comma before "]"');
        value(); ws();
        if (src[i] === ',') { i++; continue; }
        if (src[i] === ']') { i++; return; }
        err(i >= n ? 'Unexpected end of input — "]" is missing' : 'Expected "," or "]"');
      }
    }
    function value() {
      ws();
      if (i >= n) err('Unexpected end of input');
      const c = src[i];
      if (c === '{') return object();
      if (c === '[') return array();
      if (c === '"') return string();
      if (c === '-' || (c >= '0' && c <= '9')) return number();
      if (src.startsWith('true', i)) { i += 4; return; }
      if (src.startsWith('false', i)) { i += 5; return; }
      if (src.startsWith('null', i)) { i += 4; return; }
      if (c === "'") err('Strings must use double quotes, not single quotes');
      if (/[A-Za-z_]/.test(c)) {
        const word = (src.slice(i).match(/^[A-Za-z_][\w$]*/) || [''])[0];
        err('Unexpected ' + JSON.stringify(word) + ' — values must be a string, number, object, array, true, false or null');
      }
      err('Unexpected character ' + JSON.stringify(c));
    }

    ws();
    if (i >= n) err('The document is empty');
    value(); ws();
    if (i < n) err('Unexpected extra content after the value');
  }

  function locate(fallbackErr, src) {
    let at = null, message = null;
    try { scan(src); }
    catch (e) { at = typeof e.at === 'number' ? e.at : null; message = e.message; }

    if (message == null) {                       /* scanner disagreed with JSON.parse */
      message = (fallbackErr.message || 'Invalid JSON')
        .replace(/\s*in JSON at position \d+.*$/i, '')
        .replace(/^JSON\.parse:\s*/i, '');
      const p = (fallbackErr.message || '').match(/position (\d+)/i);
      if (p) at = +p[1];
    }

    let line = null, col = null, snippet = null;
    if (at != null) {
      const upto = src.slice(0, Math.min(at, src.length));
      line = upto.split('\n').length;
      col = at - upto.lastIndexOf('\n');
      snippet = src.split('\n')[line - 1];
    }
    return { message, line, column: col, snippet, at };
  }

  const errorHtml = (err) => DataTools.errorCard('Invalid JSON', err);

  /* ---------- source transforms ---------- */
  function reformat(api, indent) {
    const r = parse(api.source);
    if (r.error) return Shell.toast('Can\'t format — ' + r.error.message);
    if (r.empty) return;
    api.replaceAllText(JSON.stringify(r.value, null, indent) + '\n');
    Shell.toast(indent ? 'Formatted with ' + indent + '-space indent' : 'Minified');
  }

  function sortKeys(value) {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).sort().forEach((k) => { out[k] = sortKeys(value[k]); });
      return out;
    }
    return value;
  }

  /* Strip the two things that most often make hand-written JSON invalid:
     comments and trailing commas. String contents are left alone. */
  function repair(src) {
    let out = '', i = 0, inStr = false, esc = false;
    while (i < src.length) {
      const c = src[i], next = src[i + 1];
      if (inStr) {
        out += c;
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        i++;
        continue;
      }
      if (c === '"') { inStr = true; out += c; i++; continue; }
      if (c === '/' && next === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && next === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
      if (c === ',') {
        let j = i + 1;
        while (j < src.length && /\s/.test(src[j])) j++;
        if (src[j] === '}' || src[j] === ']') { i++; continue; }   /* trailing comma */
      }
      out += c; i++;
    }
    return out;
  }

  const commands = {
    format2: (a) => reformat(a, 2),
    format4: (a) => reformat(a, 4),
    minify: (a) => {
      const r = parse(a.source);
      if (r.error) return Shell.toast('Can\'t minify — ' + r.error.message);
      if (r.empty) return;
      a.replaceAllText(JSON.stringify(r.value));
      Shell.toast('Minified');
    },
    sort: (a) => {
      const r = parse(a.source);
      if (r.error) return Shell.toast('Can\'t sort — ' + r.error.message);
      if (r.empty) return;
      a.replaceAllText(JSON.stringify(sortKeys(r.value), null, 2) + '\n');
      Shell.toast('Keys sorted A→Z');
    },
    repair: (a) => {
      const fixed = repair(a.source);
      if (fixed === a.source) return Shell.toast('Nothing to repair');
      const r = parse(fixed);
      a.replaceAllText(r.error ? fixed : JSON.stringify(r.value, null, 2) + '\n');
      Shell.toast(r.error ? 'Removed comments and trailing commas — still invalid' : 'Repaired and formatted');
    },
    escape: (a) => {
      const ed = a.el.editor;
      const sel = ed.value.slice(ed.selectionStart, ed.selectionEnd) || ed.value;
      const out = JSON.stringify(sel);
      if (ed.selectionStart === ed.selectionEnd) a.replaceAllText(out);
      else a.setRange(ed.selectionStart, ed.selectionEnd, out);
      Shell.toast('Escaped as a JSON string');
    },
    unescape: (a) => {
      try {
        const v = JSON.parse(a.source);
        if (typeof v !== 'string') return Shell.toast('The document is not a JSON string');
        a.replaceAllText(v);
        Shell.toast('Unescaped');
      } catch (e) { Shell.toast('Not a valid JSON string'); }
    },
    expandAll: () => {
      Shell.$$('#preview details').forEach((d) => { d.open = true; });
    },
    collapseAll: () => {
      Shell.$$('#preview details').forEach((d, i) => { d.open = i === 0; });
    }
  };

  /* ---------- status ---------- */
  function setStatus(src) {
    const r = parse(src);
    const badge = $('#st-valid');
    const size = new Blob([src]).size;
    $('#st-size').textContent = size < 1024 ? size + ' B' : (size / 1024).toFixed(1) + ' KB';
    $('#st-lines').textContent = src.split('\n').length.toLocaleString() + ' lines';

    if (r.empty) {
      badge.textContent = 'Empty';
      badge.className = 'badge';
      $('#st-shape').textContent = '—';
      return;
    }
    if (r.error) {
      badge.textContent = 'Invalid';
      badge.className = 'badge is-bad';
      $('#st-shape').textContent = r.error.line != null ? 'Error on line ' + r.error.line : 'Parse error';
      return;
    }
    const s = DataTools.inspect(r.value);
    badge.textContent = 'Valid';
    badge.className = 'badge is-ok';
    $('#st-shape').textContent = s.keys.toLocaleString() + ' keys · depth ' + s.depth;
  }

  /* ---------- go ---------- */
  const api = Shell.create({
    tool: 'json',
    ext: 'json',
    mime: 'application/json',
    blank: '{\n  \n}\n',
    sampleTitle: 'Example payload',
    swPath: '../sw.js',
    commands: commands,
    shortcuts: {
      b: (a) => commands.format2(a),
      m: (a) => commands.minify(a)
    },
    deriveTitle: (content) => {
      const r = parse(content);
      if (r.error || r.empty) return 'Untitled';
      const v = r.value;
      if (Array.isArray(v)) return v.length + '-item array';
      if (v && typeof v === 'object') {
        const k = Object.keys(v);
        return k.length ? k.slice(0, 3).join(', ').slice(0, 60) : 'Empty object';
      }
      return 'Untitled';
    },
    docSummary: (content) => {
      const r = parse(content);
      if (r.error) return 'invalid';
      if (r.empty) return 'empty';
      const s = DataTools.inspect(r.value);
      return s.keys + ' keys · depth ' + s.depth;
    },
    updateStatus: setStatus,
    /* an array of flat objects is exactly what a CSV is */
    payloadFor: (target, source) => {
      if (target !== 'csv') return source;
      const r = parse(source);
      if (r.error || r.empty || !Array.isArray(r.value) || !r.value.length) return source;
      const keys = [];
      r.value.forEach((o) => Object.keys(o || {}).forEach((k) => { if (keys.indexOf(k) === -1) keys.push(k); }));
      const cell = (v) => {
        const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      return [keys.join(',')].concat(r.value.map((o) => keys.map((k) => cell(o && o[k])).join(','))).join('\n') + '\n';
    },
    render: (src, preview) => {
      const r = parse(src);
      lastMatches = null;
      if (r.empty) { preview.innerHTML = '<p class="j-empty">Paste or type JSON on the left.</p>'; setCount(''); return; }
      if (r.error) { preview.innerHTML = errorHtml(r.error); setCount(''); return; }

      const q = qInput ? qInput.value.trim() : '';
      if (!q) {
        preview.innerHTML = DataTools.renderValue(r.value);
        setCount('');
        return;
      }

      let matches;
      try { matches = DataTools.query(r.value, q); }
      catch (e) {
        preview.innerHTML = '<div class="j-error"><div class="j-error-title">Bad JSONPath</div>' +
          '<p class="j-error-msg">' + escapeHtml(e.message) + '</p></div>';
        setCount('error');
        return;
      }
      lastMatches = matches;
      setCount(matches.length + (matches.length === 1 ? ' match' : ' matches'));
      if (!matches.length) {
        preview.innerHTML = '<p class="j-empty">No matches for <code>' + escapeHtml(q) + '</code>.</p>';
        return;
      }
      preview.innerHTML = DataTools.renderMatches(matches);
    },
    htmlDocument: (title, body) =>
      '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>' + escapeHtml(title) + '</title>\n<style>' + [
        'body{margin:0;background:#fff;color:#1a1d23;font:14px/1.7 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
        '.wrap{max-width:900px;margin:0 auto;padding:48px 24px}',
        '.j-row{padding-left:18px;border-left:1px solid #e6e8ec}',
        '.j-key{color:#6b3fa0}.j-idx{color:#8b94a3}.j-str{color:#0a7d4f}.j-num{color:#0550ae}',
        '.j-bool{color:#b7791f}.j-null{color:#8b94a3}.j-punc{color:#8b94a3}',
        '.j-count{color:#8b94a3;font-size:.85em;padding:0 6px}',
        'summary{cursor:pointer}details{margin:0}'
      ].join('') + '</style>\n</head>\n<body>\n<main class="wrap">\n' + body + '\n</main>\n</body>\n</html>\n',
    exporters: {
      minified: (a) => {
        const r = parse(a.source);
        if (r.error) return Shell.toast('Can\'t export — invalid JSON');
        const doc = a.currentDoc();
        Shell.download(Shell.safeFilename(doc && doc.title) + '.min.json', 'application/json', JSON.stringify(r.value));
        Shell.toast('Minified JSON downloaded');
      }
    }
  });

  /* ---------- JSONPath box ---------- */
  if (qInput) {
    let t = null;
    qInput.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => api.render(), 160);
    });
    qInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { qInput.value = ''; api.render(); qInput.blur(); }
    });
    $('#q-clear').addEventListener('click', () => { qInput.value = ''; api.render(); qInput.focus(); });
    $('#q-copy').addEventListener('click', async () => {
      if (!lastMatches || !lastMatches.length) return Shell.toast('Nothing to copy — run a query first');
      const payload = lastMatches.length === 1 ? lastMatches[0].value : lastMatches.map((m) => m.value);
      const ok = await Shell.copyText(JSON.stringify(payload, null, 2));
      Shell.toast(ok ? 'Copied ' + lastMatches.length + ' result' + (lastMatches.length === 1 ? '' : 's') : 'Copy failed');
    });
    Shell.$$('.q-example').forEach((b) => b.addEventListener('click', () => {
      qInput.value = b.textContent;
      api.render();
    }));
  }

  /* the primary toolbar button */
  const btnFormat = $('#btn-format');
  if (btnFormat) btnFormat.addEventListener('click', () => commands.format2(api));

  /* click a key to copy its path */
  api.el.preview.addEventListener('click', async (e) => {
    const key = e.target.closest('.j-key[data-path]');
    if (!key) return;
    const ok = await Shell.copyText(key.dataset.path);
    Shell.toast(ok ? 'Copied ' + key.dataset.path : 'Copy failed');
  });
})();
