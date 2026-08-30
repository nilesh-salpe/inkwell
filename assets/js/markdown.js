/* ============================================================
   Markdown tool — parsing, preview enhancement and the
   formatting toolbar. The chrome around it lives in shell.js.
   ============================================================ */
(function () {
  'use strict';

  const $  = Shell.$;
  const $$ = Shell.$$;
  const escapeHtml = Shell.escapeHtml;

  marked.use({ gfm: true, breaks: false, pedantic: false });

  /* ---------- source rewrites that must skip fenced code ---------- */
  function outsideFences(src, fn) {
    const lines = src.split('\n');
    const out = [];
    let buf = [], fence = null;
    const flush = () => { if (buf.length) { out.push(fn(buf.join('\n'))); buf = []; } };
    for (const line of lines) {
      const m = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (fence) {
        if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
        out.push(line);
      } else if (m) {
        flush(); fence = m[1]; out.push(line);
      } else buf.push(line);
    }
    flush();
    return out.join('\n');
  }

  /* ---------- footnotes ---------- */
  function extractFootnotes(src) {
    const defs = new Map();
    const lines = src.split('\n');
    let fence = null, i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const f = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (fence) { if (f && f[1][0] === fence[0]) fence = null; i++; continue; }
      if (f) { fence = f[1]; i++; continue; }
      const m = line.match(/^\[\^([^\]\s]+)\]:[ \t]*(.*)$/);
      if (m) {
        const body = [m[2]];
        lines[i] = '';
        let j = i + 1;
        while (j < lines.length && (/^\s{2,}\S/.test(lines[j]) || (lines[j].trim() === '' && /^\s{2,}\S/.test(lines[j + 1] || '')))) {
          body.push(lines[j].replace(/^\s{2,}/, ''));
          lines[j] = '';
          j++;
        }
        defs.set(m[1], body.join('\n').trim());
        i = j;
        continue;
      }
      i++;
    }
    return { text: lines.join('\n'), defs: defs };
  }

  function applyFootnoteRefs(text, defs, used) {
    if (!defs.size) return text;
    return outsideFences(text, (chunk) => chunk.replace(/\[\^([^\]\s]+)\]/g, (whole, id) => {
      if (!defs.has(id)) return whole;
      let n = used.indexOf(id);
      if (n === -1) { used.push(id); n = used.length - 1; }
      return '<sup class="fn-ref" id="fnref-' + escapeHtml(id) + '"><a href="#fn-' +
        escapeHtml(id) + '" title="Footnote ' + (n + 1) + '">' + (n + 1) + '</a></sup>';
    }));
  }

  function footnotesHtml(defs, used) {
    if (!used.length) return '';
    let html = '<section class="footnotes"><h2 class="footnotes-heading">Footnotes</h2><ol>';
    used.forEach((id) => {
      let body = marked.parse(defs.get(id) || '');
      body = body.replace(/<\/p>\s*$/, ' <a href="#fnref-' + escapeHtml(id) + '" class="fn-back" title="Back to text">↩</a></p>');
      html += '<li id="fn-' + escapeHtml(id) + '">' + body + '</li>';
    });
    return html + '</ol></section>';
  }

  /* Render block by block so every top-level element carries its source line. */
  function markdownToHtml(src) {
    const extracted = extractFootnotes(src);
    const used = [];
    const text = applyFootnoteRefs(extracted.text, extracted.defs, used);

    let tokens;
    try { tokens = marked.lexer(text); }
    catch (e) { return '<p class="md-error">Parse error: ' + escapeHtml(e.message) + '</p>'; }

    let line = 0, html = '';
    for (const tok of tokens) {
      const start = line;
      const nl = tok.raw ? tok.raw.match(/\n/g) : null;
      line += nl ? nl.length : 0;
      if (tok.type === 'space') continue;
      let chunk;
      try {
        const arr = [tok];
        arr.links = tokens.links || {};
        chunk = marked.parser(arr);
      } catch (e) {
        chunk = '<p class="md-error">' + escapeHtml(e.message) + '</p>';
      }
      html += chunk.replace(/^(\s*<[a-zA-Z][\w-]*)/, '$1 data-line="' + start + '"');
    }
    html += footnotesHtml(extracted.defs, used);

    return DOMPurify.sanitize(html, {
      ADD_TAGS: ['details', 'summary'],
      ADD_ATTR: ['target', 'data-line', 'align', 'checked', 'disabled']
    });
  }

  /* ---------- preview enhancement ---------- */
  const CALLOUTS = {
    NOTE:      { cls: 'callout-note',      label: 'Note',      icon: 'ℹ️' },
    TIP:       { cls: 'callout-tip',       label: 'Tip',       icon: '💡' },
    IMPORTANT: { cls: 'callout-important', label: 'Important', icon: '❗' },
    WARNING:   { cls: 'callout-warning',   label: 'Warning',   icon: '⚠️' },
    CAUTION:   { cls: 'callout-caution',   label: 'Caution',   icon: '🛑' }
  };

  const mermaidCache = new Map();
  let mermaidReady = false, katexReady = false;

  const slugify = (s) => s.toLowerCase().trim()
    .replace(/[^\w\sÀ-￿-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-') || 'section';

  function enhance(root, api) {
    const seen = Object.create(null);
    const heads = $$('h1,h2,h3,h4,h5,h6', root);
    heads.forEach((h) => {
      const base = slugify(h.textContent);
      seen[base] = (seen[base] || 0) + 1;
      h.id = seen[base] > 1 ? base + '-' + seen[base] : base;
      const a = document.createElement('a');
      a.className = 'anchor'; a.href = '#' + h.id; a.textContent = '#';
      a.setAttribute('aria-hidden', 'true');
      h.appendChild(a);
    });
    buildOutline(heads.filter((h) => !h.closest('.footnotes')), api);

    $$('blockquote', root).forEach((bq) => {
      const p = bq.firstElementChild;
      if (!p || p.tagName !== 'P') return;
      const m = p.textContent.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i);
      if (!m) return;
      const meta = CALLOUTS[m[1].toUpperCase()];
      const div = document.createElement('div');
      div.className = 'callout ' + meta.cls;
      if (bq.dataset.line) div.dataset.line = bq.dataset.line;
      const title = document.createElement('div');
      title.className = 'callout-title';
      title.textContent = meta.icon + ' ' + meta.label;
      p.innerHTML = p.innerHTML.replace(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(<br\s*\/?>)?\s*/i, '');
      div.appendChild(title);
      while (bq.firstChild) div.appendChild(bq.firstChild);
      if (!p.textContent.trim() && !p.querySelector('img,code')) p.remove();
      bq.replaceWith(div);
    });

    $$('p', root).forEach((p) => {
      const t = p.textContent.trim();
      if (t === '\\pagebreak' || t === '\\newpage') {
        const hr = document.createElement('div');
        hr.className = 'pagebreak';
        if (p.dataset.line) hr.dataset.line = p.dataset.line;
        p.replaceWith(hr);
      }
    });

    let taskIndex = 0;
    $$('li', root).forEach((li) => {
      const box = li.querySelector(':scope > input[type="checkbox"]');
      if (!box) return;
      li.classList.add('task-list-item');
      li.classList.toggle('is-checked', box.checked);
      box.disabled = false;
      box.dataset.task = String(taskIndex++);
    });

    const mermaidNodes = [];
    $$('pre > code', root).forEach((code) => {
      const pre = code.parentElement;
      const langMatch = (code.className || '').match(/language-([\w+#-]+)/i);
      const lang = langMatch ? langMatch[1].toLowerCase() : '';

      if (lang === 'mermaid') {
        const src = code.textContent;
        const holder = document.createElement('div');
        holder.className = 'mermaid';
        if (pre.dataset.line) holder.dataset.line = pre.dataset.line;
        const cached = mermaidCache.get(src);
        if (cached) { holder.innerHTML = cached; holder.dataset.done = '1'; }
        else { holder.textContent = src; mermaidNodes.push(holder); }
        pre.replaceWith(holder);
        return;
      }

      if (lang && window.hljs && hljs.getLanguage(lang)) {
        try { hljs.highlightElement(code); } catch (e) { /* ignore */ }
      } else if (window.hljs && !lang && code.textContent.length < 4000) {
        try {
          const res = hljs.highlightAuto(code.textContent);
          if (res.relevance > 8) { code.innerHTML = res.value; code.classList.add('hljs'); }
        } catch (e) { /* ignore */ }
      }

      const btn = document.createElement('button');
      btn.className = 'code-copy'; btn.type = 'button'; btn.textContent = 'Copy';
      btn.addEventListener('click', async () => {
        const ok = await Shell.copyText(code.textContent);
        btn.textContent = ok ? 'Copied' : 'Failed';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1400);
      });
      pre.appendChild(btn);
    });

    $$('a[href^="http"]', root).forEach((a) => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });

    if (mermaidNodes.length) renderMermaid(mermaidNodes, api);
    if (/[$\\]/.test(root.textContent)) renderMath(root);
  }

  function renderMermaid(nodes, api) {
    Shell.loadScript('https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js')
      .then(() => {
        if (!mermaidReady) {
          window.mermaid.initialize({
            startOnLoad: false, securityLevel: 'strict',
            theme: Shell.effectiveTheme() === 'dark' ? 'dark' : 'default',
            fontFamily: 'inherit'
          });
          mermaidReady = true;
        }
        const sources = nodes.map((n) => n.textContent);
        return window.mermaid.run({ nodes: nodes, suppressErrors: true }).then(() => {
          nodes.forEach((n, i) => { if (n.querySelector('svg')) mermaidCache.set(sources[i], n.innerHTML); });
        });
      })
      .catch(() => nodes.forEach((n) => { n.innerHTML = '<span class="md-error">Diagram engine unavailable (offline?)</span>'; }));
  }

  function renderMath(root) {
    const go = () => {
      try {
        window.renderMathInElement(root, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '\\[', right: '\\]', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\(', right: '\\)', display: false }
          ],
          throwOnError: false,
          ignoredClasses: ['mermaid']
        });
      } catch (e) { /* ignore */ }
    };
    if (katexReady) return go();
    Shell.loadScript('https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js')
      .then(() => Shell.loadScript('https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js'))
      .then(() => { katexReady = true; go(); })
      .catch(() => { /* math stays as plain text */ });
  }

  function buildOutline(heads, api) {
    const list = $('#outline');
    if (!list) return;
    list.innerHTML = '';
    if (!heads.length) {
      list.innerHTML = '<li class="outline-empty">Headings you add will appear here.</li>';
      return;
    }
    const frag = document.createDocumentFragment();
    heads.forEach((h) => {
      const li = document.createElement('li');
      li.dataset.lvl = h.tagName[1];
      const a = document.createElement('a');
      a.href = '#' + h.id;
      a.textContent = h.textContent.replace(/#$/, '').trim();
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        h.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const ln = Number(h.dataset.line);
        if (!isNaN(ln)) api.scrollEditorToLine(ln);
      });
      li.appendChild(a);
      frag.appendChild(li);
    });
    list.appendChild(frag);
  }

  /* ---------- standalone HTML export ---------- */
  const EXPORT_CSS = [
    ':root{--fg:#1a1d23;--dim:#5c6472;--border:#e2e5ea;--code:#f3f4f7;--accent:#4f46e5}',
    '*{box-sizing:border-box}',
    'body{margin:0;background:#fff;color:var(--fg);font:16px/1.72 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif}',
    '.wrap{max-width:760px;margin:0 auto;padding:56px 28px 96px}',
    'h1,h2,h3,h4,h5,h6{line-height:1.28;font-weight:680;letter-spacing:-.015em;margin:1.8em 0 .6em}',
    'h1{font-size:2em;margin-top:0;padding-bottom:.3em;border-bottom:1px solid var(--border)}',
    'h2{font-size:1.5em;padding-bottom:.28em;border-bottom:1px solid #edeff3}',
    'h3{font-size:1.24em}p{margin:0 0 1.05em}',
    'a{color:var(--accent);text-decoration:none;border-bottom:1px solid rgba(79,70,229,.35)}',
    'ul,ol{padding-left:1.6em;margin:0 0 1.05em}li{margin:.28em 0}',
    'blockquote{margin:0 0 1.05em;padding:.1em 0 .1em 1.1em;border-left:3px solid var(--border);color:var(--dim)}',
    'code{font:.875em ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--code);border:1px solid #edeff3;border-radius:5px;padding:.12em .38em}',
    'pre{background:var(--code);border:1px solid #edeff3;border-radius:10px;padding:14px 16px;overflow:auto;font-size:13.5px;line-height:1.6}',
    'pre code{background:none;border:0;padding:0}',
    'table{border-collapse:collapse;margin:0 0 1.15em;display:block;overflow-x:auto;width:max-content;max-width:100%}',
    'th,td{border:1px solid var(--border);padding:7px 12px}th{background:#f3f4f7;text-align:left}',
    'tbody tr:nth-child(even){background:#fafbfc}',
    'hr{border:0;border-top:1px solid var(--border);margin:2.2em 0}',
    'img{max-width:100%;border-radius:8px}',
    '.task-list-item{list-style:none;margin-left:-1.35em}.task-list-item input{margin-right:.5em}',
    '.callout{margin:0 0 1.15em;padding:12px 16px;border:1px solid var(--border);border-left-width:3px;border-radius:10px;background:#f7f8fa}',
    '.callout-title{font-weight:650;margin-bottom:.35em}',
    '.callout-note{border-left-color:#3b82f6}.callout-tip{border-left-color:#17915c}',
    '.callout-important{border-left-color:#4f46e5}.callout-warning{border-left-color:#b7791f}.callout-caution{border-left-color:#d64545}',
    '.mermaid{text-align:center}.footnotes{margin-top:2.5em;padding-top:1em;border-top:1px solid var(--border);font-size:.9em;color:var(--dim)}',
    '.anchor,.code-copy{display:none}.pagebreak{break-after:page}',
    '@media print{.wrap{padding:0;max-width:none}a{color:#2a3a8f}}'
  ].join('');

  /* ---------- toolbar ---------- */
  const commands = {
    bold:   (a) => a.surround('**', '**', 'bold text'),
    italic: (a) => a.surround('*', '*', 'italic text'),
    strike: (a) => a.surround('~~', '~~', 'struck through'),
    code:   (a) => a.surround('`', '`', 'code'),
    h1: (a) => a.prefixLines(() => '# ', /^#{1,6}\s+/),
    h2: (a) => a.prefixLines(() => '## ', /^#{1,6}\s+/),
    h3: (a) => a.prefixLines(() => '### ', /^#{1,6}\s+/),
    ul: (a) => a.prefixLines(() => '- ', /^\s*[-*+]\s+/),
    ol: (a) => a.prefixLines((i) => (i + 1) + '. ', /^\s*\d+[.)]\s+/),
    task: (a) => a.prefixLines(() => '- [ ] ', /^\s*[-*+]\s+\[[ xX]\]\s+/),
    quote: (a) => a.prefixLines(() => '> ', /^\s*>\s?/),
    hr: (a) => a.insertBlock('\n---\n\n'),
    link: (a) => {
      const ed = a.el.editor;
      const sel = ed.value.slice(ed.selectionStart, ed.selectionEnd);
      if (/^https?:\/\//i.test(sel)) return a.surround('[](', ')');
      const s = ed.selectionStart;
      const text = '[' + (sel || 'link text') + '](https://)';
      a.setRange(ed.selectionStart, ed.selectionEnd, text, s + text.length - 1, s + text.length - 1);
    },
    image: (a) => {
      const ed = a.el.editor, s = ed.selectionStart;
      const text = '![alt text](https://)';
      a.setRange(ed.selectionStart, ed.selectionEnd, text, s + text.length - 1);
    },
    codeblock: (a) => {
      const ed = a.el.editor;
      const sel = ed.value.slice(ed.selectionStart, ed.selectionEnd);
      if (sel) return a.insertBlock('```\n' + sel + '\n```\n');
      a.insertBlock('```js\n\n```\n', 5);
    },
    table: (a) => a.insertBlock('| Column | Column | Column |\n| --- | --- | --- |\n| Cell | Cell | Cell |\n| Cell | Cell | Cell |\n\n'),
    math: (a) => a.insertBlock('$$\n\\frac{a}{b} = c\n$$\n\n')
  };

  /* ---------- go ---------- */
  const api = Shell.create({
    tool: 'markdown',
    ext: 'md',
    mime: 'text/markdown',
    blank: '# Untitled\n\n',
    sampleTitle: 'Welcome to Inkwell',
    swPath: '../sw.js',
    commands: commands,
    shortcuts: {
      b: (a) => commands.bold(a),
      i: (a) => commands.italic(a),
      k: (a) => commands.link(a),
      e: (a) => commands.code(a)
    },
    deriveTitle: (content) => {
      const m = content.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m);
      if (m) return m[1].replace(/[*_`~[\]]/g, '').trim().slice(0, 80);
      const first = content.split('\n').find((l) => l.trim());
      return first ? first.replace(/[#*_`~[\]>]/g, '').trim().slice(0, 60) || 'Untitled' : 'Untitled';
    },
    docSummary: (content) => (content.match(/[\wÀ-￿'’-]+/g) || []).length + ' words',
    updateStatus: (v) => {
      const words = (v.trim().match(/[\wÀ-￿'’-]+/g) || []).length;
      const lines = v.split('\n').length;
      $('#st-words').textContent = words.toLocaleString() + (words === 1 ? ' word' : ' words');
      $('#st-chars').textContent = v.length.toLocaleString() + ' characters';
      $('#st-lines').textContent = lines.toLocaleString() + (lines === 1 ? ' line' : ' lines');
      $('#st-read').textContent = Math.max(1, Math.round(words / 220)) + ' min read';
    },
    render: (src, preview, a) => {
      preview.innerHTML = markdownToHtml(src);
      enhance(preview, a);
    },
    htmlDocument: (title, body) =>
      '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>' + escapeHtml(title) + '</title>\n' +
      '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">\n' +
      '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github.min.css">\n' +
      '<style>' + EXPORT_CSS + '</style>\n</head>\n<body>\n<main class="wrap">\n' + body + '\n</main>\n</body>\n</html>\n',

    /* Enter continues the current list item. */
    onKeydown: (e, a) => {
      if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey) return;
      const ed = a.el.editor, val = ed.value, s = ed.selectionStart;
      if (s !== ed.selectionEnd) return;
      const ls = val.lastIndexOf('\n', s - 1) + 1;
      const line = val.slice(ls, s);
      const m = line.match(/^(\s*)(?:([-*+])|(\d+)([.)]))\s+(\[[ xX]\]\s+)?/);
      if (!m) return;
      e.preventDefault();
      if (!line.slice(m[0].length).trim()) { a.setRange(ls, s, '', ls); return; }
      let marker = m[2] ? m[1] + m[2] + ' ' : m[1] + (parseInt(m[3], 10) + 1) + m[4] + ' ';
      if (m[5]) marker += '[ ] ';
      a.setRange(s, s, '\n' + marker);
    }
  });

  /* re-render diagrams when the theme flips */
  Shell.onTheme((t) => {
    if (!window.mermaid) return;
    mermaidReady = false;
    mermaidCache.clear();
    try {
      window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: t === 'dark' ? 'dark' : 'default' });
      mermaidReady = true;
    } catch (e) { /* ignore */ }
    api.scheduleRender(0);
  });

  /* ticking a checkbox in the preview rewrites the source */
  api.el.preview.addEventListener('click', (e) => {
    const box = e.target.closest('input[type="checkbox"][data-task]');
    if (!box) return;
    const idx = Number(box.dataset.task);
    const val = api.el.editor.value;
    const re = /^([ \t]*[-*+][ \t]+)\[([ xX])\]/gm;
    let m, n = 0;
    while ((m = re.exec(val))) {
      if (n === idx) {
        const at = m.index + m[1].length + 1;
        api.setRange(at, at + 1, m[2] === ' ' ? 'x' : ' ', api.el.editor.selectionStart);
        return;
      }
      n++;
    }
  });
})();
