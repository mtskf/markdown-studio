# Markdown Studio — TODO

## Priority Features

- [ ] 🚧 🚩 **Heading fold / unfold toggle.** Always-visible ▼/▶ icon to the left of each heading; click toggles between folded and unfolded. Fold hides everything up to the next same-or-higher-level heading (Notion / outline style). <!-- branch: feat/heading-fold-toggle -->
  - Persistence: VS Code globalState keyed per file (same mechanism as `betterMarkdown.cursors` at [src/provider.ts:62-75](../src/provider.ts#L62)) — survives reload without polluting markdown. Markdown round-trip stays untouched.
  - Implementation sketch: extend Tiptap `Heading` with a NodeView for the toggle button; render folded ranges via ProseMirror `Decoration` (`display: none`) so the document is unchanged and `htmlToMarkdown` continues to round-trip cleanly. Coordinate with [webview/components/TableOfContents.tsx](../webview/components/TableOfContents.tsx) and [StickyHeadings.tsx](../webview/components/StickyHeadings.tsx) which already enumerate headings.
  - Both fold and unfold must work, and the collapsed/expanded state must be restored on file reopen.
- [ ] 🚧 🚩 **[MUST] Pass context from the Rich editor to Claude Code (Cmd+Opt+K).** Today the shortcut does nothing when the Rich editor is focused: it is a webview custom editor, so there is no `window.activeTextEditor` for Claude Code to read a selection from (and the webview may also swallow the keystroke). Workaround until fixed: toggle to source (Cmd+Shift+M) or `@`-mention the file. <!-- branch: feat/claude-code-mention-from-rich-editor -->
  - Investigation (2026-06-02, against `anthropic.claude-code` 2.1.159 `extension.js`) — resolved:
    - Cmd+Opt+K = command `claude-code.insertAtMentioned`; its handler is `async () => { let e = window.activeTextEditor; if (!e) return; ... }` — it takes NO arguments and reads `activeTextEditor` directly. Empty selection → `@<relpath>`, non-empty → `@<relpath>#Lstart-Lend`.
    - Same for `claude-vscode.insertAtMention` (Alt+K) and for the automatic `<ide_selection>` context (driven by `window.onDidChangeTextEditorSelection`, gated on `=== activeTextEditor`).
    - The keybindings are `when: editorTextFocus`, which is false while the webview is focused → they never fire in the Rich editor.
    - No exported extension API (activate returns nothing usable). So there is no clean way to pass a selection/URI to Claude Code.
  - Only viable approach (no Claude Code changes): we are a `CustomTextEditorProvider`, so the backing `TextDocument` exists. (1) register our own keybinding scoped to the Rich editor (`when: activeCustomEditorId == 'betterMarkdown.editor'`); (2) `showTextDocument` the backing doc to make it active and set its selection; (3) `executeCommand('claude-code.insertAtMentioned')`; (4) optionally restore focus to the Rich editor.
  - Constraints: focus briefly switches to the source editor (unavoidable — the command reads `activeTextEditor`). Precise ProseMirror→markdown range mapping is hard (htmlToMarkdown is not position-preserving). MVP = file-level `@`-mention (empty-selection path); range mapping is a follow-up.
- [ ] 🚩 **[MUST] Open Source Control "Changes" diffs in the default diff editor, not the Rich editor.** Clicking a file in the SCM Changes view opens it in the Markdown Studio rich editor, so the git diff is never shown. Root cause: the `customEditors` contribution uses `priority: "default"` with selector `*.md` ([package.json](../package.json) `contributes.customEditors`), so Markdown Studio claims every `.md` pane — including both sides of a diff. The current mitigation only *closes* git:/scm: custom-editor tabs ([src/extension.ts:128](../src/extension.ts#L128)); it doesn't surface the diff.
  - Desired: normal `.md` open → rich editor (keep as default); SCM / diff open → native text diff editor.
  - Approach: in the `onDidChangeTabs` handler, detect a `vscode.TabInputTextDiff` (or any tab whose original/modified URI scheme is non-`file:` — `git:`/`vscode-scm:`/etc.) bound to viewType `betterMarkdown.editor`, and reopen it with the default editor — e.g. `vscode.commands.executeCommand("vscode.diff", original, modified, title, { override: "default" })`, or reopen via `workbench.action.reopenTextEditor`. Verify it works from the SCM tree, the diff-editor toolbar, and the inline "vs HEAD" path.
  - User escape hatch to document: `workbench.editorAssociations` can force `*.md` diffs to the text editor, but the extension should handle this out of the box.

## Code Review Findings (2026-06-02)

Multi-agent review + adversarial verification. Ordered by priority. Each verified against the actual code; refuted false positives omitted. `(partial)` = real but narrower than first reported.

### P1 — High

- [ ] 🐛 `renumberOrderedLists` corrupts fenced code / math-block content. [webview/markdown.config.ts:239-266](../webview/markdown.config.ts#L239) has no `inCodeBlock` guard (every sibling normalizer does), and it runs before math placeholders are restored → numbered lines inside ```` ``` ```` blocks or `btrmk-math-block` fences get renumbered. Enabled by default. Fix: add the same fence-toggle guard. Add a category-N/code-block test.
- [ ] 🐛 Embed `exit()` reads stale `node.attrs.url`. [webview/extensions/YouTubeEmbed.tsx:65-68](../webview/extensions/YouTubeEmbed.tsx#L65) and [GitHubEmbed.tsx:144-147](../webview/extensions/GitHubEmbed.tsx#L144) call `save()` (`updateAttributes`) then guard cursor placement on `node.attrs.url`, which hasn't flushed → caret left inside a freshly-created embed. Fix: guard on local `url.trim()`.
- [ ] 🐛 Image-upload reply has no request-id or timeout. [webview/hooks/useEditorState.ts:86-100](../webview/hooks/useEditorState.ts#L86) matches `imageUploaded` by type only; concurrent multi-image drop resolves every pending promise with the first reply's `src` (wrong image), and a missing reply leaks the listener forever. Fix: correlate by unique request id + add a timeout that rejects.
- [ ] ⚙️ `tsx` not in deps/devDeps/lockfile. [package.json](../package.json) `npm test` uses `npx tsx`; CI runs `npm ci` then `npm test`, relying on a live npx download → publish/CI fragility. Fix: `npm i -D tsx`.
- [ ] ⚙️ `ovsx` not in deps/devDeps/lockfile. [.github/workflows/publish.yml:43](../.github/workflows/publish.yml#L43) `npx ovsx publish` live-downloads at publish time (vsce is pinned, ovsx isn't) → Open VSX publish can break. Fix: `npm i -D ovsx`.
- [ ] ⚙️ No CI on PR / push. Only [publish.yml](../.github/workflows/publish.yml) exists (tag-triggered); tests run only at release → a broken main is caught only when tagged. Fix: add `ci.yml` on `pull_request`/`push` running `npm ci && npm test && node esbuild.js`.

### P2 — Medium

- [ ] 🐛 (partial) `openLink` opens arbitrary local files. [src/provider.ts:256-269](../src/provider.ts#L256) resolves a webview-supplied non-http `href` via `path.resolve(docDir, href)` and `vscode.open` with no confinement → can open files outside the workspace (bounded: opens in an editor, no exec). Fix: verify the resolved path stays within a workspace folder.
- [ ] 🐛 (partial/latent) Math test mirror diverges from production on `<`/`>`/`&`. [test/pipeline.ts:93-98](../test/pipeline.ts#L93) captures entity-encoded span text; production [useVSCodeSync.ts:182](../webview/hooks/useVSCodeSync.ts#L182) reads DOM-decoded `data-latex`. Currently both round-trip the same, but a production regression on LaTeX with `<` would escape tests. Fix: source the placeholder from `data-latex` + decode entities in the test mirror.
- [ ] 🐛 (partial) Naive single-backtick code-span scanning. [webview/markdown.config.ts:130-144](../webview/markdown.config.ts#L130) (and the same logic in `stripAutolinks`/`unescapeBareUrls`/`splitTableRow`) closes a code span at the next single backtick, mis-parsing double-backtick spans like foo\`bar` `→ unescaping leaks into protected code. Fix: match backtick runs by length (CommonMark).
- [ ] 🐛 (partial) Overbroad `\[` unescape. [webview/markdown.config.ts:168](../webview/markdown.config.ts#L168) strips `\[` unconditionally; literal text `\[label](url)` may re-parse as a link on reload. Corruption loop unproven (remark may escape the `]`/`(` too). Fix: skip the unescape when a `\[...\](` link shape follows; add the verifying round-trip test below.
- [ ] 🐛 Leaked panel listeners. [src/provider.ts:343,364](../src/provider.ts#L343) discards the `onDidChangeViewState` and the second `onDidDispose` disposables (low impact — panel-scoped — but inconsistent with the other two). Fix: store and dispose them.
- [ ] ⚙️ `copyCSS()` not re-run in `--watch`. [esbuild.js:93-95](../esbuild.js#L93) copies CSS/fonts once; watch contexts never re-invoke it → stale `dist/editor.css` on style edits during dev. Fix: `build.onEnd(() => copyCSS())` plugin on the webview watch context.

### P3 — Low / cleanup

- [ ] ⚡ `TableControls` triple-subscribes. [webview/components/TableControls.tsx:82-84](../webview/components/TableControls.tsx#L82) registers `selectionUpdate`+`update`+`transaction`; `transaction` is a superset → redundant reflow while editing in a table. Fix: keep only `transaction`.

## Refactoring Findings (2026-06-02 — supplemental)

Second-pass review focused on refactoring, performance, tests, and type safety (the first pass above covered shipped security + correctness bugs). Each item verified against current code; no overlap with the section above.

### R1 — High (low-effort, high-leverage)

- [ ] 🔧 `readSettings` / `writeSettings` duplicated verbatim across host files. [src/provider.ts:16-43](../src/provider.ts#L16) and [src/diffPanel.ts:7-32](../src/diffPanel.ts#L7) hold identical implementations (read each known key, diff-then-update on write). Extract to `src/settings-utils.ts` and import from both — keeps writes one-source-of-truth, ready for any future write-path additions.
- [ ] 🔧 Embed NodeView duplication. [webview/extensions/YouTubeEmbed.tsx:32-161](../webview/extensions/YouTubeEmbed.tsx#L32) and [GitHubEmbed.tsx:112-224](../webview/extensions/GitHubEmbed.tsx#L112) share the same `save`/`exit`/`useEffect([editing])`/`useEffect([node.attrs.url])`/keyboard-nav skeleton. Extract `useEmbedEditor(node, updateAttributes, deleteNode, editor, getPos)`. Bonus: the P1 stale-`node.attrs.url` bug then has a single fix site.
- [ ] 🔧 Math NodeView duplication. [webview/extensions/MathBlock.tsx:43-65](../webview/extensions/MathBlock.tsx#L43) and [MathInline.tsx:43-65](../webview/extensions/MathInline.tsx#L43) mirror the same `save`/`exit`/`useEffect` shape. Extract `useMathEditor(node, updateAttributes, editor, getPos)` alongside the embed hook.
- [ ] 🔧 `provider.ts` message handler grew into a ~120-line if/else chain. [src/provider.ts:282-335](../src/provider.ts#L282) (now `~282–402` with the 405-line file) handles ~10 message types inline. Convert to a `handlers: Record<MessageType, (msg, ctx) => Promise<void>>` dispatch table; the runtime cost is identical but adding a new message becomes a single entry instead of an else-if dropped into the middle of the chain.
- [ ] ⚡ `TableOfContents` and `StickyHeadings` poll the DOM on a fixed interval. [TableOfContents.tsx:81](../webview/components/TableOfContents.tsx#L81) (`setInterval(updateToc, 1000)`) and [StickyHeadings.tsx:69](../webview/components/StickyHeadings.tsx#L69) (`setInterval(update, 2000)`) each run `querySelectorAll(".tiptap-editor h1, …, h6")` + `getBoundingClientRect` on every tick, regardless of whether anything changed. Switch to Tiptap's `editor.on("update", …)` + the existing scroll listener and drop the interval — eliminates a steady-state 0.5-1Hz reflow background load on long docs.
- [ ] ⚡ `htmlToMarkdownSync` runs on every edit while a diff is open. [webview/hooks/useEditorState.ts:341-354](../webview/hooks/useEditorState.ts#L341) — `currentMarkdown = useMemo(() => …, [editor, diffVisible, diffData, settingsRef])` includes `diffData` purely as a re-trigger; every git-diff response reallocates `diffData` and re-runs the synchronous `preprocessTiptapHtml` + `unified().processSync()` pipeline. Drop `diffData` from the deps (use `diffVisible` as the gate) — same behavior, no spurious work.
- [ ] 🧪 `test/pipeline.ts` ignores `settings`. [test/pipeline.ts:43](../test/pipeline.ts#L43) — `RoundTripOptions` is empty; `roundTrip()` always uses `MARKDOWN_CONFIG` (defaults) and calls `normalizeMarkdown` without settings. Result: category-N "Settings-driven behavior" tests can drive `normalizeMarkdown` directly, but no full round-trip ever runs under a non-default settings profile — the `bullet`/`compactLists`/`renumberOrderedLists`/`fixTableHeaders` toggle paths are untested end-to-end. Fix: add `settings?: BetterMarkdownSettings` to `RoundTripOptions`; thread it through `htmlToMd` so a roundtripCase can opt into a config.
- [ ] 🧪 `test/pipeline.ts` does not exercise `restoreRelativePaths`. The production `htmlToMarkdown` calls `restoreRelativePaths(md, baseUri, docFolderPath)` ([useVSCodeSync.ts:259](../webview/hooks/useVSCodeSync.ts#L259)); the test mirror has no equivalent and no `baseUri`/`docFolderPath` params on `RoundTripOptions`. Image relative-path round-trip is untested. Fix: add the two params + a category-G test that mounts an image under a non-trivial base URI.
- [ ] 🛠 `window` global typing. Multiple files cast (`window as any`) for `__BTRMK_MODE__` / `__BTRMK_FILE__` / `__BTRMK_VSCODE_API__` ([vscode-api.ts:29](../webview/vscode-api.ts#L29) + App.tsx + DiffApp.tsx + SlashCommand.tsx). Add `declare global { interface Window { __BTRMK_MODE__?: "diff"; __BTRMK_FILE__?: string; __BTRMK_VSCODE_API__?: VsCodeApi } }` in one shared `webview/global.d.ts` — kills every `as any` cast in one pass.

### R2 — Medium

- [ ] 🎯 `NodeViewProps` not typed. Every custom NodeView destructures `({ node, updateAttributes, ... }: any)`: [YouTubeEmbed.tsx:38](../webview/extensions/YouTubeEmbed.tsx#L38), [GitHubEmbed.tsx:112](../webview/extensions/GitHubEmbed.tsx#L112), [MathBlock.tsx:7](../webview/extensions/MathBlock.tsx#L7), [MathInline.tsx:7](../webview/extensions/MathInline.tsx#L7), [CodeBlockView.tsx:16](../webview/extensions/CodeBlockView.tsx#L16). Import `NodeViewProps` from `@tiptap/react` and use it — ~5 `any` casts removed and `node.attrs.*` becomes type-checked.
- [ ] 🎯 Git extension API loosely typed. [src/provider.ts:151](../src/provider.ts#L151) uses `(gitExt.exports as any).getAPI(1)` and `repositories.find((r: any) => …)`. Declare a minimal local interface (`interface GitAPI { repositories: { rootUri: vscode.Uri; show: (ref: string, path: string) => Promise<string> }[] }`) so the call site is type-checked.
- [ ] 🎯 Tab inspection casts. [src/extension.ts:77,79](../src/extension.ts#L77) does `(input as any).viewType` / `(input as any).uri`. Use `TabInputCustom` / `TabInputText` (provided by `@types/vscode`) with `instanceof` narrowing.
- [ ] 🎯 `mathHandlers` typed as `any`. [webview/conversion-utils.ts:9-25](../webview/conversion-utils.ts#L9) — `_state: any, node: any`. Use `Handler` from `mdast-util-to-hast`.
- [ ] 🎯 Tiptap `Suggestion` callbacks typed as `any`. [SlashCommand.tsx:85,89](../webview/extensions/SlashCommand.tsx#L85) — use `SuggestionProps` / `SuggestionKeyDownProps`.
- [ ] 🔧 `normalizeMarkdown` repeats the "split lines / track fence state / process non-code lines / join" pattern across 4+ helpers. [markdown.config.ts:417-535](../webview/markdown.config.ts#L417) — `stripAutolinks`, `unescapeBareUrls`, `replaceSafetyEntities`, `unescapeSpecialChars` all open with the same `inCodeBlock` toggle + backtick-aware scanner. Extract `processOutsideCodeFences(md, transform: (text) => string)` and let each helper supply just its inner transform — currently any fence-handling bug needs to be fixed N times (cf. P1 `renumberOrderedLists` which forgot the guard entirely).
- [ ] ⚡ `unified()` pipelines rebuilt on every call. [useVSCodeSync.ts:80,177,316](../webview/hooks/useVSCodeSync.ts#L80) — `markdownToHtml`, `htmlToMarkdown`, `markdownToDisplayHtml` each construct `unified().use(...).use(...)` per invocation. The plugin chain is stateless; hoist to module-scope constants and call `.process()` only — saves the `use()` setup on every keystroke. Verify statelessness first (a few plugins keep file-scoped state).
- [ ] ⚡ Duplicated DOM traversal in `markdownToHtml` + `preprocessTiptapHtml`. [useVSCodeSync.ts:80,177](../webview/hooks/useVSCodeSync.ts#L80) each call `new DOMParser().parseFromString(...)` + serialize, so a single round-trip pays for two full HTML→DOM→HTML cycles. Investigate threading the parsed `Document` from `markdownToHtml` into `preprocessTiptapHtml` (or doing both fix-ups in one pass).
- [ ] ⚡ `normalizeMarkdown` does 9× split/join. [webview/markdown.config.ts](../webview/markdown.config.ts) — `compactLists`/`unescapeSpecialChars`/`stripAutolinks`/`unescapeBareUrls`/`replaceSafetyEntities`/`fixTaskLists`/`renumberOrderedLists`/`padTables`/`fixTableHeaders` each `md.split("\n")` and `lines.join("\n")`. Refactor to a single line-by-line pass that runs the enabled transforms per line, or pass `string[]` between helpers and join once at the end.
- [ ] 🛠 `markdownToHtml` swallows stack on failure. [webview/hooks/useEditorState.ts:156](../webview/hooks/useEditorState.ts#L156) sets a status string from `err?.message` but never logs the error object — unlike `htmlToMarkdown` failure ([useEditorState.ts:284](../webview/hooks/useEditorState.ts#L284)) which logs `[better-markdown] htmlToMarkdown failed:`. Add the same `console.error("[better-markdown] markdownToHtml failed:", err)` so the stack survives.
- [ ] 🛠 `FileReader` rejection loses context. [useEditorState.ts:24-33](../webview/hooks/useEditorState.ts#L24) (`fileToBase64`) does `reader.onerror = reject` → the catch site sees a `ProgressEvent` with no message. Wrap: `reader.onerror = e => reject(new Error(\`FileReader failed: ${e.type}\`))\`.
- [ ] 🔧 `markdownToDisplayHtml` skips frontmatter. [useVSCodeSync.ts](../webview/hooks/useVSCodeSync.ts) — `markdownToHtml` and `htmlToMarkdown` rely on the caller to `extractFrontmatter` / `prependFrontmatter`, but the diff view ([components/DiffView.tsx](../webview/components/DiffView.tsx)) calls `markdownToDisplayHtml(rawMarkdown)` directly. A `.md` file with YAML frontmatter renders the `---` block as raw markdown content in the diff. Fix: strip + reattach frontmatter in `markdownToDisplayHtml` (or have DiffView do it).
- [ ] 🧪 `webview/hooks/useVSCodeSync.ts` (DOMParser path) has no direct unit tests. The regex mirror in `test/pipeline.ts` is the only thing exercised in CI, and the two have already drifted on math entity handling (see P2). Add Vitest/jsdom tests that import the real `markdownToHtml` / `htmlToMarkdown` so the DOMParser path is covered.
- [ ] 🧪 `YouTubeEmbed`/`GitHubEmbed` URL parsers thinly tested. Category P has 3 cases; the parsers handle `youtu.be` short form, `youtube.com/watch?v=…`, `/shorts/`, `/embed/`, query/fragment combos, plus GitHub repo/PR/issue/blob/tree/commit variants. Add edge cases in test-conversions.ts category P.
- [ ] 🧪 Category-E (tables) misses alignment markers (`:---`, `---:`, `:---:`) and cell-internal newlines. Add round-trip tests.
- [ ] 🛠 Image-upload filename race. [src/provider.ts:287-299](../src/provider.ts#L287) does `while (true) { stat; counter++ }` then writes — two concurrent uploads can pick the same suffix. Switch to a write-with-`{ flag: "wx" }` retry loop so the OS guarantees uniqueness atomically.

### R3 — Low

- [ ] 🔧 `SlashCommand` stores callback via prototype patch. [webview/extensions/SlashCommand.tsx:186](../webview/extensions/SlashCommand.tsx#L186) — `(popup as any)._onSelect = …` is brittle; use a `WeakMap<TippyInstance, () => void>` or a closure-captured variable instead.
- [ ] 🔧 `data-btrmk-*` attribute names repeated as string literals across hooks/components. Centralize into a constants module (`DATA_TYPE`, `DATA_LATEX`, etc.) so renaming is one diff.
- [ ] 🔧 `"https://file+.vscode-resource.vscode-cdn.net"` repeated three times. [useVSCodeSync.ts:316,318,322](../webview/hooks/useVSCodeSync.ts#L316) — promote to a `VSCODE_RESOURCE_PREFIX` const.
- [ ] 🔧 App.tsx has two separate `MessageEvent` listeners ([App.tsx:146-163](../webview/App.tsx#L146)) for `openSettings` and `showSetupPrompt`. Fold into the existing `useEditorState` message handler so App.tsx loses two `useEffect`s.
- [ ] ⚡ `TableOfContents` filter recomputes `toLowerCase` on every render. [TableOfContents.tsx:192-193](../webview/components/TableOfContents.tsx#L192) — memoize the filtered list (and the lowercased filter string).
- [ ] 🎯 `MathInline` `useEffect` deps only `[selected]`. [MathInline.tsx:23-29](../webview/extensions/MathInline.tsx#L23) — `editor`/`getPos` are stable in practice but linting will complain. Add them or document the exemption.
- [ ] 🛠 `setTimeout(50)` in `onDidChangeTabs`. [src/extension.ts:217-221](../src/extension.ts#L217) — the 50 ms wait has no comment explaining the VS Code tab-init timing it depends on. Add a one-liner comment.
- [ ] 🛠 esbuild `.ttf`/`.woff(2)` loader vs `copyCSS()`. [esbuild.js:35-54,88-91](../esbuild.js#L35) — fonts may be both `dataurl`-inlined into the webview bundle and copied to `dist/fonts/`. KaTeX's CSS resolves them via relative URLs (i.e. the copied files); the inline loader may be dead. Verify and drop the loader if so — saves bundle bytes.
- [ ] 🔧 `renumberOrderedLists` has a `blankLineGap` local variable that's set but never read. [markdown.config.ts:239-266](../webview/markdown.config.ts#L239) — clean up alongside the P1 fence-guard fix.
- [ ] ⚡ Diff panel refreshes while hidden. [src/diffPanel.ts:131-138](../src/diffPanel.ts#L131) re-reads both docs + posts on every matching save even when not visible. Fix: early-return if `!panel.visible`, refresh on `onDidChangeViewState`.
- [ ] 🎨 H4/H5/H6 reuse H1/H2/H3 icons. [webview/components/EditorBubbleMenu.tsx:45-47](../webview/components/EditorBubbleMenu.tsx#L45) — lucide exports `Heading4/5/6`. Fix: use the correct icons.
- [ ] 🧹 (partial) `pendingWebviewEdits` not decremented on `applyEdit` failure. [src/provider.ts:314-321](../src/provider.ts#L314) — leaks one echo-suppression per failure (rare; not permanent). Fix: try/catch + decrement.
- [ ] 🧹 `migrateLegacySettings` fire-and-forget. [src/extension.ts:51](../src/extension.ts#L51) — inner updates are try/caught and migration is idempotent, but the final globalState writes are unguarded. Fix: top-level try/catch; set the done flag only after success.
- [ ] 🧹 Dead guard / stale ref in diff + provider. [src/diffPanel.ts:48-50](../src/diffPanel.ts#L48) `!panel.webview` is always false (remove); [src/provider.ts:342-345](../src/provider.ts#L342) `activeWebview` never nulled on dispose (clear it). Both low-impact (no crash).
- [ ] 🧹 `SlashCommand` `root.unmount()` not wrapped. [webview/extensions/SlashCommand.tsx:186](../webview/extensions/SlashCommand.tsx#L186) — null-guarded already; add try/catch as defense-in-depth.
- [ ] 🧹 esbuild watch configs duplicate the build configs. [esbuild.js:101-135](../esbuild.js#L101) — divergence risk (webview define hardcoded `"development"`). Fix: extract shared config consts.
- [ ] 🧪 Add tests guarding the above: category O LaTeX with `<`/`>`/`&` (catches the test-mirror divergence); category J literal `\[label](url)` round-trip (proves/refutes the `\[` corruption).

## Security Audit Supplement (2026-06-02)

Additional findings from the focused security & supply-chain audit (`docs/security-audit/2026-06-02-audit.md`). Items already in "Code Review Findings" above are not repeated.

### Extension-side hardening (independent of openInBrowser decision)

- [ ] 🔒 P1: `uploadImage` accepts any extension/filename — webview-controlled. Can overwrite `~/.bashrc`, `~/.command` files, etc. via malicious `.md` postMessage. [src/provider.ts:282-309](../src/provider.ts#L282). Fix: whitelist extensions (`png|jpg|jpeg|gif|webp|svg`) + content-hash filenames + size cap.
- [ ] 🔒 P2: `localResourceRoots` includes all workspace folders → webview can read any workspace file via `vscode-resource://` (combined with `img-src https:` enables exfil). [src/provider.ts:181-186](../src/provider.ts#L181). Fix: limit to `docFolder` only.
- [ ] 🔒 P2: Declare `capabilities.untrustedWorkspaces: {supported: "limited"}` and `virtualWorkspaces` in `package.json`. Currently unset → all features run on untrusted folders.
- [ ] 🔒 P2: Drop `https:` from CSP `img-src` (currently allows arbitrary trackers in markdown), reassess `wasm-unsafe-eval`. [src/provider.ts:385](../src/provider.ts#L385), [src/diffPanel.ts:194](../src/diffPanel.ts#L194).
- [ ] 🔒 P3: Use `crypto.getRandomValues` for nonce (currently `Math.random()`). [src/provider.ts:397-405](../src/provider.ts#L397), [src/diffPanel.ts:218-226](../src/diffPanel.ts#L218).
- [ ] 🔒 P3: Set `retainContextWhenHidden: false` to avoid memory residue after webview close. [src/extension.ts:61](../src/extension.ts#L61), [src/diffPanel.ts:68](../src/diffPanel.ts#L68).
- [ ] 🔒 P3: Add type/size validation to all `onDidReceiveMessage` handlers (cap base64 sizes; reject malformed payloads). [src/provider.ts:211-336](../src/provider.ts#L211).
- [ ] 🔒 P3: Use `URL` constructor for host validation before `vscode.env.openExternal`. [src/extension.ts:178-180](../src/extension.ts#L178), [src/provider.ts:258-259](../src/provider.ts#L258).

### Supply chain

- [ ] 🔧 P1: Replace `lucide-react@1.7.0` (v1 series freshly reset 2026-03, single maintainer) with inline SVGs in `webview/icons/`. ~25 icons across 9 files, ~150 LoC. Remove dep from `package.json`.
- [ ] 🔧 P1: Replace `diff2html` + transitive `@profoundlogic/hogan` (new fork created 2025-10-08) with `jsdiff`-based renderer in [webview/components/DiffView.tsx](../webview/components/DiffView.tsx). ~250 LoC. Removes 1 direct + 1 high-risk transitive dep.
- [ ] 🔧 P2: Bump `mermaid` to `11.14.1+` — resolves `GHSA-6m6c-36f7-fhxh` (Gantt DoS) and transitively `uuid@8.3.2`. Verify with `npm ls uuid`.

## Strategic Refactoring Plan (2026-06-02)

Large-scale structural improvements distilled from a "greenfield rewrite?" thought-experiment. **Do not greenfield-rewrite this project** — the existing round-trip test corpus (≈149 cases in `test/test-conversions.ts` + the full-file `test/test.md`) is institutional knowledge that took years to accumulate and is irreplaceable. Joel Spolsky's "Things You Should Never Do" applies.

Instead, execute these phases **in order**, in-place on the existing codebase. Each phase is independently shippable (no half-done branches) and earns back the engineering time it costs within ~2 release cycles. P0–P3 bug fixes and R1–R3 refactors above should run in parallel with these phases.

### 設計目標 (why these phases, in this order)

| 痛みの根源                                              | 現状                                                                                     | 目指す状態                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------- |
| **3 ファイル同期** ([CLAUDE.md](../CLAUDE.md) "最重要不変条件") | `useVSCodeSync.ts` (DOMParser) と `test/pipeline.ts` (regex 鏡像) を手で揃える                  | 本番コードをそのまま `linkedom` で Node テスト → 鏡像不要 |
| **4 箇所同期** (設定キー)                                  | `package.json` / `BetterMarkdownSettings` / `DEFAULT_SETTINGS` / `SETTING_KEYS` を手で揃える | 1 つの zod スキーマから全て派生                     |
| **9 連 split/join** (`normalizeMarkdown`)           | 関数追加が線形に重くなる                                                                           | プラグイン配列 + 1 パスで全変換                      |
| **`provider.ts` の god-class 化** (405 行)            | メッセージ追加のたびに if/else が伸びる                                                               | 型付きディスパッチテーブル + 責務別モジュール                |
| **`any` で抜けたメッセージ境界**                              | webview ↔ host のペイロード型がない                                                              | 判別共用体 (`type`) で end-to-end 型検査         |

### Phase A — Test infrastructure overhaul (~1 週間, 単独可能)

**目標**: `test/pipeline.ts` (regex 鏡像) を廃止し、本番 `webview/hooks/useVSCodeSync.ts` を Node 上で直接テストする。これが**全構造改革の前提条件**。

- [ ] 🧪 `linkedom` (または `jsdom`) を devDep に追加し、Node 上で `DOMParser`/`Document`/`Element` が動く環境を整える。`linkedom` を推奨 (jsdom より 30× 軽量、ssr ライクなパフォーマンス)。
- [ ] 🧪 `test/setup.ts` でグローバルに `globalThis.DOMParser = linkedom.DOMParser` を注入し、`tsx --import ./test/setup.ts` でテスト実行。
- [ ] 🧪 `test/test-conversions.ts` の `roundtripCase` を **本物の `useVSCodeSync.ts:markdownToHtml`/`htmlToMarkdown` を直接呼ぶ** ように書き換える。`test/pipeline.ts` の `mdToHtml`/`htmlToMd` 呼び出しを全て差し替え。
- [ ] 🧪 全 149 ケースが緑のまま動くまで linkedom の差分 (特に `DOMParser` の `<table>` 自動補完、`<p><img>` の wrap 挙動) を埋める。差分があれば test 側で吸収。
- [ ] 🧪 `test/pipeline.ts` を削除。CLAUDE.md の "3 ファイル同期" 不変条件のセクションを "本番コードを直接テストする" に書き換え。
- [ ] 🧪 `RoundTripOptions` に `settings?: BetterMarkdownSettings` / `baseUri?: string` / `docFolderPath?: string` を追加 (R1 で挙げた項目をここで吸収) → category N と画像相対パスを end-to-end で検証可能に。

**Phase A 完了の判定**: `test/pipeline.ts` が削除され、`npm test` 緑、`test-conversions.ts` から `useVSCodeSync.ts` の関数を直接 import している。**以後 Phase B 以降のテストは linkedom 環境を前提にできる**。

**リスク**: linkedom の DOM 実装が remark-rehype の出力 (例: `<table>` 内の `<tbody>` 自動挿入有無、HTML entity decode のタイミング) でブラウザと微差を出す可能性。発見したら test fixture 側で吸収するか、`happy-dom` に切り替える plan B を持つ。

### Phase B — Settings schema unification (~3 日, Phase A 後)

**目標**: 設定の 4 箇所同期を 1 箇所に。zod スキーマから全てを派生させる。

- [ ] 🎯 `zod` を依存に追加。`webview/settings-schema.ts` に **唯一の真実** として zod スキーマを書く:
  ```ts
  export const SettingsSchema = z.object({
    bullet: z.enum(["-", "*", "+"]).default("-").describe("Bullet list marker"),
    compactLists: z.boolean().default(true).describe("..."),
    // ...
  });
  export type BetterMarkdownSettings = z.infer<typeof SettingsSchema>;
  ```
- [ ] 🎯 `DEFAULT_SETTINGS` を `SettingsSchema.parse({})` で派生させる (`.default()` の自動収集)。
- [ ] 🎯 `SETTING_KEYS` を `Object.keys(SettingsSchema.shape)` で派生。
- [ ] 🎯 `package.json` の `contributes.configuration.properties` を **ビルド時に生成**: `zod-to-json-schema` で JSON schema を出力 → `scripts/gen-package-json-config.ts` が `package.json` の該当ブロックを書き換え → `npm run build` の prebuild で実行 + git で diff チェック (CI で drift 検出)。
- [ ] 🎯 host 側の `readSettings`/`writeSettings` (R1 で抽出予定の `settings-utils.ts`) で **読み取り時に zod parse** → 不正値は default にフォールバック (壊れた `.vscode/settings.json` で拡張が落ちない)。
- [ ] 🎯 `migrateLegacySettings` も schema 経由で型安全に。

**完了判定**: 設定キー追加が **1 ファイル 1 行** で完了する (zod スキーマに足すだけ)。`package.json` は自動生成 + CI でズレ検知。

**リスク**: VS Code Settings UI のラベル順序が schema の宣言順に依存。スキーマ宣言時に意図した順序で書く。

### Phase C — `normalizeMarkdown` plugin architecture (~1 週間, Phase A 後)

**目標**: 9 連 split/join を 1 パスに。各正規化を独立プラグインに。

- [ ] 🔧 `webview/markdown-normalizers/` ディレクトリを作り、各正規化を以下の形に切り出す:
  ```ts
  export interface Normalizer {
    name: keyof BetterMarkdownSettings;  // or null for always-on
    apply: (lines: string[], ctx: NormalizerContext) => string[];
  }
  ```
  `NormalizerContext` は `{ inCodeBlock: boolean; mathPlaceholders: Map<...>; settings }` を持ち、全プラグインで共有 → `inCodeBlock` の重複追跡を撲滅 (P1 `renumberOrderedLists` のバグの根本原因)。
- [ ] 🔧 `normalizeMarkdown(md, settings)` を **`lines = md.split("\n")` 1 回 → 各 normalizer を順次適用 → 最後に join 1 回** の構造に。split/join は 18 回 → 2 回。
- [ ] 🔧 既存の `compactLists`/`unescapeSpecialChars`/`stripAutolinks`/`unescapeBareUrls`/`replaceSafetyEntities`/`fixTaskLists`/`renumberOrderedLists`/`padTables`/`fixTableHeaders` を 1 プラグインずつ移植 → 各移植で test 緑を維持。
- [ ] 🔧 fence-tracking ヘルパー (`processOutsideCodeFences` 相当) を `NormalizerContext.eachNonCodeLine(callback)` として API 化 → R2 の "重複ループ撲滅" を内包。
- [ ] 🔧 移植完了後、`markdown.config.ts` から旧実装を削除。プラグイン順序は `markdown-normalizers/index.ts` の配列で明示。

**完了判定**: 新 normalizer 追加が **1 ファイル新規作成 + index.ts に 1 行追加** で済む。テストは全緑。

**リスク**: 順序依存 (例: `fixTaskLists` は `compactLists` より前) が暗黙だった部分を明示する必要。先に依存関係ドキュメント `markdown-normalizers/ORDER.md` を書いてから移植する。

### Phase D — Typed message protocol (~3 日, Phase B 後)

**目標**: webview ↔ host のメッセージ境界を判別共用体で型検査する。`provider.ts` の god-class を解体。

- [ ] 🎯 `src/messages.ts` (host + webview から import 可) に判別共用体を定義:
  ```ts
  export type HostToWebview =
    | { type: "init"; content: string; baseUri: string; ...settings: BetterMarkdownSettings }
    | { type: "update"; content: string }
    | { type: "settingsUpdated"; settings: BetterMarkdownSettings }
    | { type: "imageUploaded"; requestId: string; src: string }  // P1 で要求された requestId 同梱
    | { type: "gitDiffResponse"; head: string };

  export type WebviewToHost =
    | { type: "ready" }
    | { type: "edit"; content: string }
    | { type: "uploadImage"; requestId: string; name: string; dataBase64: string }
    | { type: "openLink"; href: string }
    | ...;
  ```
- [ ] 🎯 host 側に `handlers: { [K in WebviewToHost["type"]]: (msg: Extract<WebviewToHost, { type: K }>, ctx) => Promise<void> }` を持たせ、`onDidReceiveMessage` の中身を `handlers[msg.type]?.(msg, ctx)` 一行に。
- [ ] 🎯 各ハンドラを `src/handlers/` 配下に 1 ファイル 1 ハンドラで切り出し (`handle-upload-image.ts`, `handle-open-link.ts` …)。`provider.ts` 405 行 → 100 行台。
- [ ] 🎯 webview 側も `vscodeApi.postMessage` を `postMessage(msg: WebviewToHost)` のラッパーに置き換え → typo がコンパイルエラーに。
- [ ] 🎯 `server/index.ts` の WebSocket ハンドラも同じ `WebviewToHost` 型を使う → host と server の挙動が型レベルで一致。

**完了判定**: `provider.ts` < 150 行。ハンドラ追加が単一ファイル追加で済む。新メッセージは型検査で全エンドポイントの実装漏れを検知。

**リスク**: VS Code の `Webview.postMessage` は `any` を受けるので、API 自体の型は変えられない。ラッパー関数で吸収する。

### Phase E — Conversion layer extraction (~1 週間, Phase A + C 後)

**目標**: 変換パイプラインを単独モジュールに切り出す。Phase D まで終わると "ほぼ独立" になっているので、ここまで来たら追加コストは小さい。

- [ ] 🔧 `webview/conversion/` ディレクトリ (現 `useVSCodeSync.ts` + `markdown.config.ts` + `conversion-utils.ts` + `markdown-normalizers/`) を内部的に **「ブラウザでも Node でも動く純粋ライブラリ」** として整理:
  - `DOMParser` を `globalThis.DOMParser` 経由で参照 (Phase A の linkedom 注入で Node でも動く)
  - VS Code / Tiptap / React への依存をゼロに (現状ほぼゼロ; baseUri 文字列を引数で受けるだけ)
  - 公開 API は `markdownToHtml(md, opts?)` / `htmlToMarkdown(html, opts?)` / `markdownToDisplayHtml(md, opts?)` の 3 つに集約
- [ ] 🔧 単独ビルドターゲット `dist/conversion.js` を追加 (esbuild の 4 つ目のバンドル)。`server/index.ts` がこれを require できる形に。
- [ ] 🔧 サーバーや将来の CLI/preview ツールから再利用可能に。`docs/ARCHITECTURE.md` の "3. 変換パイプライン" セクションを更新。

**完了判定**: `webview/conversion/` が `webview/components/`, `webview/extensions/` から import されているが、逆向きの依存が**ゼロ** (`grep`で確認)。

**リスク**: 既存のコンパイル設定変更で `node_modules` 解決が壊れる可能性。Phase A の Node 実行環境が固まっていれば検証は容易。

### Phase F — Monorepo split (オプション, Phase E 後)

**目標**: `pnpm workspaces` で `@markdown-studio/conversion`, `@markdown-studio/tiptap-md`, `@markdown-studio/editor-app`, `@markdown-studio/vscode-extension`, `@markdown-studio/web-server` の 5 パッケージに分割。

- [ ] 🚧 **これは「やる価値があるか」を Phase E 完了時点で再評価する**。conversion パッケージを npm 公開する具体的需要が無いなら、見送り推奨。monorepo はビルド設定・CI・依存管理の複雑さを永続的に追加する。
- [ ] 🚧 やる場合: Phase E の conversion 抽出が前提。`tiptap-md` (拡張) → `editor-app` (React UI) → `vscode-extension` (アダプタ) の順で薄く剥がす。
- [ ] 🚧 release pipeline は `vsce` が monorepo 内の workspace 解決をどう扱うか先に検証 ([vscode-vsce#421](https://github.com/microsoft/vscode-vsce/issues/421) 周辺)。

**完了判定**: 各パッケージの責務が `README.md` 1 段落で説明可能。`vscode-extension` パッケージは `< 500 LoC`。

**リスク**: 最も高い。Phase A–E で 80% の構造改善は達成済みなので、F なしでも十分プロフェッショナルなコードベース。

### 並走可能な雑務 (Phase A 完了が前提)

- [ ] 🛠 Storybook を `webview/components/` 用に導入 → `DiffView`, `EditorBubbleMenu`, `SettingsPanel`, `TableControls` を VS Code 起動なしで反復開発できる。Phase A の linkedom 環境とは独立。
- [ ] 🛠 Vitest を `tsx` の代わりに導入 (Phase A 完了後)。`vitest --coverage` でカバレッジ 30% → 70% を可視化。test-conversions の `eq`/`assert`/`roundtripCase` を vitest の `it`/`expect` にマッピングする shim を書けば移植コストは低い。
- [ ] 🛠 `e2e/` ディレクトリで `@vscode/test-electron` ベースの E2E テストを 5–10 ケース足す → `provider.ts` の WorkspaceEdit ロジックや `migrateLegacySettings` のような単体テスト不能な領域をカバー。

### Phase の進め方 (recommended sequencing)

```
週 1: Phase A (test infra)              ← 全ての前提
週 2: R1 の 6 項目を着手 (並行)
週 3: Phase B (settings) + Phase C 着手  ← 独立、並行可
週 4: Phase C 完了
週 5: Phase D (message protocol)         ← Phase B 後
週 6: Phase E (conversion extraction)
─────────────────────────────────────
ここで一度立ち止まり、Phase F の必要性を評価する。
不要なら R2/R3 と P0–P3 残務に集中。
```

**強い推奨**: Phase A 完了前に Phase B–E の作業を始めないこと。3 ファイル同期問題を抱えたまま大規模リファクタすると、テストが嘘をつくため回帰が見えない。

### Privacy

- [ ] 🎨 P3: Drop YouTube thumbnail external fetch (`img.youtube.com`) — replace with play-icon placeholder. Pairs with CSP `img-src` tightening above. [webview/extensions/YouTubeEmbed.tsx:144-152](../webview/extensions/YouTubeEmbed.tsx#L144).
- [ ] 🎨 P3: Hash absolute paths in `betterMarkdown.cursors` globalState to avoid persisting sensitive filenames. [src/provider.ts:62-75](../src/provider.ts#L62).

## Done

- [x] 🔒 P1: **Remove `betterMarkdown.openInBrowser` command and bundled local server entirely.** Eliminated all dev-server findings (Code Review P0 shell injection + P1 server items + the per-item additions) in one stroke. Touched: `package.json` (commands), `src/extension.ts` (spawn + CodeLens), `src/provider.ts` (handler), `server/` (deleted dir), `esbuild.js` (serverBuild), `dist/server.js` (artifact), README/CHANGELOG.
- [x] Toggle between rich/source editor (Cmd+Shift+M)
- [x] Ctrl+F find-in-page with highlighting (CSS Custom Highlight API + mark fallback)
- [x] h4–h6 headings round-trip natively via Tiptap (earlier metadata-comment workaround removed in a75d719)
- [x] Prefix all console logging with `[better-markdown]`
- [x] Fix list item formatting (orphaned markers, loose lists)
- [x] Syntax highlighting in code blocks (lowlight)
- [x] Ctrl+F for editor content; persistent filter on TOC
- [x] Line-wrap TOC entries, truncate at 128 chars
- [x] Migrate from BlockNote to Tiptap (blockquotes, HRs, h1-h6, task lists)
- [x] Slash command menu (/ at start of line)
- [x] Fix list nesting round-trip (wrap bare `<li>` text in `<p>` for Tiptap parser)
- [x] Fix table corruption with `|` inside code spans (protect pipes before remark parse)
- [x] Unescape `\_` in variable names, `\[` brackets, `\~` tildes
- [x] Task list checkbox round-trip (GFM ↔ Tiptap taskItem conversion)
- [x] Image separation (each image in its own `<p>` block)
- [x] Fix `\|` double-escape in code spans within table cells (use negative lookbehind)
- [x] Unescape `\_` around Unicode word chars (&#x3B2;_<!---->_<!---->kl, &#x65E5;_<!---->_<!---->_&#x672C;) — use `\p{L}` instead of `\w`
- [x] `compactLists` preserves blank lines around indented paragraphs (verified via test coverage)
- [x] Git diffs work — non-file URIs render read-only in Tiptap with a badge
- [x] Copy as markdown source — selection serialised to .md on Cmd+C / Cmd+X
- [x] Settings panel in webview — every normalization step + serializer marker configurable, persisted via globalState
- [x] Rich diff view — inline toggle (vs HEAD) + standalone panel via `betterMarkdown.openDiff`, wired into SCM context menu, diff-editor toolbar, and command palette
- [x] Diff view has Source (line, diff2html) and Rendered (word-level, node-htmldiff) modes with green/red/blue highlighting and native GFM checkbox rendering
- [x] Prev/Next hunk navigation in Rendered diff (↑/↓ buttons, j/k shortcuts)
- [x] Table row/column controls — floating toolbar (add/delete row/column) appears when cursor is inside a table
- [x] Fix task list checkbox alignment — use matching `1.6em` line-height units instead of hardcoded px offset
- [x] Non-file URIs (git:, scm:) fall back to VS Code's native text editor instead of rich editor
- [x] Extension diff defaults to rendered (rich) mode instead of source
- [x] Strip `<https://...>` autolinks back to bare URLs; unescape `\=` before non-`=` content
- [x] Ctrl+F → Esc places cursor at the active match; reopening Ctrl+F resumes with same query and position
- [x] Math support — inline (`$...$`) and block (`$$...$$`) via KaTeX rendering, slash commands `/Math Block` and `/Inline Math`, click-to-edit LaTeX source
- [x] Don't parse currency `$` signs as math delimiters (1d51609)
- [x] Table formatting normalized to eliminate first-roundtrip whitespace diffs (6a9737e, b220192)
- [x] Auto-close non-file custom editor tabs (git:, scm: schemes) via `onDidChangeTabs`
- [x] Full image support — insert dialog, drag-and-drop, paste, captions, custom NodeView (e15f135)
- [x] CodeLens "Open in Rich Editor" above line 1 in the native markdown editor
- [x] Refactor App.tsx into focused hooks (`useSettingsPanel`, `useEditorState`, `useClipboardHandlers`, `useDragDrop`) (64aa575)
- [x] Graceful fallback when Claude Code edits can't be intercepted pre-acceptance (04b2502)
- [x] Consolidate README assets under `assets/`, drop external `markdown-studio-issues` image hosting

## Remaining (legacy backlog — validated 2026-06-02)

- [ ] **Publishing automation** _(partial)_ — core auto-publish via [.github/workflows/publish.yml](../.github/workflows/publish.yml) is implemented on `v*` tag. Remaining細目 (`tsx`/`ovsx` to devDeps, `ci.yml` for PR validation) are now split as Code Review Findings P1 items above. Original notes preserved:
  - **One-time human setup**: (1) Azure DevOps PAT with scope `Marketplace → Manage` → repo secret `VSCE_PAT`; (2) open-vsx.org access token → repo secret `OVSX_PAT`.
  - **Release flow once wired**: bump `package.json` version + `CHANGELOG.md` → commit → `git tag v2.0.1 && git push --tags` → workflow runs, both marketplaces update within ~5 minutes.
- [ ] Claude Code rich diff integration — blocked on Claude Code exposing proposed content before acceptance (see SPEC.md § Claude Code Integration)
- [ ] TOC should highlight diffed headings (added/removed/changed) when diff view is active
- [ ] Claude Code integration — live diff in the rich editor when Claude edits a .md file; show accept (tick) / reject (cross) icons inline so the user can review and apply suggestions directly without leaving the rich editor (same blocker as above)
- [ ] esc. key should highlight the entire line just like notion
- [ ] make sure cursor does not vanish/gets autofocused after navigating inside/outside of katex _(partial)_ — `cbe8e70` covers `Ctrl+A select-all`; bidirectional click-in/out paths may still drop focus
- [ ] ⚠️ Bullet points nested inside checkboxes — **要ブラウザ検証**: `TaskItem.configure({ nested: true })` is enabled at [webview/App.tsx:70](../webview/App.tsx#L70) and no failing round-trip test exists. Bug may already be fixed; verify in browser before keeping or closing.
- [ ] Preserve inline sibling images side-by-side (e.g. README badge rows). Right now consecutive `![...]` on one line get split into separate paragraphs on round-trip, and raw `<p><img/>...</p>` HTML blocks are dropped entirely — so there's no way to keep a row of shields.io badges side-by-side through the rich editor. Fix in `webview/hooks/useVSCodeSync.ts` + `test/pipeline.ts`; add a test case in category I (images).
- [ ] Fix `docs/SPEC.md:209-212` numbered list — currently restarts at `1.` mid-list (should be `6.`–`9.`). Likely same root cause as `renumberOrderedLists` in Code Review P1; verify both are fixed together. Repro diff:

```diff
@@ -205,10 +205,10 @@ better-markdown/
    - Image followed by duplicate alt-text line → dedup
    - Compact lists (remove blank lines between items)
    - Orphaned list marker merging
-6. Restore math from code/pre placeholders back to `$...$` / `$$...$$`
-7. `/` `&` HTML entity cleanup
-8. `prependFrontmatter()` restores YAML frontmatter at top of file
-9. Strip webview URI prefixes to restore relative image paths
+1. Restore math from code/pre placeholders back to `$...$` / `$$...$$`
+2. `/` `&` HTML entity cleanup
+3. `prependFrontmatter()` restores YAML frontmatter at top of file
+4. Strip webview URI prefixes to restore relative image paths
```

---

## Resolved / Invalid (2026-06-02 validation pass)

- ~~Add mermaid diagrams~~ — RESOLVED: implemented in [webview/extensions/MermaidBlock.tsx](../webview/extensions/MermaidBlock.tsx), `mermaid@^11.14.0` dep, slash command at `SlashCommand.tsx:34` (commit `7e76e26`)
- ~~Add buttons as "editors" generally do, to insert checkboxes etc.~~ — RESOLVED: [SlashCommand.tsx:17-40](../webview/extensions/SlashCommand.tsx#L17) + [EditorBubbleMenu.tsx:40-53](../webview/components/EditorBubbleMenu.tsx#L40) provide 12+ insertion options (Task List, Code Block, Math, Mermaid, Image, YouTube, GitHub, etc.)
- ~~Diff view scrolls the navigator row and cuts it in half~~ — RESOLVED: fixed in commits `5c0c65e` / `70a5ca0`. `.diff-toolbar` uses `flex-shrink:0`, only `.diff-body` scrolls (`webview/styles/editor.css:1243-1302`)
- ~~Embeddings for YouTube & GitHub like Notion~~ — RESOLVED: [YouTubeEmbed.tsx](../webview/extensions/YouTubeEmbed.tsx) + [GitHubEmbed.tsx](../webview/extensions/GitHubEmbed.tsx) exist, registered in slash menu and test pipeline (commit `917e9ab`)

---

## Known Limitations

- Escaped markdown characters (`\*`, `\_`) lose backslash on round-trip (Tiptap stores rendered text, not source).
