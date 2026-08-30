/* ============================================================
   Regular expression tester.
   The pattern runs in a worker with a timeout, so a
   catastrophically backtracking expression cannot lock the page.
   ============================================================ */
(function () {
  'use strict';

  const $ = Shell.$;
  const escapeHtml = Shell.escapeHtml;
  const MAX_MATCHES = 1000;
  const TIMEOUT = 1500;

  const els = {
    pattern: $('#r-pattern'), replace: $('#r-replace'), status: $('#r-status'),
    flags: Shell.$$('.r-flag')
  };

  const flags = () => els.flags.filter((f) => f.checked).map((f) => f.value).join('');

  /* ---------- worker with a deadline ---------- */
  let worker = null, timer = null, seq = 0;

  function run(pattern, flagStr, text) {
    return new Promise((resolve) => {
      const mine = ++seq;
      if (worker) { worker.terminate(); worker = null; }
      clearTimeout(timer);
      try { worker = new Worker('../assets/js/regex-worker.js'); }
      catch (e) { resolve({ ok: false, error: 'Could not start the matcher' }); return; }

      worker.onmessage = (e) => {
        if (mine !== seq) return;
        clearTimeout(timer);
        worker.terminate(); worker = null;
        resolve(e.data);
      };
      worker.onerror = () => {
        clearTimeout(timer);
        resolve({ ok: false, error: 'The matcher failed' });
      };
      timer = setTimeout(() => {
        if (worker) { worker.terminate(); worker = null; }
        resolve({ ok: false, error: 'timeout' });
      }, TIMEOUT);

      worker.postMessage({ pattern, flags: flagStr, text, limit: MAX_MATCHES });
    });
  }

  /* ---------- rendering ---------- */
  function highlight(text, matches) {
    let out = '', at = 0;
    matches.forEach((m, i) => {
      if (m.index < at) return;                   /* overlapping, skip */
      out += escapeHtml(text.slice(at, m.index));
      out += '<mark class="r-hit" data-i="' + i + '">' +
        (m.match === '' ? '<span class="r-empty"></span>' : escapeHtml(m.match)) + '</mark>';
      at = m.index + m.match.length;
    });
    out += escapeHtml(text.slice(at));
    return out;
  }

  function matchList(matches, truncated) {
    if (!matches.length) return '<p class="j-empty">No matches.</p>';
    let html = '<div class="r-list">';
    matches.slice(0, 100).forEach((m, i) => {
      html += '<div class="r-item"><span class="r-num">' + (i + 1) + '</span>' +
        '<code class="r-text">' + (m.match === '' ? '<em>empty match</em>' : escapeHtml(m.match)) + '</code>' +
        '<span class="r-at">at ' + m.index + '</span></div>';
      const groups = m.groups.filter((g) => g !== undefined);
      if (m.groups.length) {
        html += '<div class="r-groups">' + m.groups.map((g, gi) =>
          '<div class="r-group"><span class="r-gname">' + (gi + 1) + '</span><code>' +
          (g === undefined ? '<em>no match</em>' : escapeHtml(g)) + '</code></div>').join('') + '</div>';
      }
      if (m.named) {
        html += '<div class="r-groups">' + Object.keys(m.named).map((k) =>
          '<div class="r-group"><span class="r-gname">' + escapeHtml(k) + '</span><code>' +
          (m.named[k] === undefined ? '<em>no match</em>' : escapeHtml(m.named[k])) + '</code></div>').join('') + '</div>';
      }
    });
    html += '</div>';
    if (matches.length > 100) html += '<p class="j-empty">Showing 100 of ' + matches.length + ' matches.</p>';
    if (truncated) html += '<p class="j-empty">Stopped at ' + MAX_MATCHES + ' matches.</p>';
    return html;
  }

  function applyReplace(text, matches, template) {
    let out = '', at = 0;
    matches.forEach((m) => {
      if (m.index < at) return;
      out += text.slice(at, m.index);
      out += template.replace(/\$(\d+|&|<([^>]+)>)/g, (whole, ref, name) => {
        if (ref === '&') return m.match;
        if (name) return (m.named && m.named[name] != null) ? m.named[name] : '';
        const g = m.groups[parseInt(ref, 10) - 1];
        return g == null ? '' : g;
      });
      at = m.index + m.match.length;
    });
    return out + text.slice(at);
  }

  function setStatus(state, text) {
    if (!els.status) return;
    els.status.textContent = text;
    els.status.className = 'v-status' + (state ? ' is-' + state : '');
  }

  /* ---------- go ---------- */
  const api = Shell.create({
    tool: 'regex',
    ext: 'txt',
    mime: 'text/plain',
    blank: '',
    sampleTitle: 'Example text',
    swPath: '../sw.js',
    commands: { clear: (a) => { a.replaceAllText(''); a.el.editor.focus(); } },
    shortcuts: {},
    deriveTitle: () => 'Regex test',
    docSummary: (c) => c.split('\n').length + ' lines',
    updateStatus: (v) => {
      $('#st-chars').textContent = v.length.toLocaleString() + ' characters';
    },
    render: (src, preview) => {
      const pattern = els.pattern ? els.pattern.value : '';
      if (!pattern) {
        preview.innerHTML = '<p class="j-empty">Enter a pattern above. The text on the left is what it runs against.</p>';
        setStatus('', '');
        $('#st-count').textContent = '—';
        return;
      }
      setStatus('', 'matching…');
      run(pattern, flags(), src).then((res) => {
        if (!res.ok) {
          const msg = res.error === 'timeout'
            ? 'This pattern took longer than ' + (TIMEOUT / 1000) + 's on this input and was stopped. ' +
              'Nested quantifiers such as (a+)+ are the usual cause.'
            : res.error;
          preview.innerHTML = DataTools.errorCard(
            res.error === 'timeout' ? 'Stopped — runaway pattern' : 'Invalid pattern', { message: msg });
          setStatus('bad', res.error === 'timeout' ? 'stopped' : 'invalid');
          $('#st-count').textContent = '—';
          return;
        }
        const m = res.matches;
        setStatus(m.length ? 'ok' : 'warn', m.length + (m.length === 1 ? ' match' : ' matches'));
        $('#st-count').textContent = m.length + (m.length === 1 ? ' match' : ' matches');

        let html = '<section class="esc-card"><div class="esc-head"><span class="esc-label">Matches in context</span></div>' +
          '<pre class="r-preview">' + highlight(src, m) + '</pre></section>';

        const template = els.replace ? els.replace.value : '';
        if (template) {
          const replaced = applyReplace(src, m, template);
          html += '<section class="esc-card" data-value="' + escapeHtml(replaced) + '">' +
            '<div class="esc-head"><span class="esc-label">After replacement</span>' +
            '<button class="mini esc-copy" data-tip="Copy the result" aria-label="Copy the result">Copy</button>' +
            '<button class="mini esc-use" data-tip="Put this in the editor" aria-label="Put this in the editor">Use</button>' +
            '</div><pre class="esc-out">' + escapeHtml(replaced) + '</pre></section>';
        }

        html += '<section class="esc-card"><div class="esc-head"><span class="esc-label">' +
          m.length + ' match' + (m.length === 1 ? '' : 'es') + '</span></div>' +
          matchList(m, res.truncated) + '</section>';
        preview.innerHTML = html;
      });
    },
    htmlDocument: (title, body) =>
      '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>' + escapeHtml(title) + '</title>\n' +
      '<style>body{font:14px/1.6 -apple-system,sans-serif;max-width:820px;margin:0 auto;padding:48px 24px}' +
      'pre{background:#f4f5f7;padding:10px;border-radius:8px;white-space:pre-wrap}mark{background:#fde68a}' +
      'button{display:none}</style>\n</head>\n<body>\n' + body + '\n</body>\n</html>\n'
  });

  let t = null;
  const bump = () => { clearTimeout(t); t = setTimeout(() => api.render(), 160); };
  [els.pattern, els.replace].forEach((n) => { if (n) n.addEventListener('input', bump); });
  els.flags.forEach((f) => f.addEventListener('change', bump));

  api.el.preview.addEventListener('click', async (e) => {
    const card = e.target.closest('.esc-card');
    if (!card || !card.dataset.value) return;
    if (e.target.closest('.esc-copy')) Shell.toast(await Shell.copyText(card.dataset.value) ? 'Copied' : 'Copy failed');
    else if (e.target.closest('.esc-use')) api.replaceAllText(card.dataset.value);
  });
})();
