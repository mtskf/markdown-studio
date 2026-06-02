# Learning

> AI Agent Reference: 開発中に発見した設計判断・落とし穴・パターンを記録する。新しい問題に遭遇したら追記する。重複しないか確認してから書く。

## Packaging & Marketplace

### 2026-06-02: README.md / CHANGELOG.md は repo root 必須

決定: ドキュメントを docs/ に集約する際も、README.md と CHANGELOG.md は root に残す。

理由:
- `vsce` は root の README.md を Marketplace の拡張ページ本体として読む。docs/ へ移すとページが空になる。
- root の CHANGELOG.md は拡張の「Changelog」タブとして表示される。移動するとタブが消える。
- これらはリンク調整では直らない。Marketplace ツールの規約レベルの制約。

一方 SPEC.md / TODO.md / CLAUDE.md は内部ドキュメントで Marketplace 非依存 → docs/ へ移動可。

### 2026-06-02: docs/ を移動先にするなら .vscodeignore に `docs/**` を追加

問題: `.vscodeignore` は `TODO.md` / `SPEC.md` を個別除外していた。これらを docs/ へ移動すると個別行が効かなくなり、内部ドキュメントが逆に vsix へ同梱されてしまう。

修正: 個別行を削除し `docs/**` を除外に追加。これで docs 配下の内部資料（ARCHITECTURE/WORKFLOW/LEARNING/SPEC/TODO/plans/security-audit）が一括で vsix から外れる。

## Custom Editors

### 2026-06-02: `customEditors priority:"default"` claims both panes of a diff

問題: `package.json` の `contributes.customEditors` で `*.md` を `priority: "default"` にすると、SCM Changes ビューの diff (`TabInputTextDiff`) でも両側 (original=`git:` / modified=`file:`) が rich editor (webview) で開き、line diff が隠れる。

決定: `priority` は下げない（通常の `.md` 開きで rich editor を default にする要件は維持）。代わりに `onDidChangeTabs` で `TabInputTextDiff` を検出し、片側でも `.md` なら `vscode.commands.executeCommand("vscode.diff", left, right, title, { override: "default" })` で開き直す。

理由:

- `override: "default"` は内部コマンド `_workbench.diff` の `IResourceDiffEditorInput.options` に渡される（公式 `TextDocumentShowOptions` 型には載っていないが内部コマンドは受け取る）。これで editor resolver が custom editor をスキップし native text diff editor で確実に描画する。
- reopen はそれ自体が `onDidChangeTabs.opened` を発火するため、URI ペアキーの `Set` で一度だけ consume するガードが必須。これを忘れると無限ループ。
- 既存の「非 `file:` スキームの `TabInputCustom` を閉じる」safety net も残す。SCM 経由は新ロジックで吸収されるが、コマンドパレット等から直接 `git:` URI を開くケースが残るため。

ユーザー向け escape hatch: `workbench.editorAssociations` に `{git,vscode-scm}:/**/*.md` を `"default"` でマッピングすればプログラム的処理なしで同じ効果が得られる。CHANGELOG にも記載。

## Tiptap / ProseMirror

### 2026-06-02: ReactNodeView は meta-only transaction で再描画されない

問題: ProseMirror plugin state を変えるだけのトグル（例: heading fold）で `tr.setMeta(KEY, ...)` を dispatch すると `docChanged === false`。Tiptap の `ReactNodeViewRenderer.update()` は `node` / `decorations` / `innerDecorations` が referentially equal なら short-circuit する。meta-only tr では 3 つとも変わらないので React コンポーネントは再描画されず、`pluginState.getState(editor.state)` を読む UI（chevron, CSS class）は前回値のまま固まる。

決定: NodeView 内で `editor.on("transaction", handler)` を購読し、目当ての meta key を見たら `forceUpdate` を呼ぶ。`webview/extensions/HeadingFold.tsx` の `HeadingView` がこのパターン。

代替案: plugin が heading 位置にノード装飾 `Decoration` を出す → `decorations` が ref-new になり Tiptap の通常 update が走る。しかし装飾内容が単なるブール（folded か否か）に過ぎないとき、購読の方が薄い。

教訓: NodeView から plugin state を読む全ての場所で「doc-changing tr 以外にも反応が要るか？」を考える。今回は fold 状態だが、同じ罠は selection-derived UI 等にも当てはまる。

## Claude Workflow

### 2026-06-02: settings.json の machine 固有設定は settings.local.json へ

`.claude/settings.json` をコミット対象にする場合、`additionalDirectories` の絶対パス（`/Users/m/...`）や個人色の強い `enabledPlugins` は含めない。前者はユーザー名が漏れ他環境で無意味、後者は未導入環境で警告を出す。machine 固有設定は `.gitignore` した `settings.local.json` に分離する。
