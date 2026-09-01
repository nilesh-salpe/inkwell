# Inkwell — developer tools on one static site

Fifteen developer tools on one static site, built for GitHub Pages — a Markdown
editor with real PDF export, data tools for JSON, YAML, XML and CSV, a diff
viewer, a regex tester, text and number utilities, a colour converter, and a
set of crypto-adjacent tools (IDs, JWT, hashing, AES).

**Live:** <https://nilesh-salpe.github.io/inkwell/>

Documents are saved on the device, and after the first visit the tools work
offline. The page loads Google Tag Manager (`GTM-N5QTT4NV`) for visit
analytics; it records page views, not document contents.

## The tools

| Page | What it does |
|---|---|
| `/` | Hub — picks a tool |
| `/markdown/` | View, edit and export Markdown (PDF, HTML, `.md`, share links) |
| `/json/` | Validate, format, minify, sort, explore and **query** JSON |
| `/yaml/` | Validate, format, sort, explore and **query** YAML; convert to and from JSON |
| `/jwt/` | Decode a JSON Web Token, read its claims, check expiry, verify the signature |
| `/xml/` | Check well-formedness, format, minify, explore and convert XML to JSON |
| `/csv/` | View CSV as a table, catch ragged rows, filter, convert to and from JSON |
| `/id/` | Generate UUID v1–v7, ULID, NanoID, ObjectId and tokens; identify any ID |
| `/escape/` | Escape and unescape strings across JSON, HTML, URL, Base64, hex, Unicode, backslash, regex and SQL |
| `/hash/` | MD5, SHA-1/256/384/512, CRC32 and HMAC over text or a dropped file |
| `/diff/` | Compare two texts, side-by-side or unified, with word-level detail |
| `/regex/` | Test a pattern live, with groups and a replacement preview |
| `/text/` | Case conversion, line operations, counts and reading time |
| `/base/` | Binary, octal, decimal, hex and bitwise operations |
| `/color/` | hex, RGB, HSL, OKLCH and WCAG contrast |
| `/aes/` | Encrypt and decrypt with a passphrase (AES-256-GCM) |
| `/guides/` | How-to articles: Markdown to PDF, JSON to CSV, choosing a UUID version |

### Markdown

| | |
|---|---|
| **View** | GitHub-flavoured Markdown: tables, task lists, footnotes, callouts, autolinks |
| **Edit** | Split editor with formatting toolbar, shortcuts, list auto-continuation, find & replace, wrap-aware line numbers |
| **Export** | **PDF** (print-quality, selectable text), `.md`, standalone styled HTML, rich-text clipboard, share links |

### JSON and YAML

Both pages share one tree renderer, one statistics pass and one JSONPath
engine (`data-tools.js`); they differ only in how text becomes a value.

| | |
|---|---|
| **Validate** | Exact line and column of the fault, with the offending line marked — located by our own scanner, since browsers word (and often omit) JSON errors inconsistently |
| **Query** | JSONPath: `$.a.b`, `$..deep`, `[*]`, `[0]`, `[-1]`, `[1:3]`, `[0,2]`, `[?(@.price < 10)]`, `[?(@.isbn)]` |
| **View** | Collapsible tree, typed colouring, click any key to copy its path |
| **Edit** | Format (2/4 space), minify, sort keys recursively, repair (strips comments and trailing commas), escape/unescape |
| **YAML extras** | Multi-document files (`---`) parsed separately, YAML ↔ JSON conversion in both directions, `.json` export |

### Beyond markdownlivepreview.com

- **PDF export** tuned for print: A4 page setup, serif body text, no orphaned
  headings, tables and code blocks never split across pages, and link URLs
  printed inline. `\pagebreak` on its own line forces a new page.
- **Syntax highlighting** (highlight.js), **LaTeX math** (KaTeX) and
  **Mermaid diagrams** rendered live.
- **GitHub callouts** — `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`.
- **Multiple documents** with autosave, plus an outline panel for jumping around.
- **Accurate scroll sync** — the preview follows the exact source line you are on,
  not a crude percentage, so it stays right even with long code blocks.
- **Clickable task lists** — ticking a box in the preview rewrites the Markdown.
- **Dark mode**, resizable split, three view modes, drag-and-drop file open.
- **Works offline** via a service worker; **share links** carry the document in the URL.

## Keyboard

