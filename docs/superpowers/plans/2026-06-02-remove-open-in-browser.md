# Remove `openInBrowser` + bundled server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the entire `betterMarkdown.openInBrowser` feature — the VS Code command, the bundled local HTTP/WS server, the webview "Open in Browser" button, and the browser-mode WebSocket shim — to remove the security attack surface identified in `docs/security-audit/2026-06-02-audit.md` (C-1 through C-4, M-5, M-6, H-4).

**Architecture:** Pure deletion + simplification. After this change the webview only runs inside a VS Code custom editor; `webview/vscode-api.ts` collapses to a direct `acquireVsCodeApi()` shim. No new code paths.

**Tech Stack:** TypeScript, esbuild, VS Code Extension API, Tiptap/React (webview).

---

## File-by-file impact

| File | Change |
| --- | --- |
| `server/index.ts` | DELETE entire `server/` directory |
| `src/extension.ts` | Delete `openInBrowser` command (`:130-193`), the `Open in Browser` CodeLens entry (`:243-246`), the `serverProcess` cleanup `dispose` subscription, the unused `ChildProcess`/`spawn` imports |
| `src/provider.ts` | Delete the `openInBrowser` message handler (`:271-275`) |
| `webview/App.tsx` | Delete the `Open in Browser` button + `isBrowserMode` conditional render; collapse the surrounding toggle row; remove `isBrowserMode` from imports; remove `openInBrowser` from `useEditorState` destructuring |
| `webview/hooks/useEditorState.ts` | Delete the `isBrowserMode` import; delete the `if (isBrowserMode) { … }` branch in the `uploadImage` callback (browser-mode HTTP `POST /upload/…`); delete the `openInBrowser` callback + its export |
| `webview/vscode-api.ts` | Delete `createBrowserShim`, `isVsCodeWebview`, `isBrowserMode`; collapse to direct `acquireVsCodeApi()` |
| `package.json` | Remove `betterMarkdown.openInBrowser` command entry; remove `serve` npm script; remove `ws` + `@types/ws` dependencies; bump version `2.3.7` → `2.3.8` |
| `esbuild.js` | Delete `serverBuild` and its watch context; remove from `Promise.all` |
| `.vscodeignore` | Remove `server/**` line (directory no longer exists) |
| `README.md` | Remove `### Seamless Sync.` line "Open in the Browser.", `#### Browser` section, `Open in Browser` command row, mentions of "and Browser modes" |
| `CHANGELOG.md` | Add new `## 2.3.x` entry under existing 2.3.x header documenting the removal + security rationale |
| `docs/ARCHITECTURE.md` | Remove standalone-server sections (lines documenting the dev server, browser mode, port 3333, server-side settings JSON) |
| `docs/SPEC.md` | Update the CodeLens line (line 66) to drop "and Open in Browser" |
| `docs/TODO.md` | Mark the Strategic option checkbox as completed |

Assets referenced from the removed README sections (`assets/browser-mode-overview.png`, `assets/seamless-sync.gif`) are left in place — they are not on the publish allowlist (`.vscodeignore` only includes `assets/logo7.png`), so they don't ship in the VSIX. Leaving them avoids touching git LFS / binary deletes that the user didn't ask for.

---

### Task 1: Remove the webview-side server/browser-mode plumbing

This task removes everything in the webview that depends on the standalone server first, so the host-side delete in Task 2 can't break the build by leaving dangling references.

**Files:**
- Modify: `webview/vscode-api.ts`
- Modify: `webview/hooks/useEditorState.ts:11, 68-101, 327-329, 371`
- Modify: `webview/App.tsx:35, 85-101, 251-270`

- [ ] **Step 1: Simplify `webview/vscode-api.ts` to a direct `acquireVsCodeApi()` shim**

Replace the entire file contents with:

