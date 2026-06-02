# Pass current file as @-mention to Claude Code from Rich editor (Cmd+Opt+K)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Cmd+Opt+K is pressed while a Markdown Studio rich (custom) editor has focus, insert the current file as an `@<relpath>` mention into the Claude Code panel — just like Cmd+Opt+K does inside a normal source editor.

**Architecture:**
- Add an extension-side command `betterMarkdown.claudeCodeInsertAtMentioned`, scoped via `when: activeCustomEditorId == 'betterMarkdown.editor'`.
- The handler resolves the active custom-editor tab's URI, calls `vscode.window.showTextDocument(uri, { selection: empty })` to make the source `TextEditor` active with an empty selection (so Claude Code emits `@<relpath>` rather than `@<relpath>#Lstart-Lend`), then runs `vscode.commands.executeCommand('claude-code.insertAtMentioned')`.
- MVP only covers the file-level (empty-selection) path. ProseMirror→markdown line-range mapping is explicitly out of scope.

**Tech Stack:** TypeScript, `vscode` extension API, esbuild, vsce.

---

## Pre-flight

- [ ] **Step 0: Confirm `claude-code.insertAtMentioned` invocation contract**

  Per `docs/TODO.md` investigation (2026-06-02, against `anthropic.claude-code` 2.1.159 `extension.js`):
  - The handler is `async () => { let e = window.activeTextEditor; if (!e) return; ... }`.
  - **Takes NO arguments.** Reads `activeTextEditor` directly.
  - Empty selection → `@<relpath>`. Non-empty → `@<relpath>#Lstart-Lend`.
  - Keybinding `cmd+alt+k` is `when: editorTextFocus` (false in the webview), so we cannot rely on the upstream binding.

  Conclusion: we register our own keybinding scoped to the custom editor, switch focus to the source `TextEditor` ourselves, then execute the command. There is no clean alternative (no exported extension API).

---

## Task 1: Declare the command + keybinding in `package.json`

**Files:**
- Modify: `/Users/m/Dev/VSCode_Extensions/markdown-studio--worktrees/claude-code-mention-from-rich-editor/package.json`

- [ ] **Step 1: Add a new entry to `contributes.commands`**

  Insert after the `betterMarkdown.factoryReset` entry (around line 93):

  ```json
  {
    "command": "betterMarkdown.claudeCodeInsertAtMentioned",
    "title": "Insert @-Mention of Current File into Claude Code",
    "category": "Markdown Studio"
  }
  ```

- [ ] **Step 2: Add a new entry to `contributes.keybindings`**

  Insert after the `betterMarkdown.find` keybinding (around line 107). Mirror the exact `when` clause that `betterMarkdown.find` uses so it only fires inside the rich editor:

  ```json
  {
    "command": "betterMarkdown.claudeCodeInsertAtMentioned",
    "key": "ctrl+alt+k",
    "mac": "cmd+alt+k",
    "when": "activeCustomEditorId == betterMarkdown.editor"
  }
  ```

  Notes:
  - `activeCustomEditorId` (unquoted RHS) matches the existing pattern used by `betterMarkdown.find` — keep the style consistent.
  - We deliberately do NOT add a Command Palette `menus.commandPalette` entry — outside the rich editor, the upstream Cmd+Opt+K already works.

- [ ] **Step 3: Sanity-check JSON validity**

  Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('ok')"`

  Expected: `ok`

---

## Task 2: Implement the command handler in `src/extension.ts`

**Files:**
- Modify: `/Users/m/Dev/VSCode_Extensions/markdown-studio--worktrees/claude-code-mention-from-rich-editor/src/extension.ts`

