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

## Claude Workflow

### 2026-06-02: settings.json の machine 固有設定は settings.local.json へ

`.claude/settings.json` をコミット対象にする場合、`additionalDirectories` の絶対パス（`/Users/m/...`）や個人色の強い `enabledPlugins` は含めない。前者はユーザー名が漏れ他環境で無意味、後者は未導入環境で警告を出す。machine 固有設定は `.gitignore` した `settings.local.json` に分離する。
