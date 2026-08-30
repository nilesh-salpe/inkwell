# Inkwell — Markdown, JSON & YAML tools

Three zero-backend developer tools on one static site, built for GitHub Pages:
a **Markdown editor** with live preview and real PDF export, and **JSON** and
**YAML** tools with validation, tree views and JSONPath queries.

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
- `assets/css/app.css` — theme tokens, layout, and the print stylesheet used for PDF export
- `sw.js` — offline cache

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