- [ ] **Step 1: Register the command inside `activate(context)`**

  Insert a new `context.subscriptions.push(...)` block immediately after the `betterMarkdown.find` registration (around line 94, before the `betterMarkdown.factoryReset` block):

  ```ts
  // Bridge Cmd+Opt+K from the rich (custom) editor → Claude Code.
  // Claude Code's `claude-code.insertAtMentioned` command reads
  // `vscode.window.activeTextEditor` directly, and our webview is not a
  // text editor, so we focus the backing TextDocument first (with an
  // empty selection to emit `@<relpath>` rather than a line range), then
  // invoke the upstream command. MVP: file-level mention only.
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "betterMarkdown.claudeCodeInsertAtMentioned",
      async () => {
        const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
        const input = activeTab?.input;
        if (
          !(input instanceof vscode.TabInputCustom) ||
          input.viewType !== CUSTOM_EDITOR_VIEW_TYPE
        ) {
          return;
        }
        // Only `file:` URIs round-trip into Claude Code as a useful path.
        // For git:/scm:/etc. read-only views, do nothing.
        if (input.uri.scheme !== "file") return;

        try {
          await vscode.window.showTextDocument(input.uri, {
            preview: false,
            preserveFocus: false,
            selection: new vscode.Range(0, 0, 0, 0),
          });
          await vscode.commands.executeCommand(
            "claude-code.insertAtMentioned",
          );
        } catch {
          // Claude Code may not be installed; swallow silently — the
          // keystroke is a no-op in that case, which matches the existing
          // behavior in source editors.
        }
      },
    ),
  );
  ```

  Notes:
  - We use `TabInputCustom` (already imported via `vscode.TabInputCustom` — see existing usage on line 146) for type-safe narrowing.
  - `preview: false` matches the user's existing-tab so we don't open a transient preview pane.
  - `preserveFocus: false` is required — `claude-code.insertAtMentioned` reads `activeTextEditor`, so the source editor MUST be focused at the moment we call the upstream command. We accept the brief focus flash (documented in TODO.md as unavoidable).
  - `selection: new vscode.Range(0,0,0,0)` forces an empty selection at line 1 so Claude Code emits `@<relpath>` (file-level) rather than `@<relpath>#L1-Lend` (range). Without this, a stale selection from a previous source-editor visit would trigger the wrong code path.

- [ ] **Step 2: Confirm `CUSTOM_EDITOR_VIEW_TYPE` is in scope**

  The constant is already defined at the top of `src/extension.ts` (line 7) and used by the toggle command on lines 76 and 147. No new import required.

---

## Task 3: Verify the build (no automated test exists for extension-side code)

There is no Vitest/unit harness for the extension host. The `npm test` suite only exercises the markdown conversion pipeline (no behavioral overlap). Verify by typecheck + manual install per CLAUDE.md's mandatory four-step protocol.

- [ ] **Step 1: Run the existing test suite (catch markdown-pipeline regressions)**

  Run: `npm test`
  Expected: all tests pass, 0 known-failing. (This change does not touch the pipeline; failure here means a regression in our edits.)

- [ ] **Step 2: Build (typecheck both extension + webview bundles)**

  Run: `npm run build`
  Expected: esbuild succeeds for both `src/extension.ts` (node) and `webview/index.tsx` (browser). Type errors in either halt the build — confirms our new handler is type-clean.

- [ ] **Step 3: Bump patch version + update CHANGELOG**

  Per CLAUDE.md: bump patch by 0.1 unless told otherwise. Current version is `2.3.8` → bump to `2.3.9`.

  In `package.json`, change `"version": "2.3.8"` → `"version": "2.3.9"`.

  In `CHANGELOG.md`, add an entry under the existing `## 2.3.x` heading (or create one if absent). Example line:

  ```markdown
  - **2.3.9** — Cmd+Opt+K from the rich editor now inserts the current file as an `@`-mention into Claude Code (file-level only; line ranges TBD).
  ```

  In `CLAUDE.md`, update the force-install example filename to match: `its-markdown-studio-2.3.9.vsix`.

- [ ] **Step 4: Package the VSIX**

  Run: `npm run package`
  Expected: produces `its-markdown-studio-2.3.9.vsix`.

- [ ] **Step 5: Force-install in VS Code**

  Run: `code --install-extension its-markdown-studio-2.3.9.vsix --force`
  Expected: install succeeds. Reload the VS Code window in which you want to verify (Cmd+Shift+P → "Developer: Reload Window").

---

## Task 4: Manual verification

The acceptance test is behavioral. Run it in a VS Code window that already has the Claude Code extension installed and a Claude Code panel open (or capable of opening on first invocation).

