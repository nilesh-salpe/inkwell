/* Runs the user's pattern in a worker so a catastrophically
   backtracking regex freezes a thread we can terminate, not the page. */
self.onmessage = function (e) {
  const { pattern, flags, text, limit } = e.data;
  try {
    const re = new RegExp(pattern, flags.indexOf('g') === -1 ? flags + 'g' : flags);
    const out = [];
    let m, guard = 0;
    while ((m = re.exec(text)) !== null) {
      out.push({
        index: m.index,
        match: m[0],
        groups: Array.prototype.slice.call(m, 1),
        named: m.groups ? Object.assign({}, m.groups) : null
      });
      if (m[0] === '') re.lastIndex++;          /* zero-length match guard */
      if (++guard >= limit) break;
      if (flags.indexOf('g') === -1) break;
    }
    self.postMessage({ ok: true, matches: out, truncated: guard >= limit });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message });
  }
};