```ts
/**
 * Webview ⇄ extension host bridge. The extension always runs inside a
 * VS Code custom editor, so `acquireVsCodeApi()` is guaranteed to exist.
 */

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

const KEY = "__BTRMK_VSCODE_API__";

export const vscodeApi: VsCodeApi = (() => {
  const w = window as any;
  if (w[KEY]) return w[KEY];
  const api = acquireVsCodeApi();
  w[KEY] = api;
  return api;
})();
```

- [ ] **Step 2: Strip browser-mode plumbing from `useEditorState.ts`**

  a. At line 11, drop `isBrowserMode` from the import. Change:

  ```ts
  import { vscodeApi, isBrowserMode } from "../vscode-api";
  ```

  to:

  ```ts
  import { vscodeApi } from "../vscode-api";
  ```

  b. In the `uploadImage` callback (~`:68-101`), delete the browser-mode branch (~`:74-84`):

  ```ts
    if (isBrowserMode) {
      const match = baseUri.current.match(/\/doc\/([^/]+)$/);
      if (!match) throw new Error("Cannot determine upload target");
      const resp = await fetch(
        `/upload/${match[1]}/${encodeURIComponent(name)}`,
        { method: "POST", body: file },
      );
      if (!resp.ok) throw new Error("Upload failed");
      const data = await resp.json();
      return `${baseUri.current}/${data.filename}`;
    }
  ```

  The remaining body (`const base64 = await fileToBase64(file); …` from ~`:85-100`) becomes the entire callback body. No other change to `uploadImage`.

  c. Delete the `openInBrowser` callback (~`:327-329`):

  ```ts
    const openInBrowser = useCallback(() => {
      vscodeApi.postMessage({ type: "openInBrowser" });
    }, []);
  ```

  d. Remove `openInBrowser,` from the return object (~`:371`) so the destructured shape changes from `{ … switchToSource, openInBrowser, toggleDiff }` to `{ … switchToSource, toggleDiff }`.

- [ ] **Step 3: Remove `isBrowserMode` and the "Open in Browser" button from `App.tsx`**

  a. At the import line (`:35`), change:

  ```tsx
  import { isBrowserMode, vscodeApi } from "./vscode-api";
  ```

  to:

  ```tsx
  import { vscodeApi } from "./vscode-api";
  ```

  b. In the `useEditorState` destructuring (~`:99`), drop `openInBrowser,` from the list.

  c. Replace the `toggle-source-row` block (~`:251-270`):

  ```tsx
  <div className="toggle-source-row">
    <span
      className="toggle-source"
      onClick={switchToSource}
      role="button"
      tabIndex={0}
    >
      {isBrowserMode ? "Open in VS Code" : "Open in Default Editor"}
    </span>
    {!isBrowserMode && (
      <span
        className="toggle-source"
        onClick={openInBrowser}
        role="button"
        tabIndex={0}
      >
        Open in Browser
      </span>
    )}
  </div>
  ```

  with:

  ```tsx
  <div className="toggle-source-row">
    <span
      className="toggle-source"
      onClick={switchToSource}
      role="button"
      tabIndex={0}
    >
      Open in Default Editor
    </span>
  </div>
  ```

- [ ] **Step 4: Verify the webview still type-checks**

Run: `node esbuild.js`
Expected: build completes; no "Cannot find name 'isBrowserMode'" / "Cannot find name 'openInBrowser'" errors. (At this point `server/` and `src/` still reference each other, so `serverBuild` will still succeed — we tear it down in Task 2.)

### Task 2: Remove the host-side command, server spawn, and CodeLens entry

**Files:**
- Modify: `src/extension.ts`
- Modify: `src/provider.ts:271-275`

- [ ] **Step 1: Delete the `openInBrowser` message handler in `src/provider.ts`**

Find the block (~`:271-275`):

```ts
      } else if (msg.type === "openInBrowser") {
        vscode.commands.executeCommand(
          "betterMarkdown.openInBrowser",
          document.uri,
        );
```

