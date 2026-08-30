/* ============================================================
   YAML tool — validate, format and explore.
   Parsing is js-yaml; the tree, statistics and JSONPath engine
   are shared with the JSON page via data-tools.js.
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

  const DUMP = { lineWidth: -1, noRefs: true, quotingType: '"' };

  /* ---------- parsing ---------- */
  function parse(src) {
    if (!src.trim()) return { empty: true };
    if (!window.jsyaml) return { error: { message: 'The YAML parser is still loading — try again in a moment.' } };
    try {
      const docs = [];
      window.jsyaml.loadAll(src, (d) => docs.push(d));
      return { docs: docs.length ? docs : [null] };
    } catch (e) {
      return { error: locate(e, src) };
    }
  }

  /* js-yaml reports a mark with zero-based line and column. */
  function locate(e, src) {
    const mark = e.mark || {};
    const line = typeof mark.line === 'number' ? mark.line + 1 : null;
    const col = typeof mark.column === 'number' ? mark.column + 1 : null;
    return {
      message: (e.reason || e.message || 'Invalid YAML').replace(/\s*$/, ''),
      line: line,
      column: col,
      snippet: line != null ? src.split('\n')[line - 1] : null
    };
  }

  /* The value JSONPath and the statistics run against. */
  const subject = (r) => (r.docs.length === 1 ? r.docs[0] : r.docs);

  /* ---------- transforms ---------- */
  function dumpAll(docs, indent, sortKeys) {
    const opts = Object.assign({}, DUMP, { indent: indent, sortKeys: !!sortKeys });
    return docs.map((d) => window.jsyaml.dump(d, opts)).join('---\n');
  }

  function reformat(api, indent, sortKeys) {
    const r = parse(api.source);
    if (r.error) return Shell.toast('Can\'t format — ' + r.error.message);
    if (r.empty) return;
    api.replaceAllText(dumpAll(r.docs, indent, sortKeys));
    Shell.toast(sortKeys ? 'Formatted, keys sorted A→Z' : 'Formatted with ' + indent + '-space indent');
  }

  const commands = {
    format2: (a) => reformat(a, 2, false),
    format4: (a) => reformat(a, 4, false),
    sort:    (a) => reformat(a, 2, true),
    toJson: (a) => {
      const r = parse(a.source);
      if (r.error) return Shell.toast('Can\'t convert — ' + r.error.message);
      if (r.empty) return;
      a.replaceAllText(JSON.stringify(subject(r), null, 2) + '\n');
      Shell.toast('Converted to JSON — undo (Ctrl+Z) to go back');
    },
    fromJson: (a) => {
      let value;
      try { value = JSON.parse(a.source); }
      catch (e) { return Shell.toast('The editor does not contain valid JSON'); }
      a.replaceAllText(window.jsyaml.dump(value, Object.assign({}, DUMP, { indent: 2 })));
      Shell.toast('Converted from JSON');
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

    if (r.empty) {
      badge.textContent = 'Empty'; badge.className = 'badge';
      $('#st-shape').textContent = '—';
      return;
    }
    if (r.error) {
      badge.textContent = 'Invalid'; badge.className = 'badge is-bad';
      $('#st-shape').textContent = r.error.line != null ? 'Error on line ' + r.error.line : 'Parse error';
      return;
    }
    const s = DataTools.inspect(subject(r));
    badge.textContent = 'Valid'; badge.className = 'badge is-ok';
    $('#st-shape').textContent =
      (r.docs.length > 1 ? r.docs.length + ' documents · ' : '') +
      s.keys.toLocaleString() + ' keys · depth ' + s.depth;
  }

  /* ---------- go ---------- */
  const api = Shell.create({
    tool: 'yaml',
    ext: 'yaml',
    mime: 'text/yaml',
    blank: 'key: value\n',
    sampleTitle: 'Example config',
    swPath: '../sw.js',
    commands: commands,
    shortcuts: {
      b: (a) => commands.format2(a),
      j: (a) => commands.toJson(a)
    },
    deriveTitle: (content) => {
      const r = parse(content);
      if (r.error || r.empty) return 'Untitled';
      const v = subject(r);
      if (Array.isArray(v)) return v.length + '-item list';
      if (v && typeof v === 'object') {
        const k = Object.keys(v);
        return k.length ? k.slice(0, 3).join(', ').slice(0, 60) : 'Empty document';
      }
      return 'Untitled';
    },
    docSummary: (content) => {
      const r = parse(content);
      if (r.error) return 'invalid';
      if (r.empty) return 'empty';
      const s = DataTools.inspect(subject(r));
      return s.keys + ' keys · depth ' + s.depth;
    },
    updateStatus: setStatus,
    render: (src, preview) => {
      const r = parse(src);
      lastMatches = null;
      if (r.empty) { preview.innerHTML = '<p class="j-empty">Paste or type YAML on the left.</p>'; setCount(''); return; }
      if (r.error) { preview.innerHTML = DataTools.errorCard('Invalid YAML', r.error); setCount(''); return; }

      const q = qInput ? qInput.value.trim() : '';
      if (q) {
        let matches;
        try { matches = DataTools.query(subject(r), q); }
        catch (e) {
          preview.innerHTML = DataTools.errorCard('Bad JSONPath', { message: e.message });
          setCount('error');
          return;
        }
        lastMatches = matches;
        setCount(matches.length + (matches.length === 1 ? ' match' : ' matches'));
        preview.innerHTML = matches.length
          ? DataTools.renderMatches(matches)
          : '<p class="j-empty">No matches for <code>' + escapeHtml(q) + '</code>.</p>';
        return;
      }

      setCount('');
      if (r.docs.length === 1) { preview.innerHTML = DataTools.renderValue(r.docs[0]); return; }
      preview.innerHTML = r.docs.map((d, i) =>
        '<div class="q-result"><div class="q-path">Document ' + (i + 1) + '</div>' +
        DataTools.renderValue(d) + '</div>'
      ).join('');
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
        '.q-path{color:#4f46e5;margin:16px 0 6px}',
        'summary{cursor:pointer}details{margin:0}'
      ].join('') + '</style>\n</head>\n<body>\n<main class="wrap">\n' + body + '\n</main>\n</body>\n</html>\n',
    exporters: {
      json: (a) => {
        const r = parse(a.source);
        if (r.error) return Shell.toast('Can\'t export — invalid YAML');
        if (r.empty) return;
        const doc = a.currentDoc();
        Shell.download(Shell.safeFilename(doc && doc.title) + '.json', 'application/json',
          JSON.stringify(subject(r), null, 2) + '\n');
        Shell.toast('JSON file downloaded');
      },
      'copy-json': async (a) => {
        const r = parse(a.source);
        if (r.error) return Shell.toast('Can\'t copy — invalid YAML');
        if (r.empty) return;
        const ok = await Shell.copyText(JSON.stringify(subject(r), null, 2));
        Shell.toast(ok ? 'Copied as JSON' : 'Copy failed');
      }
    }
  });

  /* ---------- JSONPath box ---------- */
  if (qInput) {
    let t = null;
    qInput.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => api.render(), 160); });
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
  }

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
