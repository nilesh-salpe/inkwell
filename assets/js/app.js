/* ============================================================
   Inkwell — Markdown editor / viewer / PDF exporter
   No build step, no server, no telemetry. Everything is local.
   ============================================================ */
(function () {
  'use strict';

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.prototype.slice.call(r.querySelectorAll(s));

  const el = {
    app:        $('#app'),
    editor:     $('#editor'),
    gutter:     $('#gutter'),
    editorWrap: $('.editor-wrap'),
    editorPane: $('#editor-pane'),
    preview:    $('#preview'),
    pvScroll:   $('#preview-scroll'),
    workspace:  $('#workspace'),
    splitter:   $('#splitter'),
    title:      $('#doc-title'),
    saveState:  $('#save-state'),
    docList:    $('#doc-list'),
    outline:    $('#outline'),
    toast:      $('#toast'),
    fileInput:  $('#file-input'),
    dropOverlay:$('#drop-overlay'),
    findbar:    $('#findbar'),
    findInput:  $('#find-input'),
    replInput:  $('#replace-input'),
    findCount:  $('#find-count'),
    menuExport: $('#menu-export'),
    btnSync:    $('#btn-sync'),
    modalHelp:  $('#modal-help')
  };

  /* ---------------------------------------------------------
     Storage
     --------------------------------------------------------- */
  const LS = { docs: 'inkwell.docs', active: 'inkwell.active', prefs: 'inkwell.prefs' };

  function lsGet(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { toast('Local storage is full — export your work to a file'); return false; }
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const prefs = Object.assign({
    theme: 'auto', mode: 'split', sidebar: true, split: 50, sync: true, pvWidth: 'normal'
  }, lsGet(LS.prefs, {}));
  const savePrefs = () => lsSet(LS.prefs, prefs);

  let docs = lsGet(LS.docs, []);
  let activeId = lsGet(LS.active, null);

  /* ---------------------------------------------------------
     Small helpers
     --------------------------------------------------------- */
  let toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2200);
  }
  const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function relTime(ts) {
    const d = Math.max(0, Date.now() - ts) / 1000;
    if (d < 60) return 'just now';
    if (d < 3600) return Math.floor(d / 60) + 'm ago';
    if (d < 86400) return Math.floor(d / 3600) + 'h ago';
    if (d < 604800) return Math.floor(d / 86400) + 'd ago';
    return new Date(ts).toLocaleDateString();
  }

  function download(filename, mime, text) {
    const blob = new Blob([text], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function safeFilename(name) {
    return (name || 'document').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'document';
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  const loaded = {};
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
    return loaded[src];
  }

  /* ---------------------------------------------------------
     Theme
     --------------------------------------------------------- */
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  function effectiveTheme() {
    return prefs.theme === 'auto' ? (media.matches ? 'dark' : 'light') : prefs.theme;
  }
  function applyTheme() {
    const t = effectiveTheme();
    document.documentElement.setAttribute('data-theme', t);
    const lightSheet = $('#hljs-light'), darkSheet = $('#hljs-dark');
    if (lightSheet) lightSheet.disabled = (t === 'dark');
    if (darkSheet) darkSheet.disabled = (t !== 'dark');
    if (window.mermaid) {
      mermaidReady = false;
      mermaidCache.clear();
      try {
        window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: t === 'dark' ? 'dark' : 'default' });
        mermaidReady = true;
      } catch (e) { /* ignore */ }
      scheduleRender(0);
    }
  }
  media.addEventListener('change', () => { if (prefs.theme === 'auto') applyTheme(); });

  $('#btn-theme').addEventListener('click', () => {
    prefs.theme = effectiveTheme() === 'dark' ? 'light' : 'dark';
    savePrefs(); applyTheme();
    toast(prefs.theme === 'dark' ? 'Dark theme' : 'Light theme');
  });

  /* ---------------------------------------------------------
     Markdown pipeline
     --------------------------------------------------------- */
  marked.use({ gfm: true, breaks: false, pedantic: false });

  /* Split source into fenced-code / prose chunks so that rewrites
     (footnotes, page breaks) never touch code samples. */
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
      } else {
        buf.push(line);
      }
    }
    flush();
    return out.join('\n');
  }

  /* Footnotes: `[^id]` references + `[^id]: text` definitions.
     Definitions are blanked in place so editor line numbers stay aligned. */
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
      const num = n + 1;
      return '<sup class="fn-ref" id="fnref-' + escapeHtml(id) + '"><a href="#fn-' +
        escapeHtml(id) + '" title="Footnote ' + num + '">' + num + '</a></sup>';
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

  /* Render markdown block by block so every top-level element can carry
     the source line it came from (used for scroll sync + the outline). */
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

  /* ---------------------------------------------------------
     Preview enhancement
     --------------------------------------------------------- */
  const CALLOUTS = {
    NOTE:      { cls: 'callout-note',      label: 'Note' },
    TIP:       { cls: 'callout-tip',       label: 'Tip' },
    IMPORTANT: { cls: 'callout-important', label: 'Important' },
    WARNING:   { cls: 'callout-warning',   label: 'Warning' },
    CAUTION:   { cls: 'callout-caution',   label: 'Caution' }
  };
  const CALLOUT_ICON = {
    NOTE: 'ℹ️', TIP: '💡', IMPORTANT: '❗', WARNING: '⚠️', CAUTION: '🛑'
  };

  const mermaidCache = new Map();
  let mermaidReady = false;
  let katexReady = false;

  function slugify(s) {
    return s.toLowerCase().trim()
      .replace(/[^\w\sÀ-￿-]/g, '')
      .replace(/\s+/g, '-').replace(/-+/g, '-') || 'section';
  }

  function enhancePreview() {
    const root = el.preview;

    /* headings: stable ids + hover anchors + outline */
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
    buildOutline(heads.filter((h) => !h.closest('.footnotes')));

    /* GitHub-style callouts */
    $$('blockquote', root).forEach((bq) => {
      const p = bq.firstElementChild;
      if (!p || p.tagName !== 'P') return;
      const m = p.textContent.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i);
      if (!m) return;
      const kind = m[1].toUpperCase();
      const meta = CALLOUTS[kind];
      const div = document.createElement('div');
      div.className = 'callout ' + meta.cls;
      if (bq.dataset.line) div.dataset.line = bq.dataset.line;
      const title = document.createElement('div');
      title.className = 'callout-title';
      title.textContent = CALLOUT_ICON[kind] + ' ' + meta.label;
      /* strip the marker from the first paragraph */
      p.innerHTML = p.innerHTML.replace(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(<br\s*\/?>)?\s*/i, '');
      div.appendChild(title);
      while (bq.firstChild) div.appendChild(bq.firstChild);
      if (!p.textContent.trim() && !p.querySelector('img,code')) p.remove();
      bq.replaceWith(div);
    });

    /* forced page breaks for PDF */
    $$('p', root).forEach((p) => {
      const t = p.textContent.trim();
      if (t === '\\pagebreak' || t === '\\newpage') {
        const hr = document.createElement('div');
        hr.className = 'pagebreak';
        if (p.dataset.line) hr.dataset.line = p.dataset.line;
        p.replaceWith(hr);
      }
    });

    /* task lists — clickable, writes back to the source */
    let taskIndex = 0;
    $$('li', root).forEach((li) => {
      const box = li.querySelector(':scope > input[type="checkbox"]');
      if (!box) return;
      li.classList.add('task-list-item');
      li.classList.toggle('is-checked', box.checked);
      box.disabled = false;
      box.dataset.task = String(taskIndex++);
    });

    /* code blocks: mermaid, highlighting, copy buttons */
    const mermaidNodes = [];
    $$('pre > code', root).forEach((code) => {
      const pre = code.parentElement;
      const cls = code.className || '';
      const langMatch = cls.match(/language-([\w+#-]+)/i);
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
        const ok = await copyText(code.textContent);
        btn.textContent = ok ? 'Copied' : 'Failed';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1400);
      });
      pre.appendChild(btn);
    });

    /* external links open in a new tab */
    $$('a[href^="http"]', root).forEach((a) => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });

    if (mermaidNodes.length) renderMermaid(mermaidNodes);
    if (/[$\\]/.test(root.textContent)) renderMath(root);
  }

  function renderMermaid(nodes) {
    loadScript('https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js')
      .then(() => {
        if (!mermaidReady) {
          window.mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: effectiveTheme() === 'dark' ? 'dark' : 'default',
            fontFamily: 'inherit'
          });
          mermaidReady = true;
        }
        const sources = nodes.map((n) => n.textContent);
        return window.mermaid.run({ nodes: nodes, suppressErrors: true }).then(() => {
          nodes.forEach((n, i) => { if (n.querySelector('svg')) mermaidCache.set(sources[i], n.innerHTML); });
        });
      })
      .catch(() => { nodes.forEach((n) => { n.innerHTML = '<span class="md-error">Diagram engine unavailable (offline?)</span>'; }); });
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
    loadScript('https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js')
      .then(() => loadScript('https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js'))
      .then(() => { katexReady = true; go(); })
      .catch(() => { /* math stays as plain text */ });
  }

  function buildOutline(heads) {
    el.outline.innerHTML = '';
    if (!heads.length) {
      el.outline.innerHTML = '<li class="outline-empty">Headings you add will appear here.</li>';
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
        if (!isNaN(ln)) scrollEditorToLine(ln);
      });
      li.appendChild(a);
      frag.appendChild(li);
    });
    el.outline.appendChild(frag);
  }

  /* ---------------------------------------------------------
     Render loop
     --------------------------------------------------------- */
  let renderTimer = null;
  function scheduleRender(delay) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, delay == null ? 130 : delay);
  }
  function render() {
    clearTimeout(renderTimer);
    const src = el.editor.value;
    const keepTop = el.pvScroll.scrollTop;
    el.preview.innerHTML = markdownToHtml(src);
    enhancePreview();
    el.pvScroll.scrollTop = keepTop;
  }

  /* ---------------------------------------------------------
     Editor line metrics (exact, wrap-aware) — powers the gutter
     and scroll sync.
     --------------------------------------------------------- */
  const mirror = document.createElement('div');
  mirror.setAttribute('aria-hidden', 'true');
  Object.assign(mirror.style, {
    position: 'absolute', top: '0', left: '0', visibility: 'hidden',
    pointerEvents: 'none', zIndex: '-1', whiteSpace: 'pre-wrap',
    wordWrap: 'break-word', overflowWrap: 'break-word', boxSizing: 'border-box'
  });
  el.editorWrap.appendChild(mirror);

  let lineTops = null;         /* pixel offset of every source line */
  let metricsDirty = true;
  const MAX_METRIC_LINES = 8000;

  function buildMetrics() {
    metricsDirty = false;
    const lines = el.editor.value.split('\n');
    if (lines.length > MAX_METRIC_LINES) { lineTops = null; renderGutter(lines.length, null); return; }
    const cs = getComputedStyle(el.editor);
    ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'tabSize',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].forEach((p) => { mirror.style[p] = cs[p]; });
    mirror.style.width = el.editor.clientWidth + 'px';
    mirror.innerHTML = lines.map((l) => '<div>' + (l ? escapeHtml(l) : '&#8203;') + '</div>').join('');
    const kids = mirror.children;
    lineTops = new Array(kids.length);
    for (let i = 0; i < kids.length; i++) lineTops[i] = kids[i].offsetTop;
    renderGutter(lines.length, kids);
  }

  function renderGutter(count, kids) {
    let html = '';
    if (kids) {
      for (let i = 0; i < count; i++) {
        const h = (i + 1 < count ? kids[i + 1].offsetTop : kids[i].offsetTop + kids[i].offsetHeight) - kids[i].offsetTop;
        html += '<div style="height:' + h + 'px">' + (i + 1) + '</div>';
      }
    } else {
      for (let i = 0; i < count; i++) html += '<div>' + (i + 1) + '</div>';
    }
    el.gutter.innerHTML = html;
    el.gutter.scrollTop = el.editor.scrollTop;
  }

  function ensureMetrics() { if (metricsDirty) buildMetrics(); return lineTops; }

  function lineAtOffset(px) {
    const tops = ensureMetrics();
    if (!tops) return Math.floor(px / 24);
    let lo = 0, hi = tops.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tops[mid] <= px) lo = mid; else hi = mid - 1; }
    return lo;
  }
  function offsetOfLine(n) {
    const tops = ensureMetrics();
    if (!tops) return n * 24;
    return tops[Math.max(0, Math.min(tops.length - 1, n))];
  }
  function scrollEditorToLine(n) {
    el.editor.scrollTop = Math.max(0, offsetOfLine(n) - 40);
    el.gutter.scrollTop = el.editor.scrollTop;
  }

  /* ---------------------------------------------------------
     Scroll sync
     --------------------------------------------------------- */
  let syncing = 0;
  function previewBlocks() {
    return $$('[data-line]', el.preview);
  }
  function syncEditorToPreview() {
    if (!prefs.sync || syncing) return;
    syncing = 1;
    requestAnimationFrame(() => {
      const line = lineAtOffset(el.editor.scrollTop);
      const blocks = previewBlocks();
      if (!blocks.length) { syncing = 0; return; }
      let prev = null, next = null;
      for (const b of blocks) {
        const bl = Number(b.dataset.line);
        if (bl <= line) prev = b; else { next = b; break; }
      }
      let target;
      if (!prev) target = 0;
      else {
        const pTop = prev.offsetTop, pLine = Number(prev.dataset.line);
        if (next) {
          const nTop = next.offsetTop, nLine = Number(next.dataset.line);
          const f = nLine > pLine ? (line - pLine) / (nLine - pLine) : 0;
          target = pTop + (nTop - pTop) * Math.max(0, Math.min(1, f));
        } else {
          target = pTop;
        }
      }
      el.pvScroll.scrollTop = Math.max(0, target - 16);
      syncing = 0;
    });
  }
  function syncPreviewToEditor() {
    if (!prefs.sync || syncing) return;
    syncing = 2;
    requestAnimationFrame(() => {
      const top = el.pvScroll.scrollTop + 16;
      const blocks = previewBlocks();
      if (!blocks.length) { syncing = 0; return; }
      let prev = null, next = null;
      for (const b of blocks) {
        if (b.offsetTop <= top) prev = b; else { next = b; break; }
      }
      let line;
      if (!prev) line = 0;
      else {
        const pLine = Number(prev.dataset.line), pTop = prev.offsetTop;
        if (next) {
          const nLine = Number(next.dataset.line), nTop = next.offsetTop;
          const f = nTop > pTop ? (top - pTop) / (nTop - pTop) : 0;
          line = pLine + (nLine - pLine) * Math.max(0, Math.min(1, f));
        } else line = pLine;
      }
      el.editor.scrollTop = Math.max(0, offsetOfLine(Math.round(line)) - 16);
      el.gutter.scrollTop = el.editor.scrollTop;
      syncing = 0;
    });
  }

  el.editor.addEventListener('scroll', () => {
    el.gutter.scrollTop = el.editor.scrollTop;
    if (syncing !== 2) syncEditorToPreview();
  });
  el.pvScroll.addEventListener('scroll', () => { if (syncing !== 1) syncPreviewToEditor(); });

  el.btnSync.addEventListener('click', () => {
    prefs.sync = !prefs.sync; savePrefs();
    el.btnSync.setAttribute('aria-pressed', String(prefs.sync));
    toast(prefs.sync ? 'Synchronised scrolling on' : 'Synchronised scrolling off');
  });

  /* ---------------------------------------------------------
     Document model
     --------------------------------------------------------- */
  function currentDoc() { return docs.find((d) => d.id === activeId); }

  function deriveTitle(content) {
    const m = content.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m);
    if (m) return m[1].replace(/[*_`~[\]]/g, '').trim().slice(0, 80);
    const first = content.split('\n').find((l) => l.trim());
    return first ? first.replace(/[#*_`~[\]>]/g, '').trim().slice(0, 60) || 'Untitled' : 'Untitled';
  }

  let saveTimer = null;
  function markDirty() {
    el.saveState.textContent = 'Saving…';
    el.saveState.classList.add('dirty');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 450);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    const doc = currentDoc();
    if (!doc) return;
    doc.content = el.editor.value;
    doc.updated = Date.now();
    if (!doc.named) {
      doc.title = deriveTitle(doc.content);
      if (document.activeElement !== el.title) el.title.value = doc.title;
    }
    docs.sort((a, b) => b.updated - a.updated);
    lsSet(LS.docs, docs);
    lsSet(LS.active, activeId);
    el.saveState.textContent = 'Saved';
    el.saveState.classList.remove('dirty');
    renderDocList();
  }

  function renderDocList() {
    el.docList.innerHTML = '';
    const frag = document.createDocumentFragment();
    docs.forEach((d) => {
      const li = document.createElement('li');
      li.className = 'doc-item' + (d.id === activeId ? ' is-active' : '');
      li.tabIndex = 0;
      const words = (d.content.match(/[\wÀ-￿'’-]+/g) || []).length;
      li.innerHTML =
        '<div class="doc-meta"><span class="doc-name"></span>' +
        '<span class="doc-sub">' + relTime(d.updated) + ' · ' + words + ' words</span></div>' +
        '<button class="doc-del" title="Delete"><svg class="ico"><use href="#i-trash"/></svg></button>';
      li.querySelector('.doc-name').textContent = d.title || 'Untitled';
      li.addEventListener('click', (ev) => {
        if (ev.target.closest('.doc-del')) return;
        openDoc(d.id);
      });
      li.querySelector('.doc-del').addEventListener('click', (ev) => {
        ev.stopPropagation();
        removeDoc(d.id);
      });
      frag.appendChild(li);
    });
    el.docList.appendChild(frag);
  }

  function openDoc(id, skipSave) {
    if (!skipSave) saveNow();
    const doc = docs.find((d) => d.id === id);
    if (!doc) return;
    activeId = id;
    el.editor.value = doc.content;
    el.title.value = doc.title || 'Untitled';
    lsSet(LS.active, activeId);
    metricsDirty = true;
    buildMetrics();
    render();
    updateStatus();
    renderDocList();
    el.editor.setSelectionRange(0, 0);
    el.editor.scrollTop = 0; el.pvScroll.scrollTop = 0;
  }

  function newDoc(content, title, named) {
    saveNow();
    const doc = {
      id: uid(),
      title: title || deriveTitle(content || '') || 'Untitled',
      named: !!named,
      content: content || '',
      updated: Date.now()
    };
    docs.unshift(doc);
    lsSet(LS.docs, docs);
    openDoc(doc.id, true);
    saveNow();
    return doc;
  }

  function removeDoc(id) {
    const doc = docs.find((d) => d.id === id);
    if (!doc) return;
    if (!confirm('Delete “' + (doc.title || 'Untitled') + '”? This cannot be undone.')) return;
    docs = docs.filter((d) => d.id !== id);
    lsSet(LS.docs, docs);
    if (activeId === id) {
      if (docs.length) openDoc(docs[0].id);
      else newDoc('# Untitled\n\n', 'Untitled');
    } else renderDocList();
    toast('Document deleted');
  }

  $('#btn-new').addEventListener('click', () => { newDoc('# Untitled\n\n', 'Untitled'); el.editor.focus(); });

  el.title.addEventListener('input', () => {
    const doc = currentDoc();
    if (!doc) return;
    doc.named = true;
    doc.title = el.title.value.trim() || 'Untitled';
    markDirty();
  });
  el.title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.title.blur(); } });

  /* ---------------------------------------------------------
     Status bar
     --------------------------------------------------------- */
  function updateStatus() {
    const v = el.editor.value;
    const words = (v.trim().match(/[\wÀ-￿'’-]+/g) || []).length;
    const lines = v.split('\n').length;
    $('#st-words').textContent = words.toLocaleString() + (words === 1 ? ' word' : ' words');
    $('#st-chars').textContent = v.length.toLocaleString() + ' characters';
    $('#st-lines').textContent = lines.toLocaleString() + (lines === 1 ? ' line' : ' lines');
    $('#st-read').textContent = Math.max(1, Math.round(words / 220)) + ' min read';
    updateCaret();
  }
  function updateCaret() {
    const pos = el.editor.selectionStart;
    const upto = el.editor.value.slice(0, pos);
    const line = upto.split('\n').length;
    const col = pos - upto.lastIndexOf('\n');
    $('#st-pos').textContent = 'Ln ' + line + ', Col ' + col;
  }

  /* ---------------------------------------------------------
     Editing primitives (undo-safe)
     --------------------------------------------------------- */
  function setRange(start, end, text, selStart, selEnd) {
    el.editor.focus();
    el.editor.setSelectionRange(start, end);
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
    if (!ok) {
      el.editor.setRangeText(text, start, end, 'end');
      el.editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (selStart != null) el.editor.setSelectionRange(selStart, selEnd == null ? selStart : selEnd);
  }

  function surround(before, after, placeholder) {
    const ed = el.editor;
    let s = ed.selectionStart, e = ed.selectionEnd;
    const val = ed.value;
    const sel = val.slice(s, e);
    /* toggle off if already wrapped */
    if (sel && val.slice(s - before.length, s) === before && val.slice(e, e + after.length) === after) {
      setRange(s - before.length, e + after.length, sel, s - before.length, s - before.length + sel.length);
      return;
    }
    if (!sel && placeholder) {
      setRange(s, e, before + placeholder + after, s + before.length, s + before.length + placeholder.length);
      return;
    }
    setRange(s, e, before + sel + after, s + before.length, s + before.length + sel.length);
  }

  function lineBounds(val, s, e) {
    const start = val.lastIndexOf('\n', s - 1) + 1;
    let end = val.indexOf('\n', e);
    if (end === -1) end = val.length;
    return [start, end];
  }

  function prefixLines(makePrefix, stripRe) {
    const ed = el.editor, val = ed.value;
    const [ls, le] = lineBounds(val, ed.selectionStart, ed.selectionEnd);
    const lines = val.slice(ls, le).split('\n');
    const allHave = lines.every((l) => stripRe.test(l) || !l.trim());
    const out = lines.map((l, i) => allHave ? l.replace(stripRe, '') : makePrefix(i) + l).join('\n');
    setRange(ls, le, out, ls, ls + out.length);
  }

  function insertBlock(text, caretBack) {
    const ed = el.editor, val = ed.value;
    let s = ed.selectionStart;
    const atLineStart = s === 0 || val[s - 1] === '\n';
    const prefix = atLineStart ? '' : '\n';
    const body = prefix + text;
    setRange(s, ed.selectionEnd, body, s + body.length - (caretBack || 0));
  }

  const commands = {
    bold:   () => surround('**', '**', 'bold text'),
    italic: () => surround('*', '*', 'italic text'),
    strike: () => surround('~~', '~~', 'struck through'),
    code:   () => surround('`', '`', 'code'),
    h1: () => prefixLines(() => '# ', /^#{1,6}\s+/),
    h2: () => prefixLines(() => '## ', /^#{1,6}\s+/),
    h3: () => prefixLines(() => '### ', /^#{1,6}\s+/),
    ul: () => prefixLines(() => '- ', /^\s*[-*+]\s+/),
    ol: () => prefixLines((i) => (i + 1) + '. ', /^\s*\d+[.)]\s+/),
    task: () => prefixLines(() => '- [ ] ', /^\s*[-*+]\s+\[[ xX]\]\s+/),
    quote: () => prefixLines(() => '> ', /^\s*>\s?/),
    hr: () => insertBlock('\n---\n\n'),
    link: () => {
      const ed = el.editor;
      const sel = ed.value.slice(ed.selectionStart, ed.selectionEnd);
      if (/^https?:\/\//i.test(sel)) { surround('[](', ')'); return; }
      const s = ed.selectionStart;
      const label = sel || 'link text';
      const text = '[' + label + '](https://)';
      setRange(ed.selectionStart, ed.selectionEnd, text, s + text.length - 1, s + text.length - 1);
    },
    image: () => {
      const ed = el.editor, s = ed.selectionStart;
      const text = '![alt text](https://)';
      setRange(ed.selectionStart, ed.selectionEnd, text, s + text.length - 1);
    },
    codeblock: () => {
      const ed = el.editor;
      const sel = ed.value.slice(ed.selectionStart, ed.selectionEnd);
      if (sel) { insertBlock('```\n' + sel + '\n```\n'); return; }
      insertBlock('```js\n\n```\n', 5);
    },
    table: () => insertBlock(
      '| Column | Column | Column |\n| --- | --- | --- |\n| Cell | Cell | Cell |\n| Cell | Cell | Cell |\n\n'),
    math: () => insertBlock('$$\n\\frac{a}{b} = c\n$$\n\n'),
    find: () => toggleFind(true)
  };

  $('#toolbar').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cmd]');
    if (!btn) return;
    const fn = commands[btn.dataset.cmd];
    if (fn) fn();
  });

  /* ---------------------------------------------------------
     Key handling in the editor
     --------------------------------------------------------- */
  el.editor.addEventListener('keydown', (e) => {
    const ed = el.editor;

    if (e.key === 'Tab') {
      e.preventDefault();
      const val = ed.value, s = ed.selectionStart, e2 = ed.selectionEnd;
      if (s !== e2 && val.slice(s, e2).indexOf('\n') !== -1) {
        const [ls, le] = lineBounds(val, s, e2);
        const lines = val.slice(ls, le).split('\n');
        const out = lines.map((l) => e.shiftKey ? l.replace(/^ {1,2}|^\t/, '') : '  ' + l).join('\n');
        setRange(ls, le, out, ls, ls + out.length);
      } else if (e.shiftKey) {
        const [ls] = lineBounds(val, s, s);
        const line = val.slice(ls, ls + 2);
        if (line.startsWith('  ')) setRange(ls, ls + 2, '', Math.max(ls, s - 2));
        else if (val[ls] === '\t') setRange(ls, ls + 1, '', Math.max(ls, s - 1));
      } else {
        setRange(s, e2, '  ');
      }
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      const val = ed.value, s = ed.selectionStart;
      if (s !== ed.selectionEnd) return;
      const ls = val.lastIndexOf('\n', s - 1) + 1;
      const line = val.slice(ls, s);
      const m = line.match(/^(\s*)(?:([-*+])|(\d+)([.)]))\s+(\[[ xX]\]\s+)?/);
      if (!m) return;
      const rest = line.slice(m[0].length);
      e.preventDefault();
      if (!rest.trim()) {            /* empty item -> end the list */
        setRange(ls, s, '', ls);
        return;
      }
      let marker;
      if (m[2]) marker = m[1] + m[2] + ' ';
      else marker = m[1] + (parseInt(m[3], 10) + 1) + m[4] + ' ';
      if (m[5]) marker += '[ ] ';
      setRange(s, s, '\n' + marker);
      return;
    }

    if (e.key === 'Escape' && !el.findbar.hidden) { toggleFind(false); }
  });

  /* keep the caret readout live */
  ['keyup', 'click', 'select'].forEach((ev) =>
    el.editor.addEventListener(ev, updateCaret));

  el.editor.addEventListener('input', () => {
    metricsDirty = true;
    buildMetrics();
    updateStatus();
    markDirty();
    scheduleRender();
  });

  /* clicking a checkbox in the preview edits the source */
  el.preview.addEventListener('click', (e) => {
    const box = e.target.closest('input[type="checkbox"][data-task]');
    if (!box) return;
    const idx = Number(box.dataset.task);
    const val = el.editor.value;
    const re = /^([ \t]*[-*+][ \t]+)\[([ xX])\]/gm;
    let m, n = 0;
    while ((m = re.exec(val))) {
      if (n === idx) {
        const at = m.index + m[1].length + 1;
        const now = m[2] === ' ' ? 'x' : ' ';
        const start = el.editor.selectionStart;
        setRange(at, at + 1, now, start);
        return;
      }
      n++;
    }
  });

  /* ---------------------------------------------------------
     Find & replace
     --------------------------------------------------------- */
  let matches = [], matchIdx = -1;

  function toggleFind(show) {
    el.findbar.hidden = !show;
    if (show) {
      const sel = el.editor.value.slice(el.editor.selectionStart, el.editor.selectionEnd);
      if (sel && sel.length < 80 && sel.indexOf('\n') === -1) el.findInput.value = sel;
      el.findInput.focus(); el.findInput.select();
      runFind();
    } else {
      matches = []; matchIdx = -1;
      el.editor.focus();
    }
  }
  function runFind() {
    const q = el.findInput.value;
    matches = [];
    if (q) {
      const hay = el.editor.value.toLowerCase(), needle = q.toLowerCase();
      let i = hay.indexOf(needle);
      while (i !== -1 && matches.length < 10000) { matches.push(i); i = hay.indexOf(needle, i + Math.max(1, needle.length)); }
    }
    matchIdx = matches.length ? 0 : -1;
    updateFindCount();
    if (matchIdx >= 0) gotoMatch(0, false);
  }
  function updateFindCount() {
    el.findCount.textContent = (matchIdx + 1) + '/' + matches.length;
  }
  function gotoMatch(delta, move) {
    if (!matches.length) return;
    if (move) matchIdx = (matchIdx + delta + matches.length) % matches.length;
    const at = matches[matchIdx];
    const len = el.findInput.value.length;
    el.editor.focus();
    el.editor.setSelectionRange(at, at + len);
    const line = el.editor.value.slice(0, at).split('\n').length - 1;
    const top = offsetOfLine(line);
    if (top < el.editor.scrollTop || top > el.editor.scrollTop + el.editor.clientHeight - 60) {
      el.editor.scrollTop = Math.max(0, top - el.editor.clientHeight / 3);
      el.gutter.scrollTop = el.editor.scrollTop;
    }
    updateFindCount();
  }
  el.findInput.addEventListener('input', runFind);
  el.findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); gotoMatch(e.shiftKey ? -1 : 1, true); }
    if (e.key === 'Escape') toggleFind(false);
  });
  el.replInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); replaceOne(); }
    if (e.key === 'Escape') toggleFind(false);
  });
  $('#find-next').addEventListener('click', () => gotoMatch(1, true));
  $('#find-prev').addEventListener('click', () => gotoMatch(-1, true));
  $('#find-close').addEventListener('click', () => toggleFind(false));

  function replaceOne() {
    if (matchIdx < 0 || !matches.length) return;
    const at = matches[matchIdx];
    const len = el.findInput.value.length;
    const keep = matchIdx;
    setRange(at, at + len, el.replInput.value);
    runFind();
    if (matches.length) { matchIdx = Math.min(keep, matches.length - 1); gotoMatch(0, false); }
  }
  $('#replace-one').addEventListener('click', replaceOne);
  $('#replace-all').addEventListener('click', () => {
    const q = el.findInput.value;
    if (!q || !matches.length) return;
    const n = matches.length;
    const parts = el.editor.value.split(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'));
    setRange(0, el.editor.value.length, parts.join(el.replInput.value), 0, 0);
    runFind();
    toast('Replaced ' + n + (n === 1 ? ' match' : ' matches'));
  });

  /* ---------------------------------------------------------
     View modes / sidebar / splitter
     --------------------------------------------------------- */
  function setMode(mode) {
    prefs.mode = mode; savePrefs();
    el.app.classList.remove('mode-editor', 'mode-split', 'mode-preview');
    el.app.classList.add('mode-' + mode);
    $$('.vm').forEach((b) => b.classList.toggle('is-active', b.dataset.mode === mode));
    metricsDirty = true;
    requestAnimationFrame(() => { buildMetrics(); });
  }
  $$('.vm').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  function setSidebar(on) {
    prefs.sidebar = on; savePrefs();
    el.app.classList.toggle('no-sidebar', !on);
    metricsDirty = true;
    requestAnimationFrame(buildMetrics);
  }
  $('#btn-sidebar').addEventListener('click', () => setSidebar(!prefs.sidebar));

  $$('.side-tab').forEach((tab) => tab.addEventListener('click', () => {
    $$('.side-tab').forEach((t) => t.classList.toggle('is-active', t === tab));
    $('#panel-docs').hidden = tab.dataset.tab !== 'docs';
    $('#panel-outline').hidden = tab.dataset.tab !== 'outline';
  }));

  (function splitter() {
    let dragging = false;
    const apply = (pct) => {
      prefs.split = Math.max(20, Math.min(80, pct));
      el.editorPane.style.flexBasis = prefs.split + '%';
    };
    el.splitter.addEventListener('pointerdown', (e) => {
      dragging = true;
      el.splitter.setPointerCapture(e.pointerId);
      el.splitter.classList.add('dragging');
      document.body.classList.add('resizing');
    });
    el.splitter.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const rect = el.workspace.getBoundingClientRect();
      apply(((e.clientX - rect.left) / rect.width) * 100);
    });
    const stop = () => {
      if (!dragging) return;
      dragging = false;
      el.splitter.classList.remove('dragging');
      document.body.classList.remove('resizing');
      savePrefs();
      metricsDirty = true; buildMetrics();
    };
    el.splitter.addEventListener('pointerup', stop);
    el.splitter.addEventListener('pointercancel', stop);
    el.splitter.addEventListener('dblclick', () => { apply(50); savePrefs(); metricsDirty = true; buildMetrics(); });
    el.splitter.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { apply(prefs.split - 2); savePrefs(); }
      if (e.key === 'ArrowRight') { apply(prefs.split + 2); savePrefs(); }
    });
  })();

  $('#pv-width').addEventListener('change', (e) => {
    prefs.pvWidth = e.target.value; savePrefs();
    el.pvScroll.dataset.w = prefs.pvWidth;
  });

  window.addEventListener('resize', () => { metricsDirty = true; buildMetrics(); });

  /* ---------------------------------------------------------
     Import
     --------------------------------------------------------- */
  function importFile(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('That file is larger than 5 MB'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const name = file.name.replace(/\.(md|markdown|mdown|mkd|txt)$/i, '');
      newDoc(String(reader.result), name, true);
      toast('Opened ' + file.name);
    };
    reader.onerror = () => toast('Could not read that file');
    reader.readAsText(file);
  }

  $('#btn-open').addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', () => { importFile(el.fileInput.files[0]); el.fileInput.value = ''; });

  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') === -1) return;
    dragDepth++; el.dropOverlay.classList.add('show');
  });
  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; el.dropOverlay.classList.remove('show'); } });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0; el.dropOverlay.classList.remove('show');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) importFile(f);
  });

  /* ---------------------------------------------------------
     Export
     --------------------------------------------------------- */
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
    '.anchor,.code-copy{display:none}',
    '.pagebreak{break-after:page}',
    '@media print{.wrap{padding:0;max-width:none}a{color:#2a3a8f}}'
  ].join('');

  function previewHtmlForExport() {
    const clone = el.preview.cloneNode(true);
    clone.querySelectorAll('.anchor, .code-copy').forEach((n) => n.remove());
    clone.querySelectorAll('[data-line]').forEach((n) => n.removeAttribute('data-line'));
    clone.querySelectorAll('input[type="checkbox"]').forEach((n) => { n.setAttribute('disabled', ''); n.removeAttribute('data-task'); });
    return clone.innerHTML;
  }

  function exportHtml() {
    const doc = currentDoc();
    const title = (doc && doc.title) || 'Document';
    const hasMath = /katex/.test(el.preview.innerHTML);
    const html =
      '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>' + escapeHtml(title) + '</title>\n' +
      (hasMath ? '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">\n' : '') +
      '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github.min.css">\n' +
      '<style>' + EXPORT_CSS + '</style>\n</head>\n<body>\n<main class="wrap">\n' +
      previewHtmlForExport() +
      '\n</main>\n</body>\n</html>\n';
    download(safeFilename(title) + '.html', 'text/html', html);
    toast('HTML file downloaded');
  }

  function exportMarkdown() {
    const doc = currentDoc();
    download(safeFilename(doc && doc.title) + '.md', 'text/markdown', el.editor.value);
    toast('Markdown file downloaded');
  }

  let titleBeforePrint = null;
  function exportPdf() {
    render();                                   /* make sure the preview is current */
    const doc = currentDoc();
    titleBeforePrint = document.title;
    document.title = safeFilename(doc && doc.title);   /* becomes the suggested PDF name */
    setTimeout(() => {
      window.print();
    }, 60);
  }
  window.addEventListener('afterprint', () => {
    if (titleBeforePrint != null) { document.title = titleBeforePrint; titleBeforePrint = null; }
  });

  function encodeShare(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeShare(str) {
    let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  async function shareLink() {
    const url = location.origin + location.pathname + '#doc=' + encodeShare(el.editor.value);
    if (url.length > 30000) { toast('This document is too large for a share link — export a file instead'); return; }
    const ok = await copyText(url);
    toast(ok ? 'Share link copied (the document travels inside the link)' : 'Could not copy the link');
  }

  const exporters = {
    pdf: exportPdf,
    md: exportMarkdown,
    html: exportHtml,
    'copy-md': async () => toast(await copyText(el.editor.value) ? 'Markdown copied' : 'Copy failed'),
    'copy-html': async () => toast(await copyText(previewHtmlForExport()) ? 'HTML copied' : 'Copy failed'),
    share: shareLink
  };

  $('#menu-export').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-export]');
    if (!btn) return;
    closeMenus();
    exporters[btn.dataset.export]();
  });
  $('#btn-pdf').addEventListener('click', exportPdf);

  function closeMenus() {
    el.menuExport.hidden = true;
    $('#btn-export').setAttribute('aria-expanded', 'false');
  }
  $('#btn-export').addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = el.menuExport.hidden;
    closeMenus();
    if (willOpen) { el.menuExport.hidden = false; $('#btn-export').setAttribute('aria-expanded', 'true'); }
  });
  document.addEventListener('click', closeMenus);

  /* ---------------------------------------------------------
     Help modal
     --------------------------------------------------------- */
  function showHelp(on) { el.modalHelp.hidden = !on; }
  $('#btn-help').addEventListener('click', () => showHelp(true));
  el.modalHelp.addEventListener('click', (e) => {
    if (e.target === el.modalHelp || e.target.closest('[data-close]')) showHelp(false);
  });

  /* ---------------------------------------------------------
     Global shortcuts
     --------------------------------------------------------- */
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') { closeMenus(); showHelp(false); if (!el.findbar.hidden) toggleFind(false); return; }
    if (!mod) return;
    const k = e.key.toLowerCase();
    const inEditor = document.activeElement === el.editor;

    if (k === 'p') { e.preventDefault(); exportPdf(); return; }
    if (k === 's') { e.preventDefault(); saveNow(); exportMarkdown(); return; }
    if (k === 'f') { e.preventDefault(); toggleFind(true); return; }
    if (k === '\\') { e.preventDefault(); setSidebar(!prefs.sidebar); return; }
    if (k === '1') { e.preventDefault(); setMode('editor'); return; }
    if (k === '2') { e.preventDefault(); setMode('split'); return; }
    if (k === '3') { e.preventDefault(); setMode('preview'); return; }
    if (!inEditor) return;
    if (k === 'b') { e.preventDefault(); commands.bold(); }
    else if (k === 'i') { e.preventDefault(); commands.italic(); }
    else if (k === 'k') { e.preventDefault(); commands.link(); }
    else if (k === 'e') { e.preventDefault(); commands.code(); }
  });

  window.addEventListener('beforeunload', saveNow);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

  /* ---------------------------------------------------------
     Boot
     --------------------------------------------------------- */
  function boot() {
    setMode(prefs.mode || 'split');
    setSidebar(prefs.sidebar !== false);
    el.editorPane.style.flexBasis = (prefs.split || 50) + '%';
    el.pvScroll.dataset.w = prefs.pvWidth || 'normal';
    $('#pv-width').value = prefs.pvWidth || 'normal';
    el.btnSync.setAttribute('aria-pressed', String(prefs.sync !== false));
    applyTheme();

    const hash = location.hash || '';
    const shared = hash.indexOf('#doc=') === 0 ? hash.slice(5) : null;

    if (shared) {
      let text = '';
      try { text = decodeShare(shared); } catch (e) { text = ''; }
      history.replaceState(null, '', location.pathname);
      if (text) {
        newDoc(text, 'Shared document', true);
        toast('Opened a shared document');
        return finish();
      }
    }

    if (!docs.length) {
      const sample = $('#sample-doc');
      newDoc(sample ? sample.textContent.trim() + '\n' : '# Untitled\n\n', 'Welcome to Inkwell', true);
    } else {
      const doc = docs.find((d) => d.id === activeId) || docs[0];
      openDoc(doc.id);
    }
    finish();
  }

  function finish() {
    updateStatus();
    renderDocList();
    metricsDirty = true;
    buildMetrics();
    render();
  }

  boot();

  /* Offline support: cache the shell + libraries after the first visit. */
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline mode unavailable */ });
    });
  }
})();