- [ ] **Step 1: Verify happy-path (rich editor → mention)**

  1. Open any `.md` file in the workspace. The rich (custom) editor takes over by default.
  2. Click anywhere inside the rich editor so the webview has focus.
  3. Press Cmd+Opt+K.
  4. Expected: the source `.md` opens (focus flashes), then the Claude Code panel input shows `@<relative-path-to-file.md>`. Focus lands in the Claude Code prompt input.

- [ ] **Step 2: Verify non-`file:` URIs are a no-op**

  1. Open the Source Control panel, click a modified `.md` to open the diff. The custom editor's git-side pane is auto-closed (see `src/extension.ts:142`), so this is only reachable transiently — easier path: trigger any read-only `git:`-scheme rich editor (e.g. via Timeline).
  2. With that read-only rich editor focused, press Cmd+Opt+K.
  3. Expected: nothing happens (no error, no focus change, no Claude Code panel update).

- [ ] **Step 3: Verify Claude-Code-absent fallback**

  In a host where the Claude Code extension is disabled or uninstalled, press Cmd+Opt+K in the rich editor.
  Expected: focus flashes to the source editor (because `showTextDocument` still runs), then the upstream `claude-code.insertAtMentioned` rejects with a "command not found" — caught by our `try/catch`, no UI error. This matches the pre-feature behavior (no-op). Acceptable for MVP.

- [ ] **Step 4: Verify source-editor path still works (regression check)**

  Toggle to the source editor with Cmd+Shift+M, press Cmd+Opt+K. Expected: upstream behavior unchanged — `@<relpath>` inserted with no selection, `@<relpath>#Lstart-Lend` with a selection. (Our new keybinding is gated on `activeCustomEditorId`, so it should not fire here at all.)

---

## Task 5: Update `docs/TODO.md`

**Files:**
- Modify: `/Users/m/Dev/VSCode_Extensions/markdown-studio--worktrees/claude-code-mention-from-rich-editor/docs/TODO.md`

- [ ] **Step 1: Mark the entry as resolved**

  Change the `- [ ] 🚧 🚩 **[MUST] Pass context from the Rich editor to Claude Code (Cmd+Opt+K).**` line (line 9) to `- [x]` and replace the body with a one-liner pointing at the release. Keep the bullet list as historical context for the range-mapping follow-up:

  ```markdown
  - [x] 🚩 **[MUST] Pass context from the Rich editor to Claude Code (Cmd+Opt+K).** Shipped in v2.3.9 (MVP: file-level `@`-mention). Cmd+Opt+K in the rich editor now flips focus to the backing source TextEditor with an empty selection, then invokes `claude-code.insertAtMentioned` → Claude Code emits `@<relpath>`.
    - Follow-up: ProseMirror → markdown line-range mapping for non-empty selections (currently `@<relpath>#Lstart-Lend` requires selecting in the source editor).
  ```

  The other bullets (Investigation, Approach, Constraints) can be removed since the approach is now in the shipped code.

---

## Task 6: Ship

- [ ] **Step 1: Run `/ship`**

  Invoke the `ship` skill. It will run commit → PR → review-cycle (2-pass) → merge. The previous task list (Tasks 1–5) covers the pre-ship checks (tests, build, package, install, manual verification, TODO update). `/ship`'s `parallel-checks` step will re-run lint/typecheck/test to confirm a clean state before commit.

---

## Self-Review

- **Spec coverage** — every bullet under the TODO entry (registered keybinding, `showTextDocument`, execute upstream command, optionally restore focus) is addressed; restore-focus is intentionally skipped (the natural flow is for the Claude Code prompt to be focused after the mention is inserted).
- **Placeholders** — none.
- **Type consistency** — `CUSTOM_EDITOR_VIEW_TYPE` and `vscode.TabInputCustom` match existing usages in `src/extension.ts`. Command id `betterMarkdown.claudeCodeInsertAtMentioned` is used identically in `package.json` and `extension.ts`.
- **Out of scope (intentional)** — range mapping (selection → `#Lstart-Lend`), Alt+K binding for `claude-vscode.insertAtMention`, focus restoration to the rich editor.