| Shortcut | Action |
|---|---|
| `Ctrl/⌘ B` / `I` / `K` / `E` | Bold / italic / link / inline code |
| `Ctrl/⌘ F` | Find & replace |
| `Ctrl/⌘ S` | Download `.md` |
| `Ctrl/⌘ P` | Export PDF |
| `Ctrl/⌘ 1` `2` `3` | Edit / Split / Read |
| `Ctrl/⌘ \` | Toggle sidebar |
| `Tab` / `Shift+Tab` | Indent / outdent |
| `Enter` | Continues the current list item |

## Deploy it

1. Create a repository (a short name makes a nicer URL — see below) and push these files.
2. **Settings → Pages → Build and deployment**
   - *Source:* **GitHub Actions** — the included workflow publishes on every push to `main`.
   - Or *Deploy from a branch:* `main` / `/ (root)`. `.nojekyll` is already present so
     Jekyll won't touch the `assets/` folder.
3. Open `https://<user>.github.io/<repo>/`.

Everything is static — no build step, no dependencies to install.

## Local development

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Edit `index.html`, `assets/css/app.css`, `assets/js/app.js`. There is nothing to compile.
Bump `VERSION` in `sw.js` when you ship changes so visitors pick them up immediately.

## How it's built

- `index.html` — the hub
- `markdown/index.html`, `json/index.html` — one page per tool, each with its own sprite and sample document
- `assets/js/shell.js` — everything language-agnostic: layout, documents, storage, theme, splitter, gutter, scroll sync, find & replace, exports, shortcuts
- `assets/js/markdown.js` — Markdown pipeline and preview enhancement
- `assets/js/data-tools.js` — tree renderer, structure statistics and the JSONPath engine, shared by JSON and YAML
- `assets/js/json.js` — JSON scanner and transforms
- `assets/js/yaml.js` — YAML parsing (js-yaml), formatting and conversion
- `assets/js/jwt.js` — JWT decoding, claim reading and WebCrypto signature verification
- `assets/js/xml.js` — XML parsing via DOMParser, formatting and the XML-to-value mapping
- `assets/js/csv.js` — RFC 4180 parser, delimiter sniffing, table rendering and JSON conversion
- `assets/js/ids.js` — UUID versions with hand-written MD5 and SHA-1, ULID, NanoID and the ID inspector
- `assets/js/escape.js` — the encoders, decoders and the plausibility check that stops plain words decoding as Base64
- `assets/js/hashes.js` — synchronous MD5, SHA-1 and CRC32, shared by the ID generator and the hash tool
- `assets/js/hash.js` — the hash and HMAC page (SHA-2 comes from WebCrypto)
- `assets/js/diff.js` — Myers diff with prefix/suffix trimming and word-level detail
- `assets/js/regex.js`, `assets/js/regex-worker.js` — pattern matching in a worker with a deadline
- `assets/js/text.js`, `assets/js/base.js`, `assets/js/color.js`, `assets/js/aes.js`
- `assets/css/app.css` — theme tokens, layout, and the print stylesheet used for PDF export
- `guides/` — content pages, sharing the hub's layout
- `sitemap.xml`, `robots.txt` — so the tool pages are discoverable
- `sw.js` — offline cache

### XML

| | |
|---|---|
| **Validate** | Well-formedness with the parser's own line and column. This is syntax only — no DTD or XSD validation |
| **Format** | 2 or 4 space indent, or minify; elements holding one short text node stay on a single line |
| **Explore** | Rendered through the shared tree by mapping attributes to `@name`, mixed text to `#text` and repeated elements to arrays — which also makes JSONPath work over XML |

### CSV

| | |
|---|---|
| **Check** | Ragged rows and unterminated quotes reported by row number — the usual reason an import fails |
| **Parse** | RFC 4180 quoting, with the delimiter sniffed from the first lines (comma, semicolon, tab, pipe) and overridable |
| **View** | A real table with a sticky header, right-aligned numbers, and a row filter |
| **Convert** | CSV → JSON with type coercion, and JSON arrays back to CSV |

### Identifiers

| | |
|---|---|
| **UUID** | v1, v3, v4, v5, v6, v7 per RFC 9562. v3 and v5 match the published test vectors — MD5 and SHA-1 are implemented here rather than pulled from WebCrypto, which has no MD5 and whose async API stalls under test |
| **Ordering** | v7 and ULID carry a monotonic counter, so a batch generated inside one millisecond still sorts correctly |
| **Other** | ULID, ObjectId, NanoID and random hex/base64url tokens — the only formats where a length is yours to choose. A UUID is always 128 bits |
| **Inspect** | Paste any identifier and it is named, with its variant and creation time where one is encoded |
| **Privacy** | v1/v6 use a random node with the multicast bit set, so no MAC address leaks. Generated values are not persisted |

