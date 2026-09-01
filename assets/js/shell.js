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


  /* ---------- tooltips ----------
     Native title= waits about a second and cannot escape an overflow:auto
     ancestor, which is exactly where the toolbar buttons live. One fixed
     element, delegated, so it also covers controls rendered later. */
  function initTooltips() {
    if (!document.body || document.getElementById('shell-tip')) return;
    const tip = document.createElement('div');
    tip.id = 'shell-tip';
    tip.className = 'tip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);

    let timer = null, current = null;

    function place(el) {
      tip.textContent = el.getAttribute('data-tip') || '';
      if (!tip.textContent) return;
      tip.style.visibility = 'hidden';
      tip.classList.add('show');
      const r = el.getBoundingClientRect();
      const t = tip.getBoundingClientRect();
      let left = r.left + r.width / 2 - t.width / 2;
      left = Math.max(6, Math.min(left, window.innerWidth - t.width - 6));
      let top = r.bottom + 7;
      if (top + t.height > window.innerHeight - 6) top = r.top - t.height - 7;
      tip.style.left = Math.round(left) + 'px';
      tip.style.top = Math.round(top) + 'px';
      tip.style.visibility = '';
    }
    function hide() {
      clearTimeout(timer);
      current = null;
      tip.classList.remove('show');
    }

    document.addEventListener('mouseover', (e) => {
      const el = e.target.closest && e.target.closest('[data-tip]');
      if (!el || el === current) return;
      current = el;
      clearTimeout(timer);
      timer = setTimeout(() => { if (current === el) place(el); }, 200);
    });
    document.addEventListener('mouseout', (e) => {
      const el = e.target.closest && e.target.closest('[data-tip]');
      if (el && el === current) hide();
    });
    document.addEventListener('focusin', (e) => {
      const el = e.target.closest && e.target.closest('[data-tip]');
      if (!el) return;
      current = el;
      place(el);
    });
    document.addEventListener('focusout', hide);
    document.addEventListener('click', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initTooltips);
  else initTooltips();


  /* ---------- header menus ----------
     Right-aligned to their button, which puts a menu near the left of the
     bar off the edge of the screen, so clamp after opening. */
  function closeMenus() {
    $$('.menu').forEach((m) => {
      m.hidden = true;
      const btn = m.parentElement.querySelector('button[aria-haspopup]');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
  }

  function positionMenu(menu, btn) {
    menu.style.left = '';
    menu.style.right = '';
    menu.style.maxHeight = '';
    const wrap = btn.parentElement.getBoundingClientRect();
    const margin = 8;
    const width = menu.offsetWidth;
    let left = wrap.right - width;
    if (left + width > window.innerWidth - margin) left = window.innerWidth - margin - width;
    if (left < margin) left = margin;
    menu.style.left = (left - wrap.left) + 'px';
    menu.style.right = 'auto';
    const room = window.innerHeight - menu.getBoundingClientRect().top - margin;
    if (menu.offsetHeight > room) {
      menu.style.maxHeight = Math.max(160, room) + 'px';
      menu.style.overflowY = 'auto';
    }
  }

  let menusReady = false;
  function initMenus() {
    if (menusReady) return;
    menusReady = true;
    $$('.menu-wrap > button[aria-haspopup]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = btn.parentElement.querySelector('.menu');
        const willOpen = menu.hidden;
        closeMenus();
        if (willOpen) {
          menu.hidden = false;
          btn.setAttribute('aria-expanded', 'true');
          positionMenu(menu, btn);
        }
      });
    });
    document.addEventListener('click', closeMenus);
    window.addEventListener('resize', closeMenus);
  }


  /* ---------- cross-tool handoff ----------
     Passing the buffer through sessionStorage means a tool can send its
     output to another without either of them knowing about the other. */
  const HANDOFF = 'inkwell.handoff';

  function sendTo(slug, text, from) {
    try { sessionStorage.setItem(HANDOFF, JSON.stringify({ text, to: slug, from })); }
    catch (e) { toast('Could not hand that over'); return; }
    location.href = '../' + slug + '/';
  }

  function takeHandoff(tool) {
    try {
      const raw = sessionStorage.getItem(HANDOFF);
      if (!raw) return null;
      const h = JSON.parse(raw);
      if (!h || h.to !== tool) return null;
      sessionStorage.removeItem(HANDOFF);
      return h;
    } catch (e) { return null; }
  }

  /* ---------- command palette ----------
     Everything it offers is scraped from the page, so it can never drift
     out of step with the buttons that are actually there. */
  let palette = null;

  function buildPalette() {
    if (palette) return palette;
    const wrap = document.createElement('div');
    wrap.className = 'palette';
    wrap.hidden = true;
    wrap.innerHTML =
      '<div class="palette-box" role="dialog" aria-modal="true" aria-label="Command palette">' +
      '<input class="palette-input" placeholder="Search tools and commands…" aria-label="Search tools and commands" spellcheck="false">' +
      '<ul class="palette-list" role="listbox"></ul>' +
      '<div class="palette-foot"><kbd>↑</kbd><kbd>↓</kbd> to move · <kbd>Enter</kbd> to run · <kbd>Esc</kbd> to close</div>' +
      '</div>';
    document.body.appendChild(wrap);
    palette = {
      wrap, input: wrap.querySelector('.palette-input'), list: wrap.querySelector('.palette-list'),
      items: [], filtered: [], index: 0
    };

    palette.input.addEventListener('input', () => filterPalette());
    palette.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closePalette(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); runPaletteItem(palette.filtered[palette.index]); }
    });
    wrap.addEventListener('click', (e) => { if (e.target === wrap) closePalette(); });
    palette.list.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-i]');
      if (li) runPaletteItem(palette.filtered[+li.dataset.i]);
    });
    return palette;
  }

  const labelOf = (el) =>
    el.getAttribute('data-tip') || el.getAttribute('aria-label') || el.textContent.trim();

  function collectItems() {
    const items = [];
    $$('#menu-tools a').forEach((a) => {
      const name = a.querySelector('.tool-name');
      if (!name) return;
      items.push({
        kind: 'Go to', label: name.textContent.trim(),
        hint: (a.querySelector('.tool-blurb') || {}).textContent || '',
        current: a.classList.contains('is-current'),
        run: () => { location.href = a.getAttribute('href'); }
      });
    });
    $$('[data-cmd]').forEach((el) => {
      const label = labelOf(el);
      if (!label) return;
      items.push({ kind: 'Command', label, hint: '', run: () => el.click() });
    });
    $$('[data-export]').forEach((el) => {
      const label = labelOf(el).replace(/Ctrl [A-Z]$/, '').trim();
      if (!label) return;
      items.push({ kind: 'Export', label, hint: '', run: () => el.click() });
    });
    const theme = $('#btn-theme'), help = $('#btn-help');
    if (theme) items.push({ kind: 'Command', label: 'Toggle theme', hint: '', run: () => theme.click() });
    if (help) items.push({ kind: 'Command', label: 'Open help', hint: '', run: () => help.click() });
    return items;
  }

  /* subsequence match, so "sk" finds "Sort keys" */
  function score(query, text) {
    if (!query) return 1;
    const q = query.toLowerCase(), t = text.toLowerCase();
    const direct = t.indexOf(q);
    if (direct === 0) return 1000;
    if (direct > 0) return 500 - direct;
    let qi = 0, hits = 0;
    for (let i = 0; i < t.length && qi < q.length; i++) {
      if (t[i] === q[qi]) { qi++; hits++; }
    }
    return qi === q.length ? 100 + hits : 0;
  }

  function filterPalette() {
    const p = palette;
    const q = p.input.value.trim();
    p.filtered = p.items
      .map((it) => ({
        it,
        s: Math.max(
          score(q, it.label),
          score(q, it.kind + ' ' + it.label) - 20,
          it.hint ? score(q, it.hint) - 40 : 0      /* "hex" should find the Base tool */
        )
      }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map((x) => x.it);
    p.index = 0;
    drawPalette();
  }

  function drawPalette() {
    const p = palette;
    if (!p.filtered.length) {
      p.list.innerHTML = '<li class="palette-empty">Nothing matches.</li>';
      return;
    }
    p.list.innerHTML = p.filtered.map((it, i) =>
      '<li data-i="' + i + '" role="option"' + (i === p.index ? ' class="is-active" aria-selected="true"' : '') + '>' +
      '<span class="palette-kind">' + escapeHtml(it.kind) + '</span>' +
      '<span class="palette-label">' + escapeHtml(it.label) + '</span>' +
      (it.current ? '<span class="palette-hint">current</span>'
                  : it.hint ? '<span class="palette-hint">' + escapeHtml(it.hint) + '</span>' : '') +
      '</li>').join('');
    const active = p.list.querySelector('.is-active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function move(d) {
    const p = palette;
    if (!p.filtered.length) return;
    p.index = (p.index + d + p.filtered.length) % p.filtered.length;
    drawPalette();
  }

  function runPaletteItem(item) {
    if (!item) return;
    closePalette();
    setTimeout(() => item.run(), 0);
  }

  function openPalette() {
    const p = buildPalette();
    closeMenus();
    p.items = collectItems();
    p.input.value = '';
    p.wrap.hidden = false;
    filterPalette();
    p.input.focus();
  }
  function closePalette() {
    if (palette) palette.wrap.hidden = true;
  }

  function initPalette() {
    document.addEventListener('keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return;
      /* the Markdown editor uses Ctrl+K for links, so leave it alone there */
      const ed = document.getElementById('editor');
      if (ed && document.activeElement === ed && /\/markdown\//.test(location.pathname)) return;
      e.preventDefault();
      openPalette();
    });
  }


  /* Every tool inherits the same navigation and export keys, so the list
     lives here rather than being copied into fifteen help modals. */
  const UNIVERSAL = [
    ['Ctrl/⌘ K', 'Search every tool and command'],
    ['Ctrl/⌘ F', 'Find and replace'],
    ['Ctrl/⌘ S', 'Download the document'],
    ['Ctrl/⌘ P', 'Export as PDF'],
    ['Ctrl/⌘ 1 2 3', 'Editor / split / result'],
    ['Ctrl/⌘ \\', 'Show or hide the sidebar'],
    ['Esc', 'Close a menu, dialog or the find bar']
  ];

  function injectUniversalHelp() {
    const body = $('.modal-body');
    if (!body || $('.help-universal')) return;
    const sec = document.createElement('section');
    sec.className = 'help-universal';
    sec.innerHTML = '<h3>The same everywhere</h3><table class="kbd-table">' +
      UNIVERSAL.map((r) => '<tr><td><kbd>' + r[0] + '</kbd></td><td>' + r[1] + '</td></tr>').join('') +
      '</table>';
    const foot = $('.help-foot');
    if (foot) body.insertBefore(sec, foot);
    else body.appendChild(sec);
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
      { mode: 'split', sidebar: true, split: 50, sync: true, pvWidth: 'normal', controls: {} },
      lsGet(LS.prefs, {})
    );
    if (!prefs.controls) prefs.controls = {};
    const savePrefs = () => lsSet(LS.prefs, prefs);

    /* Any control marked data-remember keeps its value between visits.
       Deliberately not applied to passphrases, HMAC keys or JWT secrets. */
    function initControls() {
      $$('[data-remember]').forEach((node) => {
        const key = node.id || node.getAttribute('data-remember');
        const saved = prefs.controls[key];
        if (saved !== undefined && saved !== null) {
          if (node.type === 'checkbox') node.checked = !!saved;
          else node.value = saved;
        }
        const save = () => {
          prefs.controls[key] = node.type === 'checkbox' ? node.checked : node.value;
          savePrefs();
        };
        node.addEventListener('change', save);
        node.addEventListener('input', save);
      });
    }

    /* A tool handling credentials (see the JWT page) opts out of persistence:
       its documents live in memory for the session and are never written to disk. */
    const persist = config.persist !== false;
    const saveDocs = () => { if (persist) lsSet(LS.docs, docs); };
    const saveActive = () => { if (persist) lsSet(LS.active, activeId); };

    let docs = persist ? lsGet(LS.docs, []) : [];
    let activeId = persist ? lsGet(LS.active, null) : null;

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
      offerExample();
      el.pvScroll.scrollTop = keepTop;
    }

    /* An empty result panel is where someone new is looking, so put the
       example there rather than only in the toolbar. */
    function offerExample() {
      if (el.editor.value.trim()) return;
      const empty = $('#preview .j-empty');
      const sample = $('#sample-doc');
      if (!empty || !sample || !sample.textContent.trim() || $('#preview .try-example')) return;
      const btn = document.createElement('button');
      btn.className = 'mini try-example';
      btn.type = 'button';
      btn.textContent = 'Load an example';
      btn.addEventListener('click', loadExample);
      empty.appendChild(document.createElement('br'));
      empty.appendChild(btn);
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
      saveDocs();
      saveActive();
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
          '<button class="doc-del" data-tip="Delete this document" aria-label="Delete this document"><svg class="ico"><use href="#i-trash"/></svg></button>';
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
      saveActive();
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
      saveDocs();
      openDoc(doc.id, true);
      saveNow();
      return doc;
    }

    function removeDoc(id) {
      const doc = docs.find((d) => d.id === id);
      if (!doc) return;
      if (!confirm('Delete “' + (doc.title || 'Untitled') + '”? This cannot be undone.')) return;
      docs = docs.filter((d) => d.id !== id);
      saveDocs();
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
      if (btn.dataset.cmd === 'example') return loadExample();
      const fn = config.commands[btn.dataset.cmd];
      if (fn) fn(api);
    });

    initMenus();
    initPalette();
    injectUniversalHelp();
    initExampleButton();
    initOptionRows();
    recordVisit();
    initControls();

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

    const NARROW = () => window.innerWidth <= 760;

    function setSidebar(on, remember) {
      if (remember !== false) { prefs.sidebar = on; savePrefs(); }
      el.app.classList.toggle('no-sidebar', !on);
      metricsDirty = true;
      requestAnimationFrame(buildMetrics);
    }
    $('#btn-sidebar').addEventListener('click', () => setSidebar(el.app.classList.contains('no-sidebar')));

    /* on a phone the sidebar floats over the editor, so tapping away closes it */
    el.app.addEventListener('click', (e) => {
      if (!NARROW() || el.app.classList.contains('no-sidebar')) return;
      if (e.target.closest('#sidebar') || e.target.closest('#btn-sidebar')) return;
      setSidebar(false, false);
    });

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
      if (config.onFile) return config.onFile(file, api);   /* e.g. hashing wants bytes, not text */
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

    /* "Send to" is appended to the export menu at runtime, so no page
       needs to know which other tools exist. */
    const SEND_DEFAULT = ['diff', 'hash', 'escape', 'text'];
    const SEND_EXTRA = {
      json: ['csv', 'yaml', 'xml'], yaml: ['json'], xml: ['json'], csv: ['json'],
      markdown: ['text'], text: ['diff'], escape: ['hash'], hash: ['escape']
    };
    const SEND_NAME = {
      diff: 'Diff', hash: 'Hash', escape: 'Escape', text: 'Text utilities',
      csv: 'CSV', yaml: 'YAML', json: 'JSON', xml: 'XML'
    };

    function buildSendMenu() {
      const targets = (SEND_EXTRA[TOOL] || []).concat(SEND_DEFAULT)
        .filter((t, i, arr) => t !== TOOL && arr.indexOf(t) === i);
      if (!targets.length || config.sendTo === false) return;
      const hr = document.createElement('hr');
      el.menuExport.appendChild(hr);
      targets.forEach((t) => {
        const b = document.createElement('button');
        b.setAttribute('role', 'menuitem');
        b.innerHTML = '<svg class="ico"><use href="#i-share"/></svg>Send to ' + (SEND_NAME[t] || t);
        b.addEventListener('click', () => {
          closeMenus();
          let payload = el.editor.value;
          if (config.payloadFor) {
            try { payload = config.payloadFor(t, payload, api) || payload; } catch (err) { /* send as-is */ }
          }
          sendTo(t, payload, TOOL);
        });
        el.menuExport.appendChild(b);
      });
    }

    const exporters = {
      pdf: exportPdf,
      source: exportSource,
      html: exportHtml,
      'copy-source': async () => toast(await copyText(el.editor.value) ? 'Copied' : 'Copy failed'),
      'copy-html': async () => toast(await copyText(previewHtmlForExport()) ? 'HTML copied' : 'Copy failed'),
      share: shareLink
    };

    el.menuExport.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-export]');
      if (!btn) return;
      closeMenus();
      const fn = exporters[btn.dataset.export] || (config.exporters && config.exporters[btn.dataset.export]);
      if (fn) fn(api);
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
      /* Ctrl+B focuses the tool's main control when it has one and no
         other meaning — regex pattern, contrast background, and so on */
      if (k === 'b' && config.focusControl && !(config.shortcuts && config.shortcuts.b)) {
        const node = $(config.focusControl);
        if (node) { e.preventDefault(); node.focus(); node.select && node.select(); return; }
      }
      if (document.activeElement !== el.editor) return;
      if (config.shortcuts && config.shortcuts[k]) { e.preventDefault(); config.shortcuts[k](api); }
    });

    window.addEventListener('beforeunload', saveNow);
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });


    /* On a phone three stacked control rows leave no room for the result,
       so everything after the first goes behind an Options toggle. */
    function initOptionRows() {
      const rows = $$('.preview-pane .gbar, .preview-pane .qbar, .editor-pane .gbar');
      if (rows.length < 2) return;
      rows.slice(1).forEach((r) => r.classList.add('gbar-extra'));
      const btn = document.createElement('button');
      btn.className = 'mini options-toggle';
      btn.type = 'button';
      btn.textContent = 'Options';
      btn.setAttribute('data-tip', 'Show the other controls');
      btn.setAttribute('aria-label', 'Show the other controls');
      btn.addEventListener('click', () => {
        const on = el.app.classList.toggle('show-options');
        btn.textContent = on ? 'Fewer' : 'Options';
      });
      rows[0].appendChild(btn);
    }

    /* Every tool ships a sample document; make it reachable after the
       first visit, when the editor is empty and the panel says nothing. */
    function initExampleButton() {
      const sample = $('#sample-doc');
      const toolbar = $('#toolbar');
      if (!sample || !toolbar || !sample.textContent.trim()) return;
      const btn = document.createElement('button');
      btn.className = 'tb';
      btn.type = 'button';
      btn.setAttribute('data-cmd', 'example');
      btn.setAttribute('data-tip', 'Load the example');
      btn.setAttribute('aria-label', 'Load the example');
      btn.innerHTML = '<svg class="ico"><use href="#i-help"/></svg>';
      toolbar.appendChild(btn);
    }

    function loadExample() {
      const sample = $('#sample-doc');
      if (!sample) return;
      replaceAllText(sample.textContent.trim() + '\n');
      toast('Example loaded');
    }

    function recordVisit() {
      try {
        const list = lsGet('inkwell.recent', []).filter((x) => x.tool !== TOOL);
        list.unshift({ tool: TOOL, at: Date.now() });
        lsSet('inkwell.recent', list.slice(0, 6));
      } catch (e) { /* not important enough to fail over */ }
    }

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
    /* don't let a phone visit overwrite the desktop preference */
    setSidebar(prefs.sidebar !== false && !NARROW(), !NARROW());
    el.editorPane.style.flexBasis = (prefs.split || 50) + '%';
    el.pvScroll.dataset.w = prefs.pvWidth || 'normal';
    if (pvWidth) pvWidth.value = prefs.pvWidth || 'normal';
    if (el.btnSync) el.btnSync.setAttribute('aria-pressed', String(prefs.sync !== false));
    initTheme();

    buildSendMenu();

    const incoming = takeHandoff(TOOL);
    const hash = location.hash || '';
    const shared = hash.indexOf('#doc=') === 0 ? hash.slice(5) : null;
    let booted = false;

    if (shared) {
      let text = '';
      try { text = decodeShare(shared); } catch (e) { text = ''; }
      history.replaceState(null, '', location.pathname);
      if (text) { newDoc(text, 'Shared document', true); toast('Opened a shared document'); booted = true; }
    }

    if (!booted && incoming) {
      let text = incoming.text;
      let note = '';
      if (config.onHandoff) {
        try {
          const r = config.onHandoff(text, incoming.from);
          if (r && typeof r === 'object') { text = r.text != null ? r.text : text; note = r.note || ''; }
          else if (typeof r === 'string') text = r;
        } catch (e) { /* keep the original text */ }
      }
      const label = SEND_NAME[incoming.from] || incoming.from || 'another tool';
      newDoc(text, 'From ' + label, true);
      toast(note || ('Brought over from ' + label));
      booted = true;
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
    lsGet, lsSet, effectiveTheme, onTheme, initTheme, safeFilename, relTime, initTooltips,
    initMenus, closeMenus, encodeShare, decodeShare, initPalette, openPalette, sendTo, takeHandoff, injectUniversalHelp
  };
})();
