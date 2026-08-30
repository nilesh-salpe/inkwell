/* ============================================================
   CSV tool — parse, check, view as a table and convert to JSON.
   ============================================================ */
(function () {
  'use strict';

  const $ = Shell.$;
  const escapeHtml = Shell.escapeHtml;
  const MAX_ROWS = 5000;

  const dInput = $('#c-delim');
  const hInput = $('#c-header');
  const fInput = $('#c-filter');
  const fCount = $('#c-count');

  const NAMES = { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' };

  /* ---------- parsing ---------- */
  function sniff(text) {
    const line = text.split('\n').slice(0, 5).join('\n');
    let best = ',', bestN = 0;
    Object.keys(NAMES).forEach((d) => {
      let n = 0, inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') inQ = !inQ;
        else if (c === d && !inQ) n++;
      }
      if (n > bestN) { bestN = n; best = d; }
    });
    return best;
  }

  function parseCsv(text, delim) {
    const rows = [];
    let row = [], field = '', i = 0, inQ = false, unterminated = false;
    const n = text.length;
    while (i < n) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === delim) { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (inQ) unterminated = true;
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    /* a trailing newline should not create a phantom row */
    while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
    return { rows, unterminated };
  }

  function analyse(src) {
    if (!src.trim()) return { empty: true };
    const delim = (dInput && dInput.value !== 'auto') ? dInput.value : sniff(src);
    const { rows, unterminated } = parseCsv(src, delim);
    if (!rows.length) return { empty: true };

    const hasHeader = !hInput || hInput.checked;
    const header = hasHeader ? rows[0] : rows[0].map((_, i) => 'column_' + (i + 1));
    const body = hasHeader ? rows.slice(1) : rows;
    const width = header.length;

    const ragged = [];
    body.forEach((r, i) => {
      if (r.length !== width) ragged.push({ row: i + (hasHeader ? 2 : 1), got: r.length });
    });

    return { delim, header, body, width, ragged, unterminated, hasHeader };
  }

  const toObjects = (r) => r.body.map((row) => {
    const o = {};
    r.header.forEach((h, i) => { o[h || 'column_' + (i + 1)] = coerce(row[i] == null ? '' : row[i]); });
    return o;
  });

  function coerce(v) {
    if (v === '') return '';
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(v) && v.length < 16) return Number(v);
    return v;
  }

  /* ---------- writing ---------- */
  function quote(v, delim) {
    const s = v == null ? '' : String(v);
    return /["\n\r]/.test(s) || s.indexOf(delim) > -1 ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const toCsv = (header, body, delim) =>
    [header].concat(body).map((r) => r.map((c) => quote(c, delim)).join(delim)).join('\n') + '\n';

  /* ---------- rendering ---------- */
  function tableHtml(r) {
    const filter = fInput ? fInput.value.trim().toLowerCase() : '';
    let body = r.body;
    if (filter) body = body.filter((row) => row.some((c) => String(c).toLowerCase().indexOf(filter) > -1));
    if (fCount) fCount.textContent = filter ? body.length + ' of ' + r.body.length + ' rows' : '';

    const shown = body.slice(0, MAX_ROWS);
    let html = '<div class="csv-wrap"><table class="csv-table"><thead><tr><th class="csv-num"></th>' +
      r.header.map((h) => '<th>' + escapeHtml(h || '') + '</th>').join('') + '</tr></thead><tbody>';
    shown.forEach((row, i) => {
      html += '<tr><td class="csv-num">' + (i + 1) + '</td>';
      for (let c = 0; c < r.width; c++) {
        const v = row[c];
        const missing = v === undefined;
        const numeric = !missing && v !== '' && /^-?\d+(\.\d+)?$/.test(v);
        html += '<td class="' + (missing ? 'csv-missing' : numeric ? 'csv-num-cell' : '') + '">' +
          (missing ? '—' : escapeHtml(v)) + '</td>';
      }
      if (row.length > r.width) html += '<td class="csv-extra">+' + (row.length - r.width) + ' extra</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    if (body.length > MAX_ROWS) {
      html += '<p class="j-empty">Showing the first ' + MAX_ROWS.toLocaleString() +
        ' of ' + body.length.toLocaleString() + ' rows.</p>';
    }
    if (!shown.length) html += '<p class="j-empty">No rows match.</p>';
    return html;
  }

  function warnings(r) {
    let html = '';
    if (r.unterminated) {
      html += '<div class="jwt-warn"><strong>Unterminated quote</strong> — a quoted field is never closed, so ' +
        'everything after it was read as one value.</div>';
    }
    if (r.ragged.length) {
      const list = r.ragged.slice(0, 5).map((x) => 'row ' + x.row + ' has ' + x.got).join(', ');
      html += '<div class="csv-note"><strong>Ragged rows.</strong> The header has ' + r.width +
        ' columns, but ' + r.ragged.length + ' row' + (r.ragged.length === 1 ? '' : 's') +
        ' differ — ' + escapeHtml(list) + (r.ragged.length > 5 ? ', …' : '') + '.</div>';
    }
    return html;
  }

  /* ---------- commands ---------- */
  const commands = {
    toJson: (a) => {
      const r = analyse(a.source);
      if (r.empty) return;
      a.replaceAllText(JSON.stringify(toObjects(r), null, 2) + '\n');
      Shell.toast('Converted to JSON — undo (Ctrl+Z) to go back');
    },
    fromJson: (a) => {
      let value;
      try { value = JSON.parse(a.source); }
      catch (e) { return Shell.toast('The editor does not contain valid JSON'); }
      if (!Array.isArray(value)) return Shell.toast('Expected a JSON array of objects');
      const keys = [];
      value.forEach((o) => Object.keys(o || {}).forEach((k) => { if (keys.indexOf(k) === -1) keys.push(k); }));
      const delim = (dInput && dInput.value !== 'auto') ? dInput.value : ',';
      const body = value.map((o) => keys.map((k) => (o && o[k] != null ? String(o[k]) : '')));
      a.replaceAllText(toCsv(keys, body, delim));
      Shell.toast('Converted from JSON');
    },
    tidy: (a) => {
      const r = analyse(a.source);
      if (r.empty) return;
      const body = r.body.map((row) => {
        const out = row.slice(0, r.width);
        while (out.length < r.width) out.push('');
        return out.map((c) => c.trim());
      });
      a.replaceAllText(toCsv(r.header.map((h) => h.trim()), body, r.delim));
      Shell.toast('Tidied — trimmed cells and padded every row to ' + r.width + ' columns');
    }
  };

  /* ---------- status ---------- */
  function setStatus(src) {
    const badge = $('#st-valid');
    const size = new Blob([src]).size;
    $('#st-size').textContent = size < 1024 ? size + ' B' : (size / 1024).toFixed(1) + ' KB';
    const r = analyse(src);
    if (r.empty) {
      badge.textContent = 'Empty'; badge.className = 'badge';
      $('#st-shape').textContent = '—'; $('#st-delim').textContent = '—';
      return;
    }
    $('#st-delim').textContent = NAMES[r.delim] || 'custom';
    $('#st-shape').textContent = r.body.length.toLocaleString() + ' rows × ' + r.width + ' cols';
    if (r.unterminated) { badge.textContent = 'Unterminated quote'; badge.className = 'badge is-bad'; return; }
    if (r.ragged.length) { badge.textContent = 'Ragged'; badge.className = 'badge is-warn'; return; }
    badge.textContent = 'Valid'; badge.className = 'badge is-ok';
  }

  /* ---------- go ---------- */
  const api = Shell.create({
    tool: 'csv',
    ext: 'csv',
    mime: 'text/csv',
    blank: 'name,role\n',
    sampleTitle: 'Example table',
    swPath: '../sw.js',
    commands: commands,
    shortcuts: { j: (a) => commands.toJson(a) },
    deriveTitle: (content) => {
      const r = analyse(content);
      if (r.empty) return 'Untitled';
      return r.header.slice(0, 3).filter(Boolean).join(', ').slice(0, 60) || 'Untitled';
    },
    docSummary: (content) => {
      const r = analyse(content);
      if (r.empty) return 'empty';
      return r.body.length + ' rows × ' + r.width + ' cols';
    },
    updateStatus: setStatus,
    render: (src, preview) => {
      const r = analyse(src);
      if (r.empty) {
        preview.innerHTML = '<p class="j-empty">Paste or type CSV on the left.</p>';
        if (fCount) fCount.textContent = '';
        return;
      }
      preview.innerHTML = warnings(r) + tableHtml(r);
    },
    htmlDocument: (title, body) =>
      '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>' + escapeHtml(title) + '</title>\n' +
      '<style>body{font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;' +
      'max-width:1100px;margin:0 auto;padding:48px 24px}table{border-collapse:collapse;font-size:13px}' +
      'th,td{border:1px solid #d9dce2;padding:6px 10px;text-align:left}th{background:#f2f3f6}' +
      'tbody tr:nth-child(even){background:#fafbfc}.csv-num{color:#8b94a3;text-align:right}' +
      '.csv-num-cell{text-align:right;font-variant-numeric:tabular-nums}</style>\n' +
      '</head>\n<body>\n' + body + '\n</body>\n</html>\n',
    exporters: {
      json: (a) => {
        const r = analyse(a.source);
        if (r.empty) return;
        const doc = a.currentDoc();
        Shell.download(Shell.safeFilename(doc && doc.title) + '.json', 'application/json',
          JSON.stringify(toObjects(r), null, 2) + '\n');
        Shell.toast('JSON file downloaded');
      },
      'copy-json': async (a) => {
        const r = analyse(a.source);
        if (r.empty) return;
        const ok = await Shell.copyText(JSON.stringify(toObjects(r), null, 2));
        Shell.toast(ok ? 'Copied as JSON' : 'Copy failed');
      }
    }
  });

  [dInput, hInput].forEach((node) => {
    if (node) node.addEventListener('change', () => { api.render(); api.el.editor.dispatchEvent(new Event('input', { bubbles: true })); });
  });
  if (fInput) {
    let t = null;
    fInput.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => api.render(), 140); });
    fInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { fInput.value = ''; api.render(); } });
  }
  const btnJson = $('#btn-tojson');
  if (btnJson) btnJson.addEventListener('click', () => commands.toJson(api));
})();
