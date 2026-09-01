/* ============================================================
   Text utilities — case conversion, line operations, statistics.
   ============================================================ */
(function () {
  'use strict';

  const $ = Shell.$;
  const escapeHtml = Shell.escapeHtml;

  /* ---------- word splitting, the basis of every case conversion ---------- */
  function words(s) {
    return s
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')      /* camelCase boundary */
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')   /* HTTPServer boundary */
      .split(/[^A-Za-z0-9À-ÿ]+/)
      .filter(Boolean);
  }

  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

  const CASES = {
    upper:    (s) => s.toUpperCase(),
    lower:    (s) => s.toLowerCase(),
    title:    (s) => s.replace(/\S+/g, (w) => cap(w)),
    sentence: (s) => s.toLowerCase().replace(/(^\s*\w|[.!?]\s+\w)/g, (c) => c.toUpperCase()),
    camel:    (s) => words(s).map((w, i) => i ? cap(w) : w.toLowerCase()).join(''),
    pascal:   (s) => words(s).map(cap).join(''),
    snake:    (s) => words(s).map((w) => w.toLowerCase()).join('_'),
    constant: (s) => words(s).map((w) => w.toUpperCase()).join('_'),
    kebab:    (s) => words(s).map((w) => w.toLowerCase()).join('-'),
    slug:     (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
                      .toLowerCase().trim()
                      .replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-')
                      .replace(/^-|-$/g, '')
  };

  const lines = (s) => s.split('\n');
  const put = (a, arr) => a.replaceAllText(arr.join('\n') + (arr.length ? '\n' : ''));

  const LINE_OPS = {
    sortAsc:  (a) => put(a, lines(a.source).sort((x, y) => x.localeCompare(y, undefined, { numeric: true }))),
    sortDesc: (a) => put(a, lines(a.source).sort((x, y) => y.localeCompare(x, undefined, { numeric: true }))),
    sortLen:  (a) => put(a, lines(a.source).sort((x, y) => x.length - y.length)),
    reverse:  (a) => put(a, lines(a.source).reverse()),
    dedupe:   (a) => {
      const seen = Object.create(null), out = [];
      lines(a.source).forEach((l) => { if (!(l in seen)) { seen[l] = 1; out.push(l); } });
      const removed = lines(a.source).length - out.length;
      put(a, out);
      Shell.toast(removed ? 'Removed ' + removed + ' duplicate line' + (removed === 1 ? '' : 's') : 'No duplicates');
    },
    blanks:   (a) => put(a, lines(a.source).filter((l) => l.trim())),
    trim:     (a) => put(a, lines(a.source).map((l) => l.trim())),
    number:   (a) => {
      const ls = lines(a.source).filter((l, i, arr) => i < arr.length - 1 || l.trim());
      const pad = String(ls.length).length;
      put(a, ls.map((l, i) => String(i + 1).padStart(pad, ' ') + '. ' + l));
    },
    join:     (a) => a.replaceAllText(lines(a.source).filter((l) => l.trim()).join(' ') + '\n'),
    collapse: (a) => a.replaceAllText(a.source.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n')),
    untab:    (a) => a.replaceAllText(a.source.replace(/\t/g, '  '))
  };

  const commands = Object.assign({}, LINE_OPS, {
    clear: (a) => { a.replaceAllText(''); a.el.editor.focus(); }
  });
  Object.keys(CASES).forEach((k) => { commands[k] = (a) => a.replaceAllText(CASES[k](a.source)); });

  /* ---------- statistics ---------- */
  const STOP = new Set(('the a an and or but if of to in on at for with is are was were be been it its this that as by from '
    + 'not no so than then there their they them we you your our i he she his her have has had do does did will would can could').split(' '));

  function stats(v) {
    const chars = v.length;
    const noSpace = v.replace(/\s/g, '').length;
    const wordList = v.match(/[\wÀ-ÿ'’-]+/g) || [];
    const ls = v === '' ? [] : v.split('\n');
    const paragraphs = v.split(/\n\s*\n/).filter((p) => p.trim()).length;
    const sentences = (v.match(/[^.!?]+[.!?]+(\s|$)/g) || []).filter((s) => s.trim()).length;
    const longest = ls.reduce((m, l) => Math.max(m, l.length), 0);
    const avg = wordList.length ? (wordList.join('').length / wordList.length) : 0;
    return {
      chars, noSpace, words: wordList.length, lines: ls.length, paragraphs, sentences,
      longest, avg, bytes: new Blob([v]).size,
      minutes: Math.max(1, Math.round(wordList.length / 220)),
      speaking: Math.max(1, Math.round(wordList.length / 130)),
      freq: frequency(wordList)
    };
  }

  function frequency(wordList) {
    const counts = Object.create(null);
    wordList.forEach((w) => {
      const k = w.toLowerCase();
      if (k.length < 3 || STOP.has(k)) return;
      counts[k] = (counts[k] || 0) + 1;
    });
    return Object.keys(counts).map((k) => [k, counts[k]])
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12);
  }

  const row = (k, v) => '<tr><td>' + escapeHtml(k) + '</td><td>' + escapeHtml(String(v)) + '</td></tr>';

  /* ---------- go ---------- */
  const api = Shell.create({
    tool: 'text',
    ext: 'txt',
    mime: 'text/plain',
    blank: '',
    sampleTitle: 'Example text',
    swPath: '../sw.js',
    commands: commands,
    shortcuts: {},
    deriveTitle: (c) => c.trim().split('\n')[0].slice(0, 50) || 'Untitled',
    docSummary: (c) => (c.match(/[\wÀ-ÿ'’-]+/g) || []).length + ' words',
    updateStatus: (v) => {
      const s = stats(v);
      $('#st-words').textContent = s.words.toLocaleString() + (s.words === 1 ? ' word' : ' words');
      $('#st-chars').textContent = s.chars.toLocaleString() + ' characters';
      $('#st-lines').textContent = s.lines.toLocaleString() + (s.lines === 1 ? ' line' : ' lines');
    },
    render: (src, preview) => {
      if (!src) { preview.innerHTML = '<p class="j-empty">Type or paste text on the left.</p>'; return; }
      const s = stats(src);
      let html = '<section class="esc-card"><div class="esc-head"><span class="esc-label">Counts</span>' +
        '<button class="mini stats-copy" data-tip="Copy every statistic" aria-label="Copy every statistic">Copy</button></div>' +
        '<table class="jwt-claims"><tbody>' +
        row('Characters', s.chars.toLocaleString()) +
        row('Characters (no spaces)', s.noSpace.toLocaleString()) +
        row('Words', s.words.toLocaleString()) +
        row('Lines', s.lines.toLocaleString()) +
        row('Sentences', s.sentences.toLocaleString()) +
        row('Paragraphs', s.paragraphs.toLocaleString()) +
        row('Bytes (UTF-8)', s.bytes.toLocaleString()) +
        '</tbody></table></section>';

      html += '<section class="esc-card"><div class="esc-head"><span class="esc-label">Readability</span></div>' +
        '<table class="jwt-claims"><tbody>' +
        row('Reading time', '~' + s.minutes + ' min at 220 wpm') +
        row('Speaking time', '~' + s.speaking + ' min at 130 wpm') +
        row('Average word length', s.avg.toFixed(1) + ' characters') +
        row('Longest line', s.longest.toLocaleString() + ' characters') +
        '</tbody></table></section>';

      if (s.freq.length) {
        const max = s.freq[0][1];
        html += '<section class="esc-card"><div class="esc-head"><span class="esc-label">Most used words</span></div>' +
          '<p class="esc-note">Common filler words are ignored.</p><div class="freq">' +
          s.freq.map(([w, n]) =>
            '<div class="freq-row"><span class="freq-word">' + escapeHtml(w) + '</span>' +
            '<span class="freq-bar"><i style="width:' + Math.round(n / max * 100) + '%"></i></span>' +
            '<span class="freq-n">' + n + '</span></div>').join('') +
          '</div></section>';
      }
      preview.innerHTML = html;
    },
    htmlDocument: (title, body) =>
      '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>' + escapeHtml(title) + '</title>\n' +
      '<style>body{font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:700px;margin:0 auto;padding:48px 24px}' +
      'table{border-collapse:collapse;margin-bottom:24px}td{border-bottom:1px solid #eee;padding:5px 14px 5px 0}</style>\n' +
      '</head>\n<body>\n' + body + '\n</body>\n</html>\n'
  });

  api.el.preview.addEventListener('click', async (e) => {
    if (!e.target.closest('.stats-copy')) return;
    const lines = Shell.$$('#preview .jwt-claims tr').map((tr) => {
      const td = tr.querySelectorAll('td');
      return td[0].textContent + ': ' + td[1].textContent;
    });
    Shell.toast(await Shell.copyText(lines.join('\n')) ? 'Statistics copied' : 'Copy failed');
  });

  /* the chip row applies an operation to the whole document */
  Shell.$$('.chip').forEach((b) => b.addEventListener('click', () => {
    const fn = commands[b.dataset.cmd];
    if (fn) fn(api);
  }));
})();