Delete it. The surrounding `else if` chain stays valid (the next branch is `promptImageUrl`).

- [ ] **Step 2: Delete the `openInBrowser` command + server lifecycle in `src/extension.ts`**

  a. Delete the imports for `spawn` and `ChildProcess` from line 3:

  ```ts
  import { spawn, ChildProcess } from "child_process";
  ```

  → remove the entire line. (Nothing else in the file uses them after this task.)

  b. Delete the entire `// Open in Browser` block (~`:129-193`) including:
     - The comment header
     - `let serverProcess: ChildProcess | null = null;`
     - The `vscode.commands.registerCommand("betterMarkdown.openInBrowser", …)` registration
     - The `context.subscriptions.push({ dispose() { … serverProcess.kill() … } })` block

  c. In `RichEditorCodeLensProvider.provideCodeLenses` (~`:234-248`), drop the second CodeLens entry. The method shrinks from:

  ```ts
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const range = new vscode.Range(0, 0, 0, 0);
    return [
      new vscode.CodeLens(range, {
        title: "Open in Rich Editor",
        command: "betterMarkdown.toggleEditor",
      }),
      new vscode.CodeLens(range, {
        title: "Open in Browser",
        command: "betterMarkdown.openInBrowser",
      }),
    ];
  }
  ```

  to:

  ```ts
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const range = new vscode.Range(0, 0, 0, 0);
    return [
      new vscode.CodeLens(range, {
        title: "Open in Rich Editor",
        command: "betterMarkdown.toggleEditor",
      }),
    ];
  }
  ```

  Note: `document` becomes unused. Leave it as-is — it's part of the `CodeLensProvider` interface contract and TS doesn't flag unused interface params.

### Task 3: Remove the server directory + esbuild target + package.json wiring

**Files:**
- Delete: `server/` (entire directory)
- Modify: `esbuild.js:24-31, 93, 109-115`
- Modify: `package.json` (command entry, `serve` script, `ws`/`@types/ws` deps, version bump)
- Modify: `.vscodeignore`

- [ ] **Step 1: Delete the `server/` directory**

Run: `rm -rf server/`
Expected: directory removed. `git status` shows `D server/index.ts`.

- [ ] **Step 2: Strip `serverBuild` from `esbuild.js`**

  a. Delete the `// 2. Server build …` block (~`:24-31`):

  ```js
  // 2. Server build (Node/CJS, bundled so it ships in the VSIX without tsx)
  const serverBuild = esbuild.build({
    ...commonOptions,
    entryPoints: ["server/index.ts"],
    outfile: "dist/server.js",
    platform: "node",
    format: "cjs",
  });
  ```

  b. In the `Promise.all` (~`:93`), change `Promise.all([extensionBuild, serverBuild, webviewBuild])` to `Promise.all([extensionBuild, webviewBuild])`.

  c. In the watch-mode `Promise.all` (~`:100-136`), delete the server watch context block:

  ```js
  esbuild.context({
    ...commonOptions,
    entryPoints: ["server/index.ts"],
    outfile: "dist/server.js",
    platform: "node",
    format: "cjs",
  }).then((ctx) => ctx.watch()),
  ```

- [ ] **Step 3: Update `package.json`**

  a. Delete the `Open in Browser` command entry (`:89-94`):

  ```json
        {
          "command": "betterMarkdown.openInBrowser",
          "title": "Open in Browser",
          "category": "Markdown Studio",
          "icon": "$(globe)"
        },
  ```

  Make sure the preceding entry (`betterMarkdown.openDiff`) still ends with `},` (it already does).

  b. Delete the `serve` script line (`:264`):

  ```json
      "serve": "node esbuild.js && npx tsx server/index.ts",
  ```

  c. Delete from `devDependencies` (~`:274`):

  ```json
      "@types/ws": "^8.18.1",
  ```

  d. Delete from `dependencies` (~`:313`):

  ```json
      "ws": "^8.20.0"
  ```

  Watch the trailing comma on the preceding line — `unified: "^11.0.5"` becomes the last entry and must end without a comma.

  e. Bump `"version": "2.3.7"` → `"version": "2.3.8"`.

