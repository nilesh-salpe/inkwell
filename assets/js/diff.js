/* ============================================================
   Diff viewer — line diff with word-level detail inside changed
   lines. Myers' algorithm, with common prefix and suffix trimmed
   first so typical edits stay cheap.
   ============================================================ */
(function () {
  'use strict';

  const $ = Shell.$;
  const escapeHtml = Shell.escapeHtml;
  const MAX_D = 2000;          /* give up rather than allocate a huge trace */

  const els = {
    a: $('#d-a'), b: $('#d-b'), out: $('#d-out'),
    ws: $('#d-ws'), ci: $('#d-ci'), view: $('#d-view'),
    stat: $('#d-stat')
  };

  /* ---------- Myers ---------- */
  function myers(a, b) {
    const N = a.length, M = b.length;
    const MAX = N + M;
    if (MAX === 0) return [];
    const off = MAX;
    const v = new Int32Array(2 * MAX + 2);
    const trace = [];
    for (let d = 0; d <= MAX && d <= MAX_D; d++) {
      trace.push(v.slice());
      for (let k = -d; k <= d; k += 2) {
        let x;
        if (k === -d || (k !== d && v[k - 1 + off] < v[k + 1 + off])) x = v[k + 1 + off];
        else x = v[k - 1 + off] + 1;
        let y = x - k;
        while (x < N && y < M && a[x] === b[y]) { x++; y++; }
        v[k + off] = x;
        if (x >= N && y >= M) return backtrack(trace, a, b, d, off);
      }
    }
    return null;                /* too different to diff within the cap */
  }

  function backtrack(trace, a, b, d, off) {
    const ops = [];
    let x = a.length, y = b.length;
    for (let step = d; step > 0; step--) {
      const v = trace[step];
      const k = x - y;
      let prevK;
      if (k === -step || (k !== step && v[k - 1 + off] < v[k + 1 + off])) prevK = k + 1;
      else prevK = k - 1;
      const prevX = v[prevK + off];
      const prevY = prevX - prevK;
      while (x > prevX && y > prevY) { ops.push({ t: 'eq', a: --x, b: --y }); }
      if (step > 0) {
        if (x === prevX) ops.push({ t: 'ins', b: --y });
        else ops.push({ t: 'del', a: --x });
      }
    }
    while (x > 0 && y > 0) ops.push({ t: 'eq', a: --x, b: --y });
    while (x > 0) ops.push({ t: 'del', a: --x });
    while (y > 0) ops.push({ t: 'ins', b: --y });
    return ops.reverse();
  }

  /* ---------- line diff with prefix/suffix trimming ---------- */
  function diffLines(aLines, bLines, norm) {
    const A = aLines.map(norm), B = bLines.map(norm);
    let head = 0;
    while (head < A.length && head < B.length && A[head] === B[head]) head++;
    let tail = 0;
    while (tail < A.length - head && tail < B.length - head &&
           A[A.length - 1 - tail] === B[B.length - 1 - tail]) tail++;

    const midA = A.slice(head, A.length - tail);
    const midB = B.slice(head, B.length - tail);
    const mid = myers(midA, midB);
    if (mid === null) return null;

    const ops = [];
    for (let i = 0; i < head; i++) ops.push({ t: 'eq', a: i, b: i });
    mid.forEach((o) => ops.push({
      t: o.t,
      a: o.a === undefined ? undefined : o.a + head,
      b: o.b === undefined ? undefined : o.b + head
    }));
    for (let i = 0; i < tail; i++) {
      ops.push({ t: 'eq', a: A.length - tail + i, b: B.length - tail + i });
    }
    return ops;
  }

  /* ---------- word-level detail ---------- */
  const tokenise = (s) => s.match(/\s+|[^\s]+/g) || [];

  function inlineDiff(oldLine, newLine) {
    const a = tokenise(oldLine), b = tokenise(newLine);
    if (a.length + b.length > 400) return null;
    const ops = myers(a, b);
    if (!ops) return null;
    let left = '', right = '';
    ops.forEach((o) => {
      if (o.t === 'eq') { left += escapeHtml(a[o.a]); right += escapeHtml(b[o.b]); }
      else if (o.t === 'del') left += '<span class="d-word-del">' + escapeHtml(a[o.a]) + '</span>';
      else right += '<span class="d-word-ins">' + escapeHtml(b[o.b]) + '</span>';
    });
    return { left, right };
  }

  /* pair up a run of deletions with the following run of insertions */
  function group(ops) {
    const rows = [];
    let i = 0;
    while (i < ops.length) {
      const o = ops[i];
      if (o.t === 'eq') { rows.push({ t: 'eq', a: o.a, b: o.b }); i++; continue; }
      const dels = [], ins = [];
      while (i < ops.length && ops[i].t === 'del') dels.push(ops[i++].a);
      while (i < ops.length && ops[i].t === 'ins') ins.push(ops[i++].b);
      const n = Math.max(dels.length, ins.length);
      for (let j = 0; j < n; j++) {
        rows.push({
          t: dels[j] !== undefined && ins[j] !== undefined ? 'mod' : (dels[j] !== undefined ? 'del' : 'ins'),
          a: dels[j], b: ins[j]
        });
      }
    }
    return rows;
  }

  /* ---------- rendering ---------- */
  function render() {
    const aRaw = els.a.value, bRaw = els.b.value;
    const aLines = aRaw.split('\n'), bLines = bRaw.split('\n');

    const ignoreWs = els.ws.checked, ignoreCase = els.ci.checked;
    const norm = (l) => {
      let s = l;
      if (ignoreWs) s = s.replace(/\s+/g, ' ').trim();
      if (ignoreCase) s = s.toLowerCase();
      return s;
    };

    if (!aRaw && !bRaw) {
      els.out.innerHTML = '<p class="j-empty">Paste the original on the left and the changed version on the right.</p>';
      els.stat.textContent = '';
      return;
    }

    const ops = diffLines(aLines, bLines, norm);
    if (ops === null) {
      els.out.innerHTML = '<div class="csv-note">These two are too different to align line by line ' +
        '(more than ' + MAX_D.toLocaleString() + ' edits). Diff smaller sections.</div>';
      els.stat.textContent = 'too different';
      return;
    }

    const rows = group(ops);
    let added = 0, removed = 0, changed = 0;
    rows.forEach((r) => {
      if (r.t === 'ins') added++;
      else if (r.t === 'del') removed++;
      else if (r.t === 'mod') { added++; removed++; changed++; }
    });

    els.stat.innerHTML = removed || added
      ? '<span class="d-plus">+' + added + '</span> <span class="d-minus">−' + removed + '</span>' +
        (changed ? ' <span class="d-mod">' + changed + ' changed</span>' : '')
      : '<span class="d-same">identical</span>';

    els.out.innerHTML = els.view.value === 'unified'
      ? unified(rows, aLines, bLines)
      : sideBySide(rows, aLines, bLines);
  }

  const num = (n) => '<td class="d-num">' + (n === undefined ? '' : n + 1) + '</td>';

  function sideBySide(rows, aLines, bLines) {
    let html = '<table class="d-table d-split"><tbody>';
    rows.forEach((r) => {
      if (r.t === 'eq') {
        html += '<tr>' + num(r.a) + '<td class="d-line">' + escapeHtml(aLines[r.a]) + '</td>' +
          num(r.b) + '<td class="d-line">' + escapeHtml(bLines[r.b]) + '</td></tr>';
        return;
      }
      if (r.t === 'mod') {
        const inl = inlineDiff(aLines[r.a], bLines[r.b]);
        html += '<tr>' + num(r.a) + '<td class="d-line is-del">' +
          (inl ? inl.left : escapeHtml(aLines[r.a])) + '</td>' +
          num(r.b) + '<td class="d-line is-ins">' + (inl ? inl.right : escapeHtml(bLines[r.b])) + '</td></tr>';
        return;
      }
      if (r.t === 'del') {
        html += '<tr>' + num(r.a) + '<td class="d-line is-del">' + escapeHtml(aLines[r.a]) + '</td>' +
          '<td class="d-num"></td><td class="d-line is-blank"></td></tr>';
        return;
      }
      html += '<td class="d-num"></td><td class="d-line is-blank"></td>'.replace(/^/, '<tr>') +
        num(r.b) + '<td class="d-line is-ins">' + escapeHtml(bLines[r.b]) + '</td></tr>';
    });
    return html + '</tbody></table>';
  }

  function unified(rows, aLines, bLines) {
    let html = '<table class="d-table"><tbody>';
    rows.forEach((r) => {
      if (r.t === 'eq') {
        html += '<tr>' + num(r.a) + num(r.b) + '<td class="d-sign"> </td><td class="d-line">' +
          escapeHtml(aLines[r.a]) + '</td></tr>';
      } else if (r.t === 'mod') {
        const inl = inlineDiff(aLines[r.a], bLines[r.b]);
        html += '<tr>' + num(r.a) + '<td class="d-num"></td><td class="d-sign is-del">−</td>' +
          '<td class="d-line is-del">' + (inl ? inl.left : escapeHtml(aLines[r.a])) + '</td></tr>';
        html += '<tr><td class="d-num"></td>' + num(r.b) + '<td class="d-sign is-ins">+</td>' +
          '<td class="d-line is-ins">' + (inl ? inl.right : escapeHtml(bLines[r.b])) + '</td></tr>';
      } else if (r.t === 'del') {
        html += '<tr>' + num(r.a) + '<td class="d-num"></td><td class="d-sign is-del">−</td>' +
          '<td class="d-line is-del">' + escapeHtml(aLines[r.a]) + '</td></tr>';
      } else {
        html += '<tr><td class="d-num"></td>' + num(r.b) + '<td class="d-sign is-ins">+</td>' +
          '<td class="d-line is-ins">' + escapeHtml(bLines[r.b]) + '</td></tr>';
      }
    });
    return html + '</tbody></table>';
  }

  /* ---------- wiring ---------- */
  let t = null;
  const bump = () => { clearTimeout(t); t = setTimeout(render, 180); };
  [els.a, els.b].forEach((n) => n.addEventListener('input', bump));
  [els.ws, els.ci, els.view].forEach((n) => n.addEventListener('change', render));

  $('#d-swap').addEventListener('click', () => {
    const tmp = els.a.value; els.a.value = els.b.value; els.b.value = tmp;
    render();
    Shell.toast('Swapped sides');
  });
  $('#d-clear').addEventListener('click', () => {
    els.a.value = ''; els.b.value = ''; render(); els.a.focus();
  });
  $('#d-copy').addEventListener('click', async () => {
    Shell.toast(await Shell.copyText(els.out.textContent.trim()) ? 'Copied the diff' : 'Copy failed');
  });
  $('#btn-print').addEventListener('click', () => window.print());

  /* drop a file onto either side */
  [els.a, els.b].forEach((box) => {
    box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('is-drop'); });
    box.addEventListener('dragleave', () => box.classList.remove('is-drop'));
    box.addEventListener('drop', (e) => {
      e.preventDefault();
      box.classList.remove('is-drop');
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => { box.value = String(r.result); render(); };
      r.readAsText(f);
    });
  });

  Shell.initTheme();
  Shell.initMenus();
  render();

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('../sw.js').catch(() => {}));
  }
})();
