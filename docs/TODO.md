# Markdown Studio — TODO

## Code Review Findings (2026-06-02)

Multi-agent review + adversarial verification. Ordered by priority. Each verified against the actual code; refuted false positives omitted. `(partial)` = real but narrower than first reported.

### P0 — Critical (shipped security)

- [ ] 🔒 Shell injection in dev-server `openLink` (RCE). [server/index.ts:365-377](../server/index.ts#L365) interpolates a WebSocket-supplied `href` into `` exec(`open "${href}"`) `` (also `start`/`xdg-open`). The server ships in the vsix (`dist/server.js`, spawned by "Open in Browser") and binds all interfaces on :3333 with no origin check → arbitrary command execution. Fix: `execFile("open", [href])` (no shell) + allowlist `http`/`https`/`mailto` schemes.

### P1 — High

- [ ] 🔒 Shell injection in dev-server `toggleEditor`. [server/index.ts:402-407](../server/index.ts#L402) does `` exec(`code "${filePath}"`) ``; a file path containing shell metachars injects. Same flaw in the `requestGitDiff` handler (`git show HEAD:"..."` interpolation, ~line 386). Fix: `execFile("code", [filePath])` and `execFile` for git.
- [ ] 🔒 Path traversal in dev-server `/doc/` image route. [server/index.ts:282-289](../server/index.ts#L282) joins `path.join(dir, file)` with no canonicalization (the upload route uses `path.basename`, this one doesn't) → reads files outside `dir`. Fix: `const r = path.resolve(dir, file); if (!r.startsWith(path.resolve(dir)+path.sep)) return 403;`.
- [ ] 🐛 `renumberOrderedLists` corrupts fenced code / math-block content. [webview/markdown.config.ts:239-266](../webview/markdown.config.ts#L239) has no `inCodeBlock` guard (every sibling normalizer does), and it runs before math placeholders are restored → numbered lines inside ```` ``` ```` blocks or `btrmk-math-block` fences get renumbered. Enabled by default. Fix: add the same fence-toggle guard. Add a category-N/code-block test.
- [ ] 🐛 Embed `exit()` reads stale `node.attrs.url`. [webview/extensions/YouTubeEmbed.tsx:65-68](../webview/extensions/YouTubeEmbed.tsx#L65) and [GitHubEmbed.tsx:144-147](../webview/extensions/GitHubEmbed.tsx#L144) call `save()` (`updateAttributes`) then guard cursor placement on `node.attrs.url`, which hasn't flushed → caret left inside a freshly-created embed. Fix: guard on local `url.trim()`.
- [ ] 🐛 Image-upload reply has no request-id or timeout. [webview/hooks/useEditorState.ts:86-100](../webview/hooks/useEditorState.ts#L86) matches `imageUploaded` by type only; concurrent multi-image drop resolves every pending promise with the first reply's `src` (wrong image), and a missing reply leaks the listener forever. Fix: correlate by unique request id + add a timeout that rejects.
- [ ] ⚙️ `tsx` not in deps/devDeps/lockfile. [package.json:259](../package.json#L259) `npm test` / `serve` use `npx tsx`; CI runs `npm ci` then `npm test`, relying on a live npx download → publish/CI fragility. Fix: `npm i -D tsx`.
- [ ] ⚙️ `ovsx` not in deps/devDeps/lockfile. [.github/workflows/publish.yml:43](../.github/workflows/publish.yml#L43) `npx ovsx publish` live-downloads at publish time (vsce is pinned, ovsx isn't) → Open VSX publish can break. Fix: `npm i -D ovsx`.
- [ ] ⚙️ No CI on PR / push. Only [publish.yml](../.github/workflows/publish.yml) exists (tag-triggered); tests run only at release → a broken master is caught only when tagged. Fix: add `ci.yml` on `pull_request`/`push` running `npm ci && npm test && node esbuild.js`.

### P2 — Medium

- [ ] 🐛 Fixed 1500 ms wait for the browser-preview server. [src/extension.ts:162-176](../src/extension.ts#L162) sleeps then opens the URL with no readiness probe and no `on("error")` handler → races on slow start / busy port, opens a dead address if the server exited. Fix: poll `localhost:3333` for readiness; bail/notify on spawn error or early exit.
- [ ] 🐛 (partial) `openLink` opens arbitrary local files. [src/provider.ts:256-269](../src/provider.ts#L256) resolves a webview-supplied non-http `href` via `path.resolve(docDir, href)` and `vscode.open` with no confinement → can open files outside the workspace (bounded: opens in an editor, no exec). Fix: verify the resolved path stays within a workspace folder.
- [ ] 🐛 (partial/latent) Math test mirror diverges from production on `<`/`>`/`&`. [test/pipeline.ts:93-98](../test/pipeline.ts#L93) captures entity-encoded span text; production [useVSCodeSync.ts:182](../webview/hooks/useVSCodeSync.ts#L182) reads DOM-decoded `data-latex`. Currently both round-trip the same, but a production regression on LaTeX with `<` would escape tests. Fix: source the placeholder from `data-latex` + decode entities in the test mirror.
- [ ] 🐛 (partial) Naive single-backtick code-span scanning. [webview/markdown.config.ts:130-144](../webview/markdown.config.ts#L130) (and the same logic in `stripAutolinks`/`unescapeBareUrls`/`splitTableRow`) closes a code span at the next single backtick, mis-parsing double-backtick spans like `` ``foo`bar`` `` → unescaping leaks into protected code. Fix: match backtick runs by length (CommonMark).
- [ ] 🐛 (partial) Overbroad `\[` unescape. [webview/markdown.config.ts:168](../webview/markdown.config.ts#L168) strips `\[` unconditionally; literal text `\[label](url)` may re-parse as a link on reload. Corruption loop unproven (remark may escape the `]`/`(` too). Fix: skip the unescape when a `\[...\](` link shape follows; add the verifying round-trip test below.
- [ ] 🐛 Leaked panel listeners. [src/provider.ts:343,364](../src/provider.ts#L343) discards the `onDidChangeViewState` and the second `onDidDispose` disposables (low impact — panel-scoped — but inconsistent with the other two). Fix: store and dispose them.
- [ ] ⚙️ `copyCSS()` not re-run in `--watch`. [esbuild.js:93-95](../esbuild.js#L93) copies CSS/fonts once; watch contexts never re-invoke it → stale `dist/editor.css` on style edits during dev. Fix: `build.onEnd(() => copyCSS())` plugin on the webview watch context.
- [ ] ⚙️ `server/` never type-checked. [tsconfig.json:7](../tsconfig.json#L7) scopes `tsc` to `src/`; esbuild transpiles `server/index.ts` without type-checking. Fix: add `server/**` to a tsconfig + `tsc --noEmit` in CI.

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
- [ ] 🛠 `FileReader` rejection loses context. [useEditorState.ts:24-33](../webview/hooks/useEditorState.ts#L24) (`fileToBase64`) does `reader.onerror = reject` → the catch site sees a `ProgressEvent` with no message. Wrap: `reader.onerror = e => reject(new Error(\`FileReader failed: ${e.type}\`))`.
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

### Strategic option (supersedes per-item server fixes)

- [ ] 🔒 P1: **Remove `betterMarkdown.openInBrowser` command and bundled local server entirely.** Eliminates all dev-server findings (Code Review P0 shell injection + P1 server items + the per-item additions below) in one stroke. Touches: `package.json` (commands), [src/extension.ts:130-193](../src/extension.ts#L130) + [:243](../src/extension.ts#L243) (spawn + CodeLens), [src/provider.ts:271-275](../src/provider.ts#L271) (handler), `server/` (delete dir), [esbuild.js:25-31](../esbuild.js#L25) (serverBuild), `dist/server.js` (artifact), README/CHANGELOG. **Choose between this and per-item server fixes.**

### Extension-side hardening (independent of openInBrowser decision)

- [ ] 🔒 P1: `uploadImage` accepts any extension/filename — webview-controlled. Can overwrite `~/.bashrc`, `~/.command` files, etc. via malicious `.md` postMessage. [src/provider.ts:282-309](../src/provider.ts#L282). Fix: whitelist extensions (`png|jpg|jpeg|gif|webp|svg`) + content-hash filenames + size cap.
- [ ] 🔒 P2: `localResourceRoots` includes all workspace folders → webview can read any workspace file via `vscode-resource://` (combined with `img-src https:` enables exfil). [src/provider.ts:181-186](../src/provider.ts#L181). Fix: limit to `docFolder` only.
- [ ] 🔒 P2: Declare `capabilities.untrustedWorkspaces: {supported: "limited"}` and `virtualWorkspaces` in `package.json`. Currently unset → all features run on untrusted folders.
- [ ] 🔒 P2: Drop `https:` from CSP `img-src` (currently allows arbitrary trackers in markdown), reassess `wasm-unsafe-eval`. [src/provider.ts:385](../src/provider.ts#L385), [src/diffPanel.ts:194](../src/diffPanel.ts#L194).
- [ ] 🔒 P3: Use `crypto.getRandomValues` for nonce (currently `Math.random()`). [src/provider.ts:397-405](../src/provider.ts#L397), [src/diffPanel.ts:218-226](../src/diffPanel.ts#L218).
- [ ] 🔒 P3: Set `retainContextWhenHidden: false` to avoid memory residue after webview close. [src/extension.ts:61](../src/extension.ts#L61), [src/diffPanel.ts:68](../src/diffPanel.ts#L68).
- [ ] 🔒 P3: Add type/size validation to all `onDidReceiveMessage` handlers (cap base64 sizes; reject malformed payloads). [src/provider.ts:211-336](../src/provider.ts#L211).
- [ ] 🔒 P3: Use `URL` constructor for host validation before `vscode.env.openExternal`. [src/extension.ts:178-180](../src/extension.ts#L178), [src/provider.ts:258-259](../src/provider.ts#L258).

### Server-side additions (only if openInBrowser kept)

- [ ] 🔒 P1: Arbitrary write via `/upload/<base64dir>/<filename>` — `dir` is base64url, not confined. Can write to `/etc/cron.d/`, `~/.ssh/authorized_keys`, etc. [server/index.ts:247-279](../server/index.ts#L247). Fix: confine `dir` to allowlist of WS-known directories.
- [ ] 🔒 P1: WS `saveSettings` writes any payload to `~/.better-markdown-settings.json` with no validation, then broadcasts. [server/index.ts:353-362](../server/index.ts#L353). Fix: `SETTING_KEYS` whitelist + type check.
- [ ] 🔒 P2: Bind server to `127.0.0.1` only (not all interfaces). Require WS `origin` header check (CSWSH defense). Add start-time random token in URL. [server/index.ts:419](../server/index.ts#L419), [:302-312](../server/index.ts#L302).

### Supply chain

- [ ] 🔧 P1: Replace `lucide-react@1.7.0` (v1 series freshly reset 2026-03, single maintainer) with inline SVGs in `webview/icons/`. ~25 icons across 9 files, ~150 LoC. Remove dep from `package.json`.
- [ ] 🔧 P1: Replace `diff2html` + transitive `@profoundlogic/hogan` (new fork created 2025-10-08) with `jsdiff`-based renderer in [webview/components/DiffView.tsx](../webview/components/DiffView.tsx). ~250 LoC. Removes 1 direct + 1 high-risk transitive dep.
- [ ] 🔧 P2: Bump `mermaid` to `11.14.1+` — resolves `GHSA-6m6c-36f7-fhxh` (Gantt DoS) and transitively `uuid@8.3.2`. Verify with `npm ls uuid`.
- [ ] 🔧 P2: Bump `ws` to `8.20.1+`.

### Privacy

- [ ] 🎨 P3: Drop YouTube thumbnail external fetch (`img.youtube.com`) — replace with play-icon placeholder. Pairs with CSP `img-src` tightening above. [webview/extensions/YouTubeEmbed.tsx:144-152](../webview/extensions/YouTubeEmbed.tsx#L144).
- [ ] 🎨 P3: Hash absolute paths in `betterMarkdown.cursors` globalState to avoid persisting sensitive filenames. [src/provider.ts:62-75](../src/provider.ts#L62).

## Done

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
- [x] Unescape `\_` around Unicode word chars (&#x3B2;_&#x6B;l, &#x65E5;_&#x672C;) — use `\p{L}` instead of `\w`
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
- [x] CodeLens "Open in Rich Editor" / "Open in Browser" above line 1 in the native markdown editor
- [x] Refactor App.tsx into focused hooks (`useSettingsPanel`, `useEditorState`, `useClipboardHandlers`, `useDragDrop`) (64aa575)
- [x] Graceful fallback when Claude Code edits can't be intercepted pre-acceptance (04b2502)
- [x] Consolidate README assets under `assets/`, drop external `markdown-studio-issues` image hosting

## Remaining (legacy backlog — validated 2026-06-02)

- [ ] **Publishing automation** *(partial)* — core auto-publish via [.github/workflows/publish.yml](../.github/workflows/publish.yml) is implemented on `v*` tag. Remaining細目 (`tsx`/`ovsx` to devDeps, `ci.yml` for PR validation) are now split as Code Review Findings P1 items above. Original notes preserved:
  - **One-time human setup**: (1) Azure DevOps PAT with scope `Marketplace → Manage` → repo secret `VSCE_PAT`; (2) open-vsx.org access token → repo secret `OVSX_PAT`.
  - **Release flow once wired**: bump `package.json` version + `CHANGELOG.md` → commit → `git tag v2.0.1 && git push --tags` → workflow runs, both marketplaces update within ~5 minutes.
- [ ] Claude Code rich diff integration — blocked on Claude Code exposing proposed content before acceptance (see SPEC.md § Claude Code Integration)
- [ ] TOC should highlight diffed headings (added/removed/changed) when diff view is active
- [ ] Claude Code integration — live diff in the rich editor when Claude edits a .md file; show accept (tick) / reject (cross) icons inline so the user can review and apply suggestions directly without leaving the rich editor (same blocker as above)
- [ ] esc. key should highlight the entire line just like notion
- [ ] make sure cursor does not vanish/gets autofocused after navigating inside/outside of katex *(partial)* — `cbe8e70` covers `Ctrl+A select-all`; bidirectional click-in/out paths may still drop focus
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
