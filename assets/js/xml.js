/* ============================================================
   XML tool — validate, format and explore.
   Parsing and error reporting come from the platform's own
   DOMParser; the tree and JSONPath engine are shared.
   ============================================================ */
(function () {
  'use strict';

  const $ = Shell.$;
  const escapeHtml = Shell.escapeHtml;

  /* JSONPath box — declared before the shell's first render */
  const qInput = $('#q-input');
  const qCount = $('#q-count');
  let lastMatches = null;
  const setCount = (t) => { if (qCount) qCount.textContent = t; };

  /* ---------- parsing ---------- */
  function parse(src) {
    if (!src.trim()) return { empty: true };
    const doc = new DOMParser().parseFromString(src, 'application/xml');
    const bad = doc.querySelector('parsererror');
    if (bad) return { error: locate(bad.textContent || '', src) };
    if (!doc.documentElement) return { error: { message: 'No root element' } };
    return { doc: doc };
  }

  /* Browsers word parser errors differently; pull out what we can. */
  function locate(text, src) {
    const lc = text.match(/line\s+(\d+)\s+at\s+column\s+(\d+)\s*:?\s*(.*)/i) ||
               text.match(/line\s+(\d+),?\s+column\s+(\d+)\s*:?\s*(.*)/i);
    let line = null, col = null, message = null;
    if (lc) {
      line = +lc[1]; col = +lc[2];
      message = (lc[3] || '').split('\n')[0].trim();
    }
    if (!message) {
      message = text.replace(/This page contains the following errors:?/i, '')
        .replace(/Below is a rendering of the page up to the first error\.?/i, '')
        .trim().split('\n')[0] || 'The document is not well-formed XML';
    }
    return {
      message: message,
      line: line,
      column: col,
      snippet: line != null ? src.split('\n')[line - 1] : null
    };
  }

  /* ---------- formatting ---------- */
  const VOID_TEXT = (node) => {
    /* an element whose only child is a short text node stays on one line */
    if (node.childNodes.length !== 1) return null;
    const only = node.firstChild;
    if (only.nodeType !== 3) return null;
    const t = only.nodeValue.trim();
    return t.length <= 80 ? t : null;
  };

  function attrs(node) {
    return Array.prototype.map.call(node.attributes || [],
      (a) => ' ' + a.name + '="' + a.value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') + '"').join('');
  }
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function serialize(node, depth, pad, out) {
    const ind = pad.repeat(depth);
    switch (node.nodeType) {
      case 1: {                                   /* element */
        const inline = VOID_TEXT(node);
        if (inline !== null) {
          out.push(ind + '<' + node.nodeName + attrs(node) + '>' + esc(inline) + '</' + node.nodeName + '>');
          return;
        }
        const kids = Array.prototype.filter.call(node.childNodes,
          (c) => !(c.nodeType === 3 && !c.nodeValue.trim()));
        if (!kids.length) { out.push(ind + '<' + node.nodeName + attrs(node) + '/>'); return; }
        out.push(ind + '<' + node.nodeName + attrs(node) + '>');
        kids.forEach((c) => serialize(c, depth + 1, pad, out));
        out.push(ind + '</' + node.nodeName + '>');
        return;
      }
      case 3: {                                   /* text */
        const t = node.nodeValue.trim();
        if (t) out.push(ind + esc(t));
        return;
      }
      case 4: out.push(ind + '<![CDATA[' + node.nodeValue + ']]>'); return;
      case 7: out.push(ind + '<?' + node.target + ' ' + node.data + '?>'); return;
      case 8: out.push(ind + '<!--' + node.nodeValue + '-->'); return;
      default: return;
    }
  }

  function formatDoc(doc, indent) {
    const pad = ' '.repeat(indent);
    const out = [];
    const decl = '<?xml version="1.0" encoding="UTF-8"?>';
    Array.prototype.forEach.call(doc.childNodes, (n) => serialize(n, 0, pad, out));
    return decl + '\n' + out.join('\n') + '\n';
  }

  function minifyDoc(doc) {
    const out = [];
    (function walk(node) {
      if (node.nodeType === 1) {
        const kids = Array.prototype.filter.call(node.childNodes, (c) => !(c.nodeType === 3 && !c.nodeValue.trim()));
        if (!kids.length) { out.push('<' + node.nodeName + attrs(node) + '/>'); return; }
        out.push('<' + node.nodeName + attrs(node) + '>');
        kids.forEach(walk);
        out.push('</' + node.nodeName + '>');
      } else if (node.nodeType === 3) {
        const t = node.nodeValue.trim();
        if (t) out.push(esc(t));
      } else if (node.nodeType === 4) out.push('<![CDATA[' + node.nodeValue + ']]>');
      else if (node.nodeType === 8) out.push('<!--' + node.nodeValue + '-->');
    })(doc.documentElement);
    return out.join('');
  }

  /* ---------- XML as a plain value, so the tree and JSONPath work ----------
     Attributes become "@name", mixed text becomes "#text", and repeated
     child elements collapse into an array — the usual xml-to-json shape. */
  function toValue(node) {
    const obj = {};
    let has = false;

    Array.prototype.forEach.call(node.attributes || [], (a) => { obj['@' + a.name] = a.value; has = true; });

    const kids = Array.prototype.filter.call(node.childNodes,
      (c) => c.nodeType === 1 || (c.nodeType === 3 && c.nodeValue.trim()) || c.nodeType === 4);

    const elements = kids.filter((c) => c.nodeType === 1);
    const text = kids.filter((c) => c.nodeType !== 1).map((c) => c.nodeValue.trim()).join(' ').trim();

    if (!elements.length) {
      if (!has) return text === '' ? null : coerce(text);
      if (text) obj['#text'] = coerce(text);
      return obj;
    }

    elements.forEach((child) => {
      const name = child.nodeName;
      const value = toValue(child);
      if (Object.prototype.hasOwnProperty.call(obj, name)) {
        if (!Array.isArray(obj[name])) obj[name] = [obj[name]];
        obj[name].push(value);
      } else obj[name] = value;
      has = true;
    });
    if (text) obj['#text'] = coerce(text);
    return obj;
  }

  /* numbers and booleans read better than strings in the tree */
  function coerce(t) {
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(t) && t.length < 16) return Number(t);
    return t;
  }

  const asValue = (doc) => {
    const root = doc.documentElement;
    const out = {};
    out[root.nodeName] = toValue(root);
    return out;
  };

  function stats(doc) {
    let elements = 0, depth = 0, attributes = 0;
    (function walk(n, d) {
      elements++;
      attributes += (n.attributes || []).length;
      if (d > depth) depth = d;
      Array.prototype.forEach.call(n.children, (c) => walk(c, d + 1));
    })(doc.documentElement, 1);
    return { elements, depth, attributes };
  }

  /* ---------- commands ---------- */
  function reformat(a, indent) {
    const r = parse(a.source);
    if (r.error) return Shell.toast('Can\'t format — ' + r.error.message);
    if (r.empty) return;
    a.replaceAllText(formatDoc(r.doc, indent));
    Shell.toast('Formatted with ' + indent + '-space indent');
  }

  const commands = {
    format2: (a) => reformat(a, 2),
    format4: (a) => reformat(a, 4),
    minify: (a) => {
      const r = parse(a.source);
      if (r.error) return Shell.toast('Can\'t minify — ' + r.error.message);
      if (r.empty) return;
      a.replaceAllText(minifyDoc(r.doc));
      Shell.toast('Minified');
    },
    toJson: (a) => {
      const r = parse(a.source);
      if (r.error) return Shell.toast('Can\'t convert — ' + r.error.message);
      if (r.empty) return;
      a.replaceAllText(JSON.stringify(asValue(r.doc), null, 2) + '\n');
      Shell.toast('Converted to JSON — undo (Ctrl+Z) to go back');
    },
    expandAll: () => Shell.$$('#preview details').forEach((d) => { d.open = true; }),
    collapseAll: () => Shell.$$('#preview details').forEach((d, i) => { d.open = i === 0; })
  };

  /* ---------- status ---------- */
  function setStatus(src) {
    const r = parse(src);
    const badge = $('#st-valid');
    const size = new Blob([src]).size;
    $('#st-size').textContent = size < 1024 ? size + ' B' : (size / 1024).toFixed(1) + ' KB';
    $('#st-lines').textContent = src.split('\n').length.toLocaleString() + ' lines';

    if (r.empty) { badge.textContent = 'Empty'; badge.className = 'badge'; $('#st-shape').textContent = '—'; return; }
    if (r.error) {
      badge.textContent = 'Invalid'; badge.className = 'badge is-bad';
      $('#st-shape').textContent = r.error.line != null ? 'Error on line ' + r.error.line : 'Not well-formed';
      return;
    }
    const s = stats(r.doc);
    badge.textContent = 'Well-formed'; badge.className = 'badge is-ok';
    $('#st-shape').textContent = s.elements.toLocaleString() + ' elements · depth ' + s.depth;
  }

  /* ---------- go ---------- */
  const api = Shell.create({
    tool: 'xml',
    ext: 'xml',
    mime: 'application/xml',
    blank: '<root>\n  \n</root>\n',
    sampleTitle: 'Example document',
    swPath: '../sw.js',
    commands: commands,
    shortcuts: { b: (a) => commands.format2(a), j: (a) => commands.toJson(a) },
    deriveTitle: (content) => {
      const r = parse(content);
      if (r.error || r.empty) return 'Untitled';
      return '<' + r.doc.documentElement.nodeName + '>';
    },
    docSummary: (content) => {
      const r = parse(content);
      if (r.error) return 'not well-formed';
      if (r.empty) return 'empty';
      const s = stats(r.doc);
      return s.elements + ' elements · depth ' + s.depth;
    },
    updateStatus: setStatus,
    render: (src, preview) => {
      const r = parse(src);
      lastMatches = null;
      if (r.empty) { preview.innerHTML = '<p class="j-empty">Paste or type XML on the left.</p>'; setCount(''); return; }
      if (r.error) { preview.innerHTML = DataTools.errorCard('Not well-formed', r.error); setCount(''); return; }

      const value = asValue(r.doc);
      const q = qInput ? qInput.value.trim() : '';
      if (q) {
        let matches;
        try { matches = DataTools.query(value, q); }
        catch (e) { preview.innerHTML = DataTools.errorCard('Bad JSONPath', { message: e.message }); setCount('error'); return; }
        lastMatches = matches;
        setCount(matches.length + (matches.length === 1 ? ' match' : ' matches'));
        preview.innerHTML = matches.length
          ? DataTools.renderMatches(matches)
          : '<p class="j-empty">No matches for <code>' + escapeHtml(q) + '</code>.</p>';
        return;
      }
      setCount('');
      preview.innerHTML = DataTools.renderValue(value);
    },
    htmlDocument: (title, body) =>
      '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>' + escapeHtml(title) + '</title>\n' +
      '<style>body{font:14px/1.7 ui-monospace,Menlo,Consolas,monospace;max-width:900px;margin:0 auto;padding:48px 24px}' +
      '.j-row{padding-left:18px;border-left:1px solid #e6e8ec}.j-key{color:#6b3fa0}.j-str{color:#0a7d4f}' +
      '.j-num{color:#0550ae}.j-bool{color:#b7791f}.j-null{color:#8b94a3}.j-punc{color:#8b94a3}' +
      '.j-count{color:#8b94a3;font-size:.85em;padding:0 6px}summary{cursor:pointer}</style>\n' +
      '</head>\n<body>\n' + body + '\n</body>\n</html>\n',
    exporters: {
      json: (a) => {
        const r = parse(a.source);
        if (r.error) return Shell.toast('Can\'t export — not well-formed');
        if (r.empty) return;
        const doc = a.currentDoc();
        Shell.download(Shell.safeFilename(doc && doc.title) + '.json', 'application/json',
          JSON.stringify(asValue(r.doc), null, 2) + '\n');
        Shell.toast('JSON file downloaded');
      }
    }
  });

  if (qInput) {
    let t = null;
    qInput.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => api.render(), 160); });
    qInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { qInput.value = ''; api.render(); qInput.blur(); } });
    $('#q-clear').addEventListener('click', () => { qInput.value = ''; api.render(); qInput.focus(); });
    $('#q-copy').addEventListener('click', async () => {
      if (!lastMatches || !lastMatches.length) return Shell.toast('Nothing to copy — run a query first');
      const payload = lastMatches.length === 1 ? lastMatches[0].value : lastMatches.map((m) => m.value);
      const ok = await Shell.copyText(JSON.stringify(payload, null, 2));
      Shell.toast(ok ? 'Copied ' + lastMatches.length + ' result' + (lastMatches.length === 1 ? '' : 's') : 'Copy failed');
    });
  }

  const btnFormat = $('#btn-format');
  if (btnFormat) btnFormat.addEventListener('click', () => commands.format2(api));

  api.el.preview.addEventListener('click', async (e) => {
    const key = e.target.closest('.j-key[data-path]');
    if (!key) return;
    const ok = await Shell.copyText(key.dataset.path);
    Shell.toast(ok ? 'Copied ' + key.dataset.path : 'Copy failed');
  });
})();