- [ ] **Step 4: Clean `.vscodeignore`**

Find the line `server/**` and delete it. (`dist/**` ships into the VSIX; once `serverBuild` is gone, no `dist/server.js` is produced, so no further opt-out is needed.)

- [ ] **Step 5: Sync the lockfile**

Run: `npm install`
Expected: `package-lock.json` updates to remove `ws` and `@types/ws` resolutions. No error output.

- [ ] **Step 6: Verify the build still works end-to-end**

Run: `npm run build`
Expected: esbuild logs "Build complete." with no `dist/server.js` produced (verify via `ls dist/`).

### Task 4: Update user-facing docs

**Files:**
- Modify: `README.md:39-49, 65-87, 144-152`
- Modify: `CHANGELOG.md` (prepend entry under the existing `## 2.3.x — 2026-05-02` header)
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SPEC.md:66`
- Modify: `docs/TODO.md` (mark the Strategic option checkbox)

- [ ] **Step 1: Trim `README.md`**

  a. In the `### Seamless Sync.` section (~`:39-49`), delete the `Open in the Browser.` line (line 45). The block becomes:

  ```md
  ### Seamless Sync.

  Open in the Default Editor.

  Open in the Rich Editor.

  It just works.

  ![seamless-sync](assets/seamless-sync.gif)
  ```

  b. In `#### Default Editor` (~`:65-71`), change `Default editor supports opening in Rich Editor and Browser modes.` to `Default editor supports opening in Rich Editor mode.`.

  c. In `#### Rich Editor` (~`:75`), change `Rich editor allows to go back to default editor mode directly. Also allows opening in the browser. All information is automatically and instantly synced.` to `Rich editor allows to go back to default editor mode directly. All information is automatically and instantly synced.`.

  d. Delete the entire `#### Browser` section (~`:79-87`), including the heading and the `assets/browser-mode-overview.png` reference. The next heading after Rich Editor becomes `### Rich editing`.

  e. In the Commands table (~`:151`), delete the `Open in Browser` row entirely.

- [ ] **Step 2: Prepend a CHANGELOG entry**

In `CHANGELOG.md`, under the existing `## 2.3.x — 2026-05-02` header (line 3), insert a new bullet at the top of the list (the bullets are listed newest-first under each heading):

```md
- Security: Removed the `Open in Browser` command and the bundled localhost HTTP/WebSocket server (`server/index.ts`, `dist/server.js`). Several attack vectors lived in that server — shell injection via the WS `openLink`/`toggleEditor` handlers (`open "${href}"` / `code "${path}"`), path traversal in the `/doc/<base64dir>/<file>` route, arbitrary writes via `/upload/<base64dir>/<filename>`, and unauthenticated WebSocket access to `saveSettings`. The feature also required `ws` (and `@types/ws`) as direct dependencies and exposed `localhost:3333` on every machine that had ever invoked the command. Removing the command, its CodeLens entry, the webview "Open in Browser" button, and the WebSocket browser-mode shim eliminates the attack surface in one stroke; the rich editor stays a custom-editor experience inside VS Code. Tracked in `docs/security-audit/2026-06-02-audit.md` (C-1 through C-4, M-5, M-6, H-4).
```

- [ ] **Step 3: Update `docs/ARCHITECTURE.md`**

