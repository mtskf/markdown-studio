# Markdown Studio — Architecture

Onboarding notes for the internals of the Markdown Studio VS Code extension: a
Notion-like WYSIWYG markdown editor with rich diffs, tables, images, and math.
This document describes the *real* architecture as it exists in the tree; for
the deep, invariant-level details of the conversion pipeline, it defers to
[CLAUDE.md](../CLAUDE.md), which is the canonical reference for the
markdown ⇄ HTML round-trip rules.

## Contents

1. [High-level overview](#1-high-level-overview)
2. [Build system](#2-build-system)
3. [Extension host layer (`src/`)](#3-extension-host-layer-src)
4. [Webview layer (`webview/`)](#4-webview-layer-webview)
5. [The conversion pipeline](#5-the-conversion-pipeline)
6. [Settings architecture](#6-settings-architecture)
7. [Testing](#7-testing)
8. [Data flow](#8-data-flow)

---

## 1. High-level overview

The extension is a **VS Code custom text editor** (`CustomTextEditorProvider`).
When you open a `.md` file it renders a React + Tiptap WYSIWYG editor inside a
webview instead of the plain text view. The on-disk file stays the source of
truth: VS Code owns the `TextDocument`, the webview only proposes edits.

There are **two processes** that never share memory and only communicate by
message passing:

| Process | Runtime | Code | Responsibility |
|---|---|---|---|
| Extension host | Node | [`src/`](../src) | Owns the `TextDocument`, registers the editor/commands, talks to git, persists settings, writes files. |
| Webview | Browser (sandboxed iframe) | [`webview/`](../webview) | Renders the Tiptap editor, runs the markdown ⇄ HTML conversion, sends proposed edits back. |

### Message passing

All host ⇄ webview traffic is `postMessage` with a `{ type, ... }` shape. There
is no shared state — every piece of context (file content, base URI, settings,
cursor) is pushed explicitly. The webview is the message *initiator*: on mount
it posts `ready`, and the host replies with `init`.

Key messages (host handler lives in
[`src/provider.ts`](../src/provider.ts) `resolveCustomTextEditor`; webview
handler in [`webview/hooks/useEditorState.ts`](../webview/hooks/useEditorState.ts)):

| Direction | `type` | Meaning |
|---|---|---|
| webview → host | `ready` | Webview mounted; request initial content. |
| host → webview | `init` | Initial `content`, `baseUri`, `docFolderPath`, `filePath`, `isReadonly`, `settings`, `cursorPosition`. |
| webview → host | `edit` | Proposed new markdown (debounced ~300ms). Host applies a `WorkspaceEdit`. |
| host → webview | `update` | Document changed on disk / externally; re-render. |
| webview → host | `saveCursor` / `saveSettings` / `uploadImage` / `openLink` / `requestGitDiff` / `toggleEditor` / `setupPromptChoice` | Side-effecting requests routed to host APIs. |
| host → webview | `settingsUpdated` | Config changed (any write path); fold into editor settings. |
| host → webview | `gitDiffResponse` / `imageUploaded` / `showSetupPrompt` | Replies / triggers. |

---

## 2. Build system

A single esbuild script, [`esbuild.js`](../esbuild.js), produces **two
bundles** plus copied assets, all into `dist/`. `npm run build` runs it once;
`npm run watch` runs both in esbuild `context().watch()` mode.

| Bundle | Entry | Target / format | Notes |
|---|---|---|---|
| Extension host | [`src/extension.ts`](../src/extension.ts) | `node` / `cjs` | `vscode` marked **external** (provided by the runtime). → `dist/extension.js` |
| Webview | [`webview/index.tsx`](../webview/index.tsx) | `browser` / `esm` | **Code-splitting on** (`splitting: true`, `chunkNames: chunks/webview-[hash]`) so heavy deps like `mermaid` load as dynamic chunks. Fonts/images use the `dataurl` loader. → `dist/webview.js` + `dist/chunks/`. |

### CSS and fonts (`copyCSS()` in esbuild.js)

`dist/editor.css` is concatenated from three sources:

1. [`webview/styles/editor.css`](../webview/styles/editor.css) — the editor's own styles.
2. `node_modules/diff2html/bundles/css/diff2html.min.css` — diff rendering.
3. `node_modules/katex/dist/katex.min.css` — math rendering.

KaTeX's CSS references `fonts/...` relatively, so the KaTeX font files are
copied into `dist/fonts/` to keep those URLs resolvable inside the webview.

`vscode:prepublish` runs the build with `--production` (minify on, sourcemaps
off). `npm run package` wraps `vsce package` into a `.vsix`.

---

## 3. Extension host layer (`src/`)

Three files, all written against the VS Code API.

### Activation — [`src/extension.ts`](../src/extension.ts)

`activationEvents` is `onLanguage:markdown` (package.json). On `activate()`:

- Runs the **one-time settings migration** (`migrateLegacySettings`, see §6).
- Registers the custom editor `betterMarkdown.editor` with
  `supportsMultipleEditorsPerDocument: true` and
  `retainContextWhenHidden: true`.
- Registers commands: `toggleEditor` (swap rich ⇄ default editor via
  `vscode.openWith`), `find`, `openDiff`, `factoryReset`.
- Registers a `CodeLensProvider` that adds an "Open in Rich Editor" lens at the
  top of any markdown source view.
- **Auto-close of non-`file:` custom editors**: when VS Code opens a git diff
  for a `.md`, the custom editor intercepts both `git:`/`scm:` sides; those
  read-only panes are auto-closed via `onDidChangeTabs`. The comment block
  there documents *why* a pre-acceptance rich diff for Claude Code isn't
  feasible (proposed content isn't exposed to extensions until after
  acceptance) — worth reading before re-attempting that integration.

`resolveDiffArgs` / `withHead` resolve the two URIs for `openDiff` from
whatever the caller passed (two URIs, one URI vs `HEAD`, an SCM resource state,
or the active diff/text editor).

### Custom editor provider — [`src/provider.ts`](../src/provider.ts)

`BetterMarkdownProvider implements CustomTextEditorProvider`. Per opened
document, `resolveCustomTextEditor`:

- Sets `webview.options.localResourceRoots` to `dist/`, the document's folder
  (so relative images load), and any workspace folders.
- Computes `baseUri` (webview-resolved doc folder) and `docFolderPath` (raw fs
  path) — both are needed to translate image paths in both directions.
- Wires the `onDidReceiveMessage` handler that services every webview request
  (init, image upload, link open, git diff, edit, etc.).
- Wires `onDidChangeTextDocument` to push `update` to the webview — but guards
  with a `pendingWebviewEdits` counter so the extension's *own*
  `applyEdit`-driven changes don't echo back as a redundant re-render.

Notable host behaviours:

- **Edit application**: an `edit` message becomes a `WorkspaceEdit` replacing
  the whole document. Skipped when `isReadonly` (non-`file:` schemes) or when
  the content is unchanged.
- **First-edit silent save**: the first edit after init is the normalization
  round-trip (`md → html → md`). If consent was already granted and `autoSave`
  is on, the host calls `document.save()` once so the user doesn't see a
  surprise dirty state. Subsequent edits follow VS Code's own save cadence.
- **First-run consent**: gated on a `globalState` flag (`consentShown`). On the
  first file open post-install, the host posts `showSetupPrompt` (after `ready`)
  and the webview renders the modal ([`SetupPrompt.tsx`](../webview/components/SetupPrompt.tsx)).
- **Cursor persistence**: per-file caret position stored in `globalState`
  (`cursors`), restored on open.
- **Git HEAD**: `getHeadContent` uses the built-in `vscode.git` extension API
  to fetch the committed version for the in-editor "Diff" toggle.

### Rich diff panel — [`src/diffPanel.ts`](../src/diffPanel.ts)

`BetterMarkdownDiffPanel` is a standalone `WebviewPanel` (singleton via
`createOrShow`) that reuses the **same webview bundle** but boots into diff mode
by setting `window.__BTRMK_MODE__ = "diff"` in its HTML. It reads two URIs via
`workspace.openTextDocument` (so it works for `file:`, `git:`, `scm:` — anything
the text-document layer can read), posts `diffInit`, and refreshes on
`onDidSaveTextDocument` for either side.

### Settings sync

Both `provider.ts` and `diffPanel.ts` subscribe to
`workspace.onDidChangeConfiguration` and push `settingsUpdated` to their
webviews when the `markdownStudio` namespace changes — see §6.

---

## 4. Webview layer (`webview/`)

### Entry & mode split — [`webview/index.tsx`](../webview/index.tsx)

Reads `window.__BTRMK_MODE__`: `"diff"` mounts
[`DiffApp`](../webview/DiffApp.tsx) (DiffView only, no editor); anything else
mounts [`App`](../webview/App.tsx) (the full editor).

### The editor — [`webview/App.tsx`](../webview/App.tsx)

`useEditor` from `@tiptap/react` with `StarterKit` plus a stack of extensions:

- `Code.extend({ excludes: "" })` — overrides Tiptap's default `excludes: "_"`
  so inline code can coexist with bold/italic (e.g. `**`bold code`**`
  round-trips).
- Tables (`Table`/`TableRow`/`TableCell`/`TableHeader`), task lists, link,
  `ImageBlock`, lowlight code blocks (`createCodeBlock`).
- Custom node extensions in [`webview/extensions/`](../webview/extensions):
  `MathInline`, `MathBlock`, `MermaidBlock`, `YouTubeEmbed`, `GitHubEmbed`,
  `SlashCommand`. Each defines a `parseHTML` rule keyed on a `data-type`
  attribute, so the conversion layer can round-trip them by emitting that shape.
  `MathInline` also adds an `InputRule` for `$...$`.

App composes the chrome: search bar, settings panel, setup prompt, sticky
headings, table of contents, bubble menu, table controls, image dialog. Editor
state (sync, readonly, diff, image upload) is owned by
[`useEditorState`](../webview/hooks/useEditorState.ts); the settings panel by
[`useSettingsPanel`](../webview/hooks/useSettingsPanel.ts); clipboard and
drag-drop by their respective hooks.

### The VS Code sync hook

Conversion entry points live in
[`webview/hooks/useVSCodeSync.ts`](../webview/hooks/useVSCodeSync.ts):
`markdownToHtml` (disk → Tiptap), `htmlToMarkdown` / `htmlToMarkdownSync`
(Tiptap → disk), and `markdownToDisplayHtml` (for the diff view's rendered
mode). The message wiring and debounce live in
[`useEditorState.ts`](../webview/hooks/useEditorState.ts): editor `update` →
`htmlToMarkdown` → `edit` message (300ms debounce); incoming `init`/`update` →
`markdownToHtml` → `editor.commands.setContent`. The `update` path uses
`{ emitUpdate: false }` and snapshots/restores the caret so external saves
(e.g. format-on-save) don't loop back or yank the cursor.

### API shim — [`webview/vscode-api.ts`](../webview/vscode-api.ts)

`vscodeApi` is a thin wrapper around `acquireVsCodeApi()`. The custom editor is
the only host runtime.

---

## 5. The conversion pipeline

> The invariant-level rules (table-cell code-span pipes, the math round-trip,
> the embed round-trip) are documented in [CLAUDE.md](../CLAUDE.md). This
> section is the map, not the territory.

Markdown is converted to HTML for Tiptap and back using
[unified](https://unifiedjs.com) with remark/rehype:

- **md → HTML**: `remark-parse` → `remark-gfm` → `remark-math` →
  `remark-rehype` (with custom `mathHandlers`) → `rehype-stringify`, then
  DOM-based fix-ups for Tiptap (task lists, embeds, image wrapping).
- **HTML → md**: `rehype-parse` → `rehype-remark` → `remark-gfm` →
  `remark-stringify` (configured from user settings), then
  `normalizeMarkdown` post-processing.

### Three coupled files — keep them in sync

| File | Role | Engine |
|---|---|---|
| [`webview/hooks/useVSCodeSync.ts`](../webview/hooks/useVSCodeSync.ts) | **Production** transforms. | `DOMParser` (real browser DOM). |
| [`webview/markdown.config.ts`](../webview/markdown.config.ts) | `normalizeMarkdown` post-processing + remark-stringify config. | String/regex. Shared by production *and* tests. |
| [`test/pipeline.ts`](../test/pipeline.ts) | **Test mirror** of the production transforms. | Regex (no `DOMParser` in Node). |

Why three: the production path needs `DOMParser` (only in the webview), but the
tests run in Node where there's no DOM. `test/pipeline.ts` re-implements the
DOM-shaped steps with regex so the same conversions can be tested headlessly.
`normalizeMarkdown` is the one piece both share verbatim — it's pure string
work. **When you touch a transform in `useVSCodeSync.ts`, mirror it in
`test/pipeline.ts`**, or the test suite silently stops protecting that path.

Shared, DOM-independent helpers live in
[`webview/conversion-utils.ts`](../webview/conversion-utils.ts): `mathHandlers`,
`protectTableCodePipes`, `protectCurrencyDollars`, and the `PIPE_PH`/`DOLLAR_PH`
placeholders. These are imported by both the production and test pipelines, so
they can't drift.

`normalizeMarkdown` is a sequence of independently-toggleable steps (tight
lists, unescaping, ordered-list renumbering, table-header rebuild, table
padding, autolink stripping, safety-entity rewriting, etc.) — most map 1:1 to a
setting (§6). YAML frontmatter is stripped before the pipeline and re-prepended
after ([`webview/frontmatter.ts`](../webview/frontmatter.ts)), since
`remark-parse` doesn't handle it without an extra plugin.

---

## 6. Settings architecture

Settings live in **VS Code's native configuration** under the `markdownStudio.*`
namespace, declared in [`package.json`](../package.json)
`contributes.configuration`. (Internal command IDs and the editor view type
keep the legacy `betterMarkdown.*` namespace so existing keybindings/editor
associations still resolve — see [CLAUDE.md](../CLAUDE.md) for the rationale.)

### Four places that MUST stay in sync

Adding or renaming a setting means touching all four:

1. [`package.json`](../package.json) — the `contributes.configuration` JSON schema (UI + defaults + validation).
2. `BetterMarkdownSettings` interface in [`webview/settings.ts`](../webview/settings.ts).
3. `DEFAULT_SETTINGS` in [`webview/settings.ts`](../webview/settings.ts).
4. `SETTING_KEYS` in [`webview/settings.ts`](../webview/settings.ts) — the authoritative key list the host iterates to read/write config.

### Three write paths, one store

All three write to the same VS Code config store:

- The VS Code Settings UI / `.vscode/settings.json` (any scope).
- The in-app `SettingsPanel` — posts `saveSettings`; the host writes each
  changed key to **User scope** (`writeSettings` in
  [`src/provider.ts`](../src/provider.ts), diffing first to avoid firing 16
  change events for one toggle).
- Programmatic edits.

Any change fires `workspace.onDidChangeConfiguration`; both
[`src/provider.ts`](../src/provider.ts) and
[`src/diffPanel.ts`](../src/diffPanel.ts) listen and push fresh settings to
every open webview as `settingsUpdated`. The host reads config **per known key**
(not the whole namespace) so stray entries from other extensions can't leak in.

### Migration & reset

- `migrateLegacySettings` in [`src/extension.ts`](../src/extension.ts) — a
  one-time copy of pre-2.3.5 `globalState` settings into User-scope config,
  gated on a separate `configMigrated` flag (idempotent, never re-runs).
- `factoryReset` in [`src/provider.ts`](../src/provider.ts) — wipes all
  User-scope keys + the consent flag (workspace overrides left intact), then the
  config listener broadcasts the defaults.

---

## 7. Testing

`npm test` runs two scripts in order
([`package.json`](../package.json) `scripts.test`), both via `tsx`:

1. [`test/test-conversions.ts`](../test/test-conversions.ts) — targeted cases
   grouped into categories A–Q (the per-feature suites).
2. [`test/test-roundtrip.ts`](../test/test-roundtrip.ts) — a full-file
   round-trip of [`test/test.md`](../test/test.md); exits non-zero on any line
   diff.

Both run headlessly in Node against `test/pipeline.ts` (the regex mirror, §5),
so there's no browser/Tiptap in the loop.

### Categories (test-conversions.ts)

| | | | |
|---|---|---|---|
| A. Headings | B. Inline formatting | C. Lists | D. Task lists |
| E. Tables | F. Code blocks | G. Images | H. Blockquotes |
| I. Horizontal rules | J. Special chars / escaping | L. normalizeMarkdown unit tests | L2. Frontmatter |
| M. Known failing / limitations | N. Settings-driven behavior | O. Math (inline + block) | P. Embeds (YouTube, GitHub) |
| Q. Mermaid diagrams | | | |

### Philosophy

The suite is **round-trip-first**: `roundtripCase(name, input, expectedOutput?)`
feeds markdown → HTML → markdown and asserts the output (omit `expectedOutput`
when the round-trip is idempotent). Unit assertions (`eq`) and boolean
assertions (`assert`) cover individual helpers. A documented-lossy case is
marked `{ known: true }` — it renders as `○` and doesn't fail the suite. The
goal is that *what you wrote is what you get back*, with deliberate, documented
exceptions rather than silent corruption.

---

## 8. Data flow

```
                    ┌──────────────────────── EXTENSION HOST (Node) ────────────────────────┐
   file.md on disk  │                                                                       │
        │           │   VS Code TextDocument  ◀────── applyEdit (WorkspaceEdit, whole-doc)   │
        └──────────▶│           │                              ▲                             │
        ▲           │           │ document.getText()           │                             │
        │           │           ▼                              │                             │
   document.save()  │     postMessage("init"/"update")    onDidReceiveMessage("edit")        │
   (first edit, if  │           │                              ▲                             │
    autoSave)       │           │   src/provider.ts            │                             │
                    └───────────┼──────────────────────────────┼─────────────────────────────┘
                                │  postMessage  (host ⇄ webview, no shared memory)
                    ┌───────────┼──────────────────────────────┼─────────────────────────────┐
                    │           ▼                              │                  WEBVIEW (browser)
                    │   useEditorState (init/update)     useEditorState (update, 300ms debounce)
                    │           │                              ▲                             │
                    │           ▼                              │                             │
                    │     markdownToHtml()              htmlToMarkdown()                     │
                    │     (remark→rehype +              (rehype→remark +                     │
                    │      DOM fix-ups)                  normalizeMarkdown)                  │
                    │           │                              ▲                             │
                    │           ▼                              │ editor.getHTML()            │
                    │   editor.setContent(html) ──▶  Tiptap / ProseMirror  ──▶ user edits    │
                    │                                  (WYSIWYG: tables, math,               │
                    │                                   embeds, task lists, …)               │
                    └───────────────────────────────────────────────────────────────────────┘
```

Read top-to-bottom for **open** (disk → editor), bottom-to-top for **save**
(edit → disk). The same bundle, driven by `__BTRMK_MODE__ = "diff"` and a
different host (`src/diffPanel.ts`), renders the standalone rich diff instead of
the editor.
