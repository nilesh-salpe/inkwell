/* ============================================================
   Shared editor shell.
   Owns everything that is not specific to a language: layout,
   documents, storage, theme, splitter, gutter, scroll sync,
   find & replace, exports and shortcuts.

   A tool supplies a render function and a set of toolbar
   commands; see markdown.js and json.js.
   ============================================================ */
window.Shell = (function () {
  'use strict';

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.prototype.slice.call(r.querySelectorAll(s));

  /* ---------- storage ---------- */
  function lsGet(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { toast('Local storage is full — export your work to a file'); return false; }
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* ---------- misc helpers ---------- */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
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

  /* ---------- theme (shared across every tool) ---------- */
  const THEME_KEY = 'inkwell.prefs.theme';
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let themePref = lsGet(THEME_KEY, 'auto');
  const themeListeners = [];

  const effectiveTheme = () => themePref === 'auto' ? (media.matches ? 'dark' : 'light') : themePref;

  function applyTheme() {
    const t = effectiveTheme();
    document.documentElement.setAttribute('data-theme', t);
    const light = $('#hljs-light'), dark = $('#hljs-dark');
    if (light) light.disabled = (t === 'dark');
    if (dark) dark.disabled = (t !== 'dark');
    themeListeners.forEach((fn) => { try { fn(t); } catch (e) { /* ignore */ } });
  }
  media.addEventListener('change', () => { if (themePref === 'auto') applyTheme(); });
  const onTheme = (fn) => themeListeners.push(fn);

  function initTheme() {
    applyTheme();
    const btn = $('#btn-theme');
    if (!btn) return;
    btn.addEventListener('click', () => {
      themePref = effectiveTheme() === 'dark' ? 'light' : 'dark';
      lsSet(THEME_KEY, themePref);
      applyTheme();
      toast(themePref === 'dark' ? 'Dark theme' : 'Light theme');
    });
  }

  /* ---------- share-link encoding ---------- */
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

  /* ============================================================
     create(config) — wires a full editor page
     ============================================================ */
  function create(config) {
    const TOOL = config.tool;
    const LS = {
      docs:  'inkwell.' + TOOL + '.docs',
      active:'inkwell.' + TOOL + '.active',
      prefs: 'inkwell.' + TOOL + '.prefs'
    };

    const el = {
      app: $('#app'), editor: $('#editor'), gutter: $('#gutter'),
      editorWrap: $('.editor-wrap'), editorPane: $('#editor-pane'),
      preview: $('#preview'), pvScroll: $('#preview-scroll'),
      workspace: $('#workspace'), splitter: $('#splitter'),
      title: $('#doc-title'), saveState: $('#save-state'),
      docList: $('#doc-list'), outline: $('#outline'),
      fileInput: $('#file-input'), dropOverlay: $('#drop-overlay'),
      findbar: $('#findbar'), findInput: $('#find-input'), replInput: $('#replace-input'),
      findCount: $('#find-count'), menuExport: $('#menu-export'),
      btnSync: $('#btn-sync'), modalHelp: $('#modal-help')
    };

    const prefs = Object.assign(
      { mode: 'split', sidebar: true, split: 50, sync: true, pvWidth: 'normal' },
      lsGet(LS.prefs, {})
    );
    const savePrefs = () => lsSet(LS.prefs, prefs);

    let docs = lsGet(LS.docs, []);
    let activeId = lsGet(LS.active, null);

    /* ---------- render loop ---------- */
    let renderTimer = null;
    function scheduleRender(delay) {
      clearTimeout(renderTimer);
      renderTimer = setTimeout(render, delay == null ? 130 : delay);
    }
    function render() {
      clearTimeout(renderTimer);
      const keepTop = el.pvScroll.scrollTop;
      try { config.render(el.editor.value, el.preview, api); }
      catch (e) {
        el.preview.innerHTML = '<p class="md-error">' + escapeHtml(e.message) + '</p>';
      }
      el.pvScroll.scrollTop = keepTop;
    }

    /* ---------- line metrics: exact, wrap-aware ---------- */
    const mirror = document.createElement('div');
    mirror.setAttribute('aria-hidden', 'true');
    Object.assign(mirror.style, {
      position: 'absolute', top: '0', left: '0', visibility: 'hidden',
      pointerEvents: 'none', zIndex: '-1', whiteSpace: 'pre-wrap',
      wordWrap: 'break-word', overflowWrap: 'break-word', boxSizing: 'border-box'
    });
    el.editorWrap.appendChild(mirror);

    let lineTops = null, metricsDirty = true;
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

    const ensureMetrics = () => { if (metricsDirty) buildMetrics(); return lineTops; };

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

    /* ---------- scroll sync ---------- */
    let syncing = 0;
    const previewBlocks = () => $$('[data-line]', el.preview);

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
        let target = 0;
        if (prev) {
          const pTop = prev.offsetTop, pLine = Number(prev.dataset.line);
          if (next) {
            const nTop = next.offsetTop, nLine = Number(next.dataset.line);
            const f = nLine > pLine ? (line - pLine) / (nLine - pLine) : 0;
            target = pTop + (nTop - pTop) * Math.max(0, Math.min(1, f));
          } else target = pTop;
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
        for (const b of blocks) { if (b.offsetTop <= top) prev = b; else { next = b; break; } }
        let line = 0;
        if (prev) {
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

    if (el.btnSync) el.btnSync.addEventListener('click', () => {
      prefs.sync = !prefs.sync; savePrefs();
      el.btnSync.setAttribute('aria-pressed', String(prefs.sync));
      toast(prefs.sync ? 'Synchronised scrolling on' : 'Synchronised scrolling off');
    });

    /* ---------- documents ---------- */
    const currentDoc = () => docs.find((d) => d.id === activeId);

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
        doc.title = config.deriveTitle(doc.content);
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
        li.innerHTML =
          '<div class="doc-meta"><span class="doc-name"></span>' +
          '<span class="doc-sub">' + relTime(d.updated) + ' · ' + config.docSummary(d.content) + '</span></div>' +
          '<button class="doc-del" title="Delete"><svg class="ico"><use href="#i-trash"/></svg></button>';
        li.querySelector('.doc-name').textContent = d.title || 'Untitled';
        li.addEventListener('click', (ev) => { if (!ev.target.closest('.doc-del')) openDoc(d.id); });
        li.querySelector('.doc-del').addEventListener('click', (ev) => { ev.stopPropagation(); removeDoc(d.id); });
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
        title: title || config.deriveTitle(content || '') || 'Untitled',
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
        else newDoc(config.blank, 'Untitled');
      } else renderDocList();
      toast('Document deleted');
    }

    $('#btn-new').addEventListener('click', () => { newDoc(config.blank, 'Untitled'); el.editor.focus(); });

    el.title.addEventListener('input', () => {
      const doc = currentDoc();
      if (!doc) return;
      doc.named = true;
      doc.title = el.title.value.trim() || 'Untitled';
      markDirty();
    });
    el.title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.title.blur(); } });

    /* ---------- status bar ---------- */
    function updateStatus() {
      config.updateStatus(el.editor.value);
      updateCaret();
    }
    function updateCaret() {
      const pos = el.editor.selectionStart;
      const upto = el.editor.value.slice(0, pos);
      const line = upto.split('\n').length;
      const col = pos - upto.lastIndexOf('\n');
      const node = $('#st-pos');
      if (node) node.textContent = 'Ln ' + line + ', Col ' + col;
    }

    /* ---------- editing primitives (undo-safe) ---------- */
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
      const s = ed.selectionStart, e = ed.selectionEnd, val = ed.value;
      const sel = val.slice(s, e);
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
      const ed = el.editor, val = ed.value, s = ed.selectionStart;
      const prefix = (s === 0 || val[s - 1] === '\n') ? '' : '\n';
      const body = prefix + text;
      setRange(s, ed.selectionEnd, body, s + body.length - (caretBack || 0));
    }

    function replaceAllText(text) {
      setRange(0, el.editor.value.length, text, 0, 0);
    }

    /* ---------- commands ----------
       Delegated from the whole app so a command button can sit wherever it
       makes sense — the editor toolbar, or the header of the pane it acts on. */
    el.app.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cmd]');
      if (!btn) return;
      if (btn.dataset.cmd === 'find') return toggleFind(true);
      const fn = config.commands[btn.dataset.cmd];
      if (fn) fn(api);
    });

    /* one-click copy of the current document */
    const btnCopy = $('#btn-copy');
    if (btnCopy) btnCopy.addEventListener('click', async () => {
      const ok = await copyText(el.editor.value);
      toast(ok ? 'Copied ' + config.ext.toUpperCase() + ' to the clipboard' : 'Copy failed');
    });

    /* ---------- editor keys ---------- */
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
          if (val.slice(ls, ls + 2) === '  ') setRange(ls, ls + 2, '', Math.max(ls, s - 2));
          else if (val[ls] === '\t') setRange(ls, ls + 1, '', Math.max(ls, s - 1));
        } else {
          setRange(s, e2, '  ');
        }
        return;
      }
      if (e.key === 'Escape' && !el.findbar.hidden) toggleFind(false);
      if (config.onKeydown) config.onKeydown(e, api);
    });

    ['keyup', 'click', 'select'].forEach((ev) => el.editor.addEventListener(ev, updateCaret));

    el.editor.addEventListener('input', () => {
      metricsDirty = true;
      buildMetrics();
      updateStatus();
      markDirty();
      scheduleRender();
    });

    /* ---------- find & replace ---------- */
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
    const updateFindCount = () => { el.findCount.textContent = (matchIdx + 1) + '/' + matches.length; };

    function gotoMatch(delta, move) {
      if (!matches.length) return;
      if (move) matchIdx = (matchIdx + delta + matches.length) % matches.length;
      const at = matches[matchIdx], len = el.findInput.value.length;
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
    function replaceOne() {
      if (matchIdx < 0 || !matches.length) return;
      const at = matches[matchIdx], len = el.findInput.value.length, keep = matchIdx;
      setRange(at, at + len, el.replInput.value);
      runFind();
      if (matches.length) { matchIdx = Math.min(keep, matches.length - 1); gotoMatch(0, false); }
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
    $('#replace-one').addEventListener('click', replaceOne);
    $('#replace-all').addEventListener('click', () => {
      const q = el.findInput.value;
      if (!q || !matches.length) return;
      const n = matches.length;
      const parts = el.editor.value.split(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'));
      replaceAllText(parts.join(el.replInput.value));
      runFind();
      toast('Replaced ' + n + (n === 1 ? ' match' : ' matches'));
    });

    /* ---------- layout ---------- */
    function setMode(mode) {
      prefs.mode = mode; savePrefs();
      el.app.classList.remove('mode-editor', 'mode-split', 'mode-preview');
      el.app.classList.add('mode-' + mode);
      $$('.vm').forEach((b) => b.classList.toggle('is-active', b.dataset.mode === mode));
      metricsDirty = true;
      requestAnimationFrame(buildMetrics);
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
      $$('.side-panel').forEach((p) => { p.hidden = p.id !== 'panel-' + tab.dataset.tab; });
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

    const pvWidth = $('#pv-width');
    if (pvWidth) pvWidth.addEventListener('change', (e) => {
      prefs.pvWidth = e.target.value; savePrefs();
      el.pvScroll.dataset.w = prefs.pvWidth;
    });

    window.addEventListener('resize', () => { metricsDirty = true; buildMetrics(); });

    /* ---------- import ---------- */
    function importFile(file) {
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { toast('That file is larger than 5 MB'); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const name = file.name.replace(/\.[^.]+$/, '');
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
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; el.dropOverlay.classList.remove('show'); } });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      dragDepth = 0; el.dropOverlay.classList.remove('show');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) importFile(f);
    });

    /* ---------- export ---------- */
    function previewHtmlForExport() {
      const clone = el.preview.cloneNode(true);
      clone.querySelectorAll('.anchor, .code-copy, .tree-toggle').forEach((n) => n.remove());
      clone.querySelectorAll('[data-line]').forEach((n) => n.removeAttribute('data-line'));
      clone.querySelectorAll('input[type="checkbox"]').forEach((n) => { n.setAttribute('disabled', ''); n.removeAttribute('data-task'); });
      return clone.innerHTML;
    }

    function exportSource() {
      const doc = currentDoc();
      download(safeFilename(doc && doc.title) + '.' + config.ext, config.mime, el.editor.value);
      toast(config.ext.toUpperCase() + ' file downloaded');
    }

    function exportHtml() {
      const doc = currentDoc();
      const title = (doc && doc.title) || 'Document';
      download(safeFilename(title) + '.html', 'text/html', config.htmlDocument(title, previewHtmlForExport()));
      toast('HTML file downloaded');
    }

    let titleBeforePrint = null;
    function exportPdf() {
      render();
      const doc = currentDoc();
      titleBeforePrint = document.title;
      document.title = safeFilename(doc && doc.title);
      setTimeout(() => window.print(), 60);
    }
    window.addEventListener('afterprint', () => {
      if (titleBeforePrint != null) { document.title = titleBeforePrint; titleBeforePrint = null; }
    });

    async function shareLink() {
      const url = location.origin + location.pathname + '#doc=' + encodeShare(el.editor.value);
      if (url.length > 30000) { toast('This document is too large for a share link — export a file instead'); return; }
      const ok = await copyText(url);
      toast(ok ? 'Share link copied (the document travels inside the link)' : 'Could not copy the link');
    }

    const exporters = {
      pdf: exportPdf,
      source: exportSource,
      html: exportHtml,
      'copy-source': async () => toast(await copyText(el.editor.value) ? 'Copied' : 'Copy failed'),
      'copy-html': async () => toast(await copyText(previewHtmlForExport()) ? 'HTML copied' : 'Copy failed'),
      share: shareLink
    };

    function closeMenus() {
      el.menuExport.hidden = true;
      $('#btn-export').setAttribute('aria-expanded', 'false');
    }
    el.menuExport.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-export]');
      if (!btn) return;
      closeMenus();
      const fn = exporters[btn.dataset.export] || (config.exporters && config.exporters[btn.dataset.export]);
      if (fn) fn(api);
    });
    $('#btn-export').addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = el.menuExport.hidden;
      closeMenus();
      if (willOpen) { el.menuExport.hidden = false; $('#btn-export').setAttribute('aria-expanded', 'true'); }
    });
    document.addEventListener('click', closeMenus);
    const btnPdf = $('#btn-pdf');
    if (btnPdf) btnPdf.addEventListener('click', exportPdf);

    /* ---------- help ---------- */
    const showHelp = (on) => { el.modalHelp.hidden = !on; };
    $('#btn-help').addEventListener('click', () => showHelp(true));
    el.modalHelp.addEventListener('click', (e) => {
      if (e.target === el.modalHelp || e.target.closest('[data-close]')) showHelp(false);
    });

    /* ---------- shortcuts ---------- */
    document.addEventListener('keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Escape') { closeMenus(); showHelp(false); if (!el.findbar.hidden) toggleFind(false); return; }
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'p') { e.preventDefault(); exportPdf(); return; }
      if (k === 's') { e.preventDefault(); saveNow(); exportSource(); return; }
      if (k === 'f') { e.preventDefault(); toggleFind(true); return; }
      if (k === '\\') { e.preventDefault(); setSidebar(!prefs.sidebar); return; }
      if (k === '1') { e.preventDefault(); setMode('editor'); return; }
      if (k === '2') { e.preventDefault(); setMode('split'); return; }
      if (k === '3') { e.preventDefault(); setMode('preview'); return; }
      if (document.activeElement !== el.editor) return;
      if (config.shortcuts && config.shortcuts[k]) { e.preventDefault(); config.shortcuts[k](api); }
    });

    window.addEventListener('beforeunload', saveNow);
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

    /* ---------- the object tools are handed ---------- */
    const api = {
      el, setRange, surround, prefixLines, insertBlock, lineBounds, replaceAllText,
      render, scheduleRender, toast, escapeHtml, loadScript, copyText, download,
      effectiveTheme, onTheme, scrollEditorToLine, safeFilename,
      get source() { return el.editor.value; },
      currentDoc, newDoc
    };

    /* ---------- boot ---------- */
    setMode(prefs.mode || 'split');
    setSidebar(prefs.sidebar !== false);
    el.editorPane.style.flexBasis = (prefs.split || 50) + '%';
    el.pvScroll.dataset.w = prefs.pvWidth || 'normal';
    if (pvWidth) pvWidth.value = prefs.pvWidth || 'normal';
    if (el.btnSync) el.btnSync.setAttribute('aria-pressed', String(prefs.sync !== false));
    initTheme();

    const hash = location.hash || '';
    const shared = hash.indexOf('#doc=') === 0 ? hash.slice(5) : null;
    let booted = false;

    if (shared) {
      let text = '';
      try { text = decodeShare(shared); } catch (e) { text = ''; }
      history.replaceState(null, '', location.pathname);
      if (text) { newDoc(text, 'Shared document', true); toast('Opened a shared document'); booted = true; }
    }

    if (!booted) {
      if (!docs.length) {
        const sample = $('#sample-doc');
        newDoc(sample ? sample.textContent.trim() + '\n' : config.blank, config.sampleTitle, true);
      } else {
        openDoc((docs.find((d) => d.id === activeId) || docs[0]).id, true);
      }
    }

    updateStatus();
    renderDocList();
    metricsDirty = true;
    buildMetrics();
    render();

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register(config.swPath || 'sw.js').catch(() => {});
      });
    }

    return api;
  }

  return {
    $: $, $$: $$, create, toast, escapeHtml, download, copyText, loadScript,
    lsGet, lsSet, effectiveTheme, onTheme, initTheme, safeFilename, relTime
  };
})();