Remove every reference to the standalone server / browser mode. Specifically:

  a. Delete the third paragraph in `## Two processes` (the "A third, optional process is the standalone dev server …" paragraph, ~lines 38-46). The section ends at the closer of the second paragraph.

  b. In the message-direction table, drop `openInBrowser` from the webview→host list of message types.

  c. Delete the `| Dev server |` row from the build-targets table (~line 74).

  d. Delete the `Open in Browser` bullet under the commands list (~lines 109-110 and any continuation describing the spawn lifecycle / `localhost:3333`).

  e. In the section describing `webview/vscode-api.ts` (~lines 215-220), simplify to: "`vscodeApi` is a thin wrapper around `acquireVsCodeApi()`. The custom editor is the only host runtime."

  f. Delete the entire `### Standalone server runtime` section (~lines 222 onward through the end of that subsection).

  g. Delete the standalone-server settings-storage paragraph (~line 324).

  h. In the "different hosts" sentence (~lines 397-398), strip the trailing "and the same bundle, driven by `server/index.ts` over a WebSocket, …" clause.

Use targeted Edit calls; do not rewrite the whole file.

- [ ] **Step 4: Update `docs/SPEC.md:66`**

Change:

```md
- When a `.md` file is open in VS Code's native text editor, a CodeLens row at line 1 offers "Open in Rich Editor" and "Open in Browser" actions, so users can switch into the rich view without hunting for the command palette.
```

to:

```md
- When a `.md` file is open in VS Code's native text editor, a CodeLens row at line 1 offers an "Open in Rich Editor" action, so users can switch into the rich view without hunting for the command palette.
```

- [ ] **Step 5: Mark `docs/TODO.md` Strategic option as done**

Find the line starting with `- [ ] 🚧 🔒 P1: **Remove `betterMarkdown.openInBrowser` command and bundled local server entirely.**` (~line 99) and flip the checkbox: `- [ ]` → `- [x]`. Also remove the `🚧` (in-progress) prefix.

### Task 5: Verify, package, install — the standard pre-finish checklist

This follows the project's "Before finishing ANY change" checklist in `CLAUDE.md`.

- [ ] **Step 1: Run the test suite**

Run: `npm test`
Expected: every named test passes; 0 unexpected failures. The conversion + round-trip tests don't depend on the server, so they should all still pass.

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: "Build complete." with no `dist/server.js` artifact.

- [ ] **Step 3: Confirm the VSIX no longer ships the server**

Run: `npm run package`
Expected: `its-markdown-studio-2.3.8.vsix` produced.

Inspect: `unzip -l its-markdown-studio-2.3.8.vsix | grep -E '(server|ws)'`
Expected: no matches (no `server.js`, no `ws` runtime).

- [ ] **Step 4: Force install**

Run: `code --install-extension its-markdown-studio-2.3.8.vsix --force`
Expected: VS Code reports successful install. Reload the window manually before smoke-testing.

- [ ] **Step 5: Smoke-test in VS Code (manual)**

  - Open any `.md` file in VS Code's source view → confirm the CodeLens shows only "Open in Rich Editor" (not "Open in Browser").
  - `Cmd+Shift+P` → search "Markdown Studio" → confirm there is no "Open in Browser" entry.
  - Open a `.md` file → switch to rich mode → confirm the bottom row reads "Open in Default Editor" with no second link beside it.
  - Confirm round-trip editing still saves correctly.

  Document any anomalies before commit; the task is incomplete if any of these fail.

### Task 6: Commit + ship

- [ ] **Step 1: Commit**

The user explicitly asked for `/ship` after implementation. That skill runs commit + PR + review-cycle + merge. Invoke the `ship` skill via the `Skill` tool; no manual `git commit` here.

---

## Out-of-scope (deliberately not touched)

These could superficially seem related; they are tracked in `docs/TODO.md` and stay there for follow-up PRs:

- The `H-1` `openLink` path-traversal fix in `src/provider.ts:256-270` (separate item in the audit).
- The `H-2` `uploadImage` extension whitelist (separate item).
- The `H-3` `localResourceRoots` tightening (separate item).
- `capabilities.untrustedWorkspaces` declaration (separate item).
- CSP `img-src https:` removal (separate item; also gated on YouTube thumbnail decision).

Keeping this PR pure-deletion makes it trivial to review and lets the audit fixes ship as independent commits.