### Diff and regex

| | |
|---|---|
| **Diff** | Myers' algorithm with the common start and end trimmed first. Changed lines are paired and diffed again at word level, so an edit shows the words that moved rather than two whole red and green lines |
| **Regex** | The pattern runs in a Web Worker with a 1.5 second deadline, so a catastrophically backtracking expression such as `(a+)+b` is terminated instead of freezing the tab |

### Numbers, text and colour

| | |
|---|---|
| **Base** | BigInt throughout, so values past 2^53 keep every digit; bitwise ops honour a chosen width and show two's complement |
| **Text** | Case conversion detects word boundaries from capitals as well as punctuation, so `HTTPServer` splits correctly |
| **Colour** | hex, RGB, HSL and OKLCH, with WCAG contrast. Achromatic colours report hue 0 rather than an arbitrary angle |

### AES

| | |
|---|---|
| **Cipher** | AES-256-GCM — authenticated, so a tampered message fails to decrypt rather than producing garbage |
| **Key** | PBKDF2-SHA256 with a configurable iteration count, stored in the message so it can be decrypted later |
| **Format** | Magic bytes, iterations, salt and IV prepended to the ciphertext, base64 encoded. Specific to this tool |
| **Scope** | A shared passphrase between two people. Not key management, and not for storing passwords |

### Hashing

| | |
|---|---|
| **Algorithms** | MD5, SHA-1, SHA-256, SHA-384, SHA-512 and CRC32 computed together; hex or Base64 output |
| **HMAC** | Enter a key and every SHA digest becomes an HMAC — the primitive behind webhook signatures |
| **Files** | Drop a file to checksum its bytes, which is how you verify a download |
| **Verify** | Paste an expected checksum and the matching algorithm is named, instead of comparing 64 hex characters by eye |
| **Not encoding** | Hashing is one-way; there is no decode. Reversible transforms live on the escape page |

### Escaping

| | |
|---|---|
| **Escape** | JSON, HTML entities, URL component and full URL, Base64 and Base64url, hex, Unicode escapes, backslash, regex and SQL — all at once |
| **Unescape** | Every decoder is tried and only the ones that apply are shown, so you can identify unknown input |
| **Correctness** | Decoded output must look like text before it is offered, otherwise any run of letters "decodes" as Base64 |

### JWT

| | |
|---|---|
| **Decode** | Header and payload as a readable tree; `exp`, `nbf`, `iat` and `auth_time` shown as real dates with how far away they are |
| **Expiry** | A single badge — Not expired / Expired / Not yet valid / No expiry — instead of making you read epoch seconds |
| **Verify** | `HS256/384/512` with a shared secret; `RS`, `PS` and `ES` with a PEM public key, via WebCrypto |
| **Safety** | `alg: none` is flagged. Tokens are credentials, so this page passes `persist: false` to the shell: nothing is written to storage, and it has no share link |

### Across the set

| | |
|---|---|
| **Command palette** | `Ctrl/⌘ K` searches every tool and every command on the page. It is built by scanning the DOM for `[data-cmd]`, `[data-export]` and the tool menu, so it cannot drift out of step with the buttons that exist |
| **Remembered controls** | Any control marked `data-remember` keeps its value between visits — the regex pattern, CSV delimiter, base and width, contrast background. Never applied to a passphrase, HMAC key or JWT secret |
| **Cross-tool handoff** | "Send to …" passes the buffer through `sessionStorage`. Where the sender or receiver owns a converter, the data is converted on the way — JSON to CSV arrives as a table, not as raw JSON |
| **Shared help** | The universal shortcut list is injected into every help modal from one place, so it cannot drift between tools |
| **Load the example** | Every tool's sample document stays reachable after the first visit, from the toolbar and the palette |
| **Small screens** | Control rows beyond the first collapse behind an Options toggle, and the pane holding them stays on screen in edit mode |

A tool supplies a `render` function and a set of toolbar commands; the shell
owns everything else. That is why all three tools have identical keyboard
shortcuts, autosave and theming without duplicating any of it. (same-origin + jsdelivr only; the analytics tag is never cached)

Markdown is parsed with [marked](https://marked.js.org/) **block by block**, so every
top-level element carries the source line it came from — that is what powers the
outline, the scroll sync and the checkbox write-back. Output is sanitised with
DOMPurify before it reaches the DOM.

## Printing notes

PDF export goes through a real print pipeline, so text stays selectable and
searchable and fonts stay sharp. In the dialog choose **Save as PDF** and enable
**Background graphics** if you want code blocks and callouts shaded.

## License

MIT
