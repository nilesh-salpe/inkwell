/* ============================================================
   Shared data tools — the tree renderer, structure statistics
   and the JSONPath engine. Used by both the JSON and the YAML
   pages, which differ only in how they turn text into a value.
   ============================================================ */
window.DataTools = (function () {
  'use strict';

  const escapeHtml = Shell.escapeHtml;
  const MAX_NODES = 20000;

  /* ---------- statistics ---------- */
  function inspect(value) {
    let keys = 0, nodes = 0, depth = 0, arrays = 0;
    (function walk(v, d) {
      nodes++;
      if (d > depth) depth = d;
      if (Array.isArray(v)) { arrays++; v.forEach((x) => walk(x, d + 1)); }
      else if (v && typeof v === 'object') {
        const k = Object.keys(v);
        keys += k.length;
        k.forEach((key) => walk(v[key], d + 1));
      }
    })(value, 1);
    return { keys, nodes, depth, arrays };
  }


  /* ============================================================
     JSONPath — supports $ . .. * [n] [n,m] [start:end] ['key']
     and filters such as [?(@.price < 10)] or [?(@.isbn)]
     ============================================================ */
  function parsePath(expr) {
    const steps = [];
    let i = 0;
    const src = expr.trim().replace(/^\$/, '');
    const n = src.length;
    while (i < n) {
      if (src[i] === '.' && src[i + 1] === '.') {
        i += 2;
        if (src[i] === '*') { steps.push({ deep: true, kind: 'wild' }); i++; continue; }
        if (src[i] === '[') { steps.push({ deep: true, kind: 'self' }); continue; }
        const m = src.slice(i).match(/^[^.[\]]+/);
        if (!m) throw new Error('Expected a name after ".."');
        steps.push({ deep: true, kind: 'name', name: m[0] });
        i += m[0].length;
        continue;
      }
      if (src[i] === '.') {
        i++;
        if (src[i] === '*') { steps.push({ kind: 'wild' }); i++; continue; }
        const m = src.slice(i).match(/^[^.[\]]+/);
        if (!m) throw new Error('Expected a name after "."');
        steps.push({ kind: 'name', name: m[0] });
        i += m[0].length;
        continue;
      }
      if (src[i] === '[') {
        const close = matchBracket(src, i);
        if (close === -1) throw new Error('Unclosed "["');
        const inner = src.slice(i + 1, close).trim();
        i = close + 1;
        if (inner === '*') { steps.push({ kind: 'wild' }); continue; }
        if (inner.startsWith('?')) {
          const body = inner.replace(/^\?\s*\(?/, '').replace(/\)$/, '').trim();
          steps.push({ kind: 'filter', expr: parseFilter(body) });
          continue;
        }
        const q = inner.match(/^'(.*)'$/) || inner.match(/^"(.*)"$/);
        if (q) { steps.push({ kind: 'name', name: q[1] }); continue; }
        if (inner.indexOf(':') > -1) {
          const parts = inner.split(':');
          steps.push({
            kind: 'slice',
            from: parts[0].trim() === '' ? null : parseInt(parts[0], 10),
            to: parts[1] == null || parts[1].trim() === '' ? null : parseInt(parts[1], 10)
          });
          continue;
        }
        if (inner.indexOf(',') > -1) {
          steps.push({ kind: 'union', items: inner.split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')) });
          continue;
        }
        if (/^-?\d+$/.test(inner)) { steps.push({ kind: 'index', index: parseInt(inner, 10) }); continue; }
        steps.push({ kind: 'name', name: inner.replace(/^['"]|['"]$/g, '') });
        continue;
      }
      if (/\s/.test(src[i])) { i++; continue; }
      /* a bare leading name, e.g. "store.book" */
      const m = src.slice(i).match(/^[^.[\]]+/);
      if (!m) throw new Error('Unexpected "' + src[i] + '"');
      steps.push({ kind: 'name', name: m[0] });
      i += m[0].length;
    }
    return steps;
  }

  function matchBracket(s, start) {
    let depth = 0, inStr = null;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) { if (c === inStr && s[i - 1] !== '\\') inStr = null; continue; }
      if (c === "'" || c === '"') { inStr = c; continue; }
      if (c === '[') depth++;
      else if (c === ']') { depth--; if (!depth) return i; }
    }
    return -1;
  }

  const OPS = ['==', '!=', '>=', '<=', '>', '<'];

  function parseFilter(body) {
    for (const op of OPS) {
      const at = splitTop(body, op);
      if (at > -1) {
        return {
          left: body.slice(0, at).trim(),
          op: op,
          right: literal(body.slice(at + op.length).trim())
        };
      }
    }
    return { left: body.trim(), op: 'exists' };
  }

  function splitTop(s, op) {
    let inStr = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inStr) { if (c === inStr) inStr = null; continue; }
      if (c === "'" || c === '"') { inStr = c; continue; }
      if (s.startsWith(op, i)) {
        if ((op === '>' || op === '<') && s[i + 1] === '=') continue;
        if (op === '==' || op === '!=' || s[i - 1] !== '!') return i;
      }
    }
    return -1;
  }

  function literal(raw) {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw === 'null') return null;
    const q = raw.match(/^'(.*)'$/) || raw.match(/^"(.*)"$/);
    if (q) return q[1];
    const num = Number(raw);
    return isNaN(num) ? raw : num;
  }

  function readAt(obj, ref) {
    const path = ref.replace(/^@\.?/, '').trim();
    if (!path) return obj;
    let cur = obj;
    for (const part of path.split('.')) {
      if (cur == null) return undefined;
      cur = cur[part];
    }
    return cur;
  }

  function testFilter(item, f) {
    const left = readAt(item, f.left);
    if (f.op === 'exists') return left !== undefined && left !== null && left !== false;
    switch (f.op) {
      case '==': return left == f.right;      /* eslint-disable-line eqeqeq */
      case '!=': return left != f.right;      /* eslint-disable-line eqeqeq */
      case '>':  return left > f.right;
      case '>=': return left >= f.right;
      case '<':  return left < f.right;
      case '<=': return left <= f.right;
    }
    return false;
  }

  const childPathOf = (path, key, isArray) =>
    isArray ? path + '[' + key + ']'
            : path + (/^[A-Za-z_$][\w$]*$/.test(key) ? '.' + key : '["' + key + '"]');

  function children(node) {
    const out = [];
    const v = node.value;
    if (Array.isArray(v)) v.forEach((x, i) => out.push({ path: childPathOf(node.path, i, true), value: x }));
    else if (v && typeof v === 'object') Object.keys(v).forEach((k) => out.push({ path: childPathOf(node.path, k, false), value: v[k] }));
    return out;
  }

  function descendants(node) {
    const out = [];
    (function walk(n) {
      out.push(n);
      children(n).forEach(walk);
    })(node);
    return out;
  }

  function query(data, expr) {
    const steps = parsePath(expr);
    let nodes = [{ path: '$', value: data }];
    for (const step of steps) {
      const pool = step.deep ? nodes.reduce((acc, n) => acc.concat(descendants(n)), []) : nodes;
      const next = [];
      for (const n of pool) {
        const v = n.value;
        const isArr = Array.isArray(v);
        switch (step.kind) {
          case 'name':
            if (v && typeof v === 'object' && !isArr && Object.prototype.hasOwnProperty.call(v, step.name)) {
              next.push({ path: childPathOf(n.path, step.name, false), value: v[step.name] });
            }
            break;
          case 'wild':
            children(n).forEach((c) => next.push(c));
            break;
          case 'self':
            next.push(n);
            break;
          case 'index': {
            if (!isArr) break;
            const idx = step.index < 0 ? v.length + step.index : step.index;
            if (idx >= 0 && idx < v.length) next.push({ path: childPathOf(n.path, idx, true), value: v[idx] });
            break;
          }
          case 'slice': {
            if (!isArr) break;
            const from = step.from == null ? 0 : (step.from < 0 ? v.length + step.from : step.from);
            const to = step.to == null ? v.length : (step.to < 0 ? v.length + step.to : step.to);
            for (let i = Math.max(0, from); i < Math.min(v.length, to); i++) {
              next.push({ path: childPathOf(n.path, i, true), value: v[i] });
            }
            break;
          }
          case 'union':
            step.items.forEach((item) => {
              if (isArr && /^-?\d+$/.test(item)) {
                const idx = +item < 0 ? v.length + +item : +item;
                if (idx >= 0 && idx < v.length) next.push({ path: childPathOf(n.path, idx, true), value: v[idx] });
              } else if (v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, item)) {
                next.push({ path: childPathOf(n.path, item, false), value: v[item] });
              }
            });
            break;
          case 'filter':
            children(n).forEach((c) => { if (testFilter(c.value, step.expr)) next.push(c); });
            break;
        }
      }
      /* de-duplicate: `..` over overlapping subtrees can revisit a node */
      const seen = new Set();
      nodes = next.filter((x) => (seen.has(x.path) ? false : (seen.add(x.path), true)));
    }
    return nodes;
  }

  /* ---------- tree rendering ---------- */
  const typeOf = (v) => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;

  function leafHtml(v) {
    const t = typeOf(v);
    if (t === 'string') return '<span class="j-str">"' + escapeHtml(v) + '"</span>';
    if (t === 'number') return '<span class="j-num">' + v + '</span>';
    if (t === 'boolean') return '<span class="j-bool">' + v + '</span>';
    if (t === 'null') return '<span class="j-null">null</span>';
    return escapeHtml(String(v));
  }

  function treeHtml(value, path, depth, budget) {
    const t = typeOf(value);
    if (t !== 'object' && t !== 'array') return leafHtml(value);
    if (budget.n > MAX_NODES) return '<span class="j-trunc">…truncated</span>';

    const isArr = t === 'array';
    const entries = isArr ? value.map((v, i) => [i, v]) : Object.entries(value);
    const open = isArr ? '[' : '{';
    const close = isArr ? ']' : '}';

    if (!entries.length) return '<span class="j-punc">' + open + close + '</span>';

    let rows = '';
    for (const [k, v] of entries) {
      budget.n++;
      if (budget.n > MAX_NODES) { rows += '<div class="j-row"><span class="j-trunc">…truncated at ' + MAX_NODES + ' nodes</span></div>'; break; }
      const childPath = isArr ? path + '[' + k + ']' : path + (/^[A-Za-z_$][\w$]*$/.test(k) ? '.' + k : '["' + k + '"]');
      const label = isArr
        ? '<span class="j-idx">' + k + '</span>'
        : '<span class="j-key" data-path="' + escapeHtml(childPath) + '" title="Click to copy path">"' + escapeHtml(k) + '"</span>';
      rows += '<div class="j-row">' + label + '<span class="j-punc">: </span>' +
        treeHtml(v, childPath, depth + 1, budget) + '</div>';
    }

    const count = entries.length + (isArr ? (entries.length === 1 ? ' item' : ' items') : (entries.length === 1 ? ' key' : ' keys'));
    return '<details class="j-node"' + (depth < 3 ? ' open' : '') + '>' +
      '<summary><span class="j-punc">' + open + '</span><span class="j-count">' + count + '</span>' +
      '<span class="j-punc">' + close + '</span></summary>' +
      '<div class="j-children">' + rows + '</div></details>';
  }

  /* A parse-error card, shared by both parsers. */
  function errorCard(title, err) {
    let html = '<div class="j-error"><div class="j-error-title">' + escapeHtml(title) + '</div>' +
      '<p class="j-error-msg">' + escapeHtml(err.message) + '</p>';
    if (err.line != null) {
      html += '<p class="j-error-where">Line ' + err.line + (err.column != null ? ', column ' + err.column : '') + '</p>';
      if (err.snippet != null) {
        const caret = err.column != null ? ' '.repeat(Math.max(0, err.column - 1)) + '^' : '';
        html += '<pre class="j-error-snippet">' + escapeHtml(err.snippet) + (caret ? '\n' + caret : '') + '</pre>';
      }
    }
    return html + '</div>';
  }

  /* Render a whole value, or the results of a JSONPath query. */
  function renderValue(value) {
    return '<div class="j-tree">' + treeHtml(value, '$', 0, { n: 0 }) + '</div>';
  }

  function renderMatches(matches) {
    return '<div class="q-results">' + matches.map((m) =>
      '<div class="q-result"><div class="q-path">' + escapeHtml(m.path) + '</div>' +
      '<div class="j-tree">' + treeHtml(m.value, m.path, 1, { n: 0 }) + '</div></div>'
    ).join('') + '</div>';
  }

  return { treeHtml, renderValue, renderMatches, inspect, query, errorCard, typeOf, MAX_NODES };
})();
