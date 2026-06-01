# 開発ワークフロー自動化

Worktree ベースの開発フローと自動化の構成。スキル・フック・GitHub Actions の役割をまとめる。

## 全体の流れ

```
/next-todo → [brainstorming] → writing-plans → [review-plan] → subagent-driven-development → /ship
```

凡例:

- `[skill]` — エージェントが条件付きで続けて実行（オプション）
- `(+skill)` — スキル内部で自動実行（常に実行）

1. `/next-todo` — [docs/TODO.md](TODO.md) の次タスクで worktree をセットアップし Ghostty で開く
2. `[brainstorming]` — (オプション) 複雑な機能のデザイン探索
3. `writing-plans` — 実装プラン作成 → `docs/plans/` に保存
4. `[review-plan]` — プラン品質検証（構造・粒度・TDD・検証ステップ）
5. `subagent-driven-development` — バッチ実行 + レビュー
6. `/ship` — 以下を自動実行:
   1. `/commit --pr` (+parallel-checks, +sync-main) → コミット + PR 作成
   2. `/review-cycle` 1st pass → レビュー
   3. `/review-cycle --codex` 2nd pass → 別視点レビュー
   4. `/merge-pr` → マージ + worktree クリーンアップ + 次タスク提案

## このプロジェクト固有の検証（必須4ステップ）

コード変更を「完了」と宣言する前に、[CLAUDE.md](../CLAUDE.md) の手順を必ず順に実行する:

1. `npm test` — [test/test-conversions.ts](../test/test-conversions.ts)（カテゴリ A–Q）→ [test/test-roundtrip.ts](../test/test-roundtrip.ts)（full-file round-trip）
2. `npm run build` — esbuild が extension(node) と webview(browser) を両方ビルド。型エラーで停止
3. `npm run package` — `vsce package` で `.vsix` 生成
4. `code --install-extension its-markdown-studio-<version>.vsix --force` — ローカルに反映 → ウィンドウ再読込

証拠なき完了宣言は禁止（`superpowers:verification-before-completion`）。

## Superpowers 統合

| スキル | 役割 | 適用タイミング |
| --- | --- | --- |
| `brainstorming` | デザイン探索（オプション） | 計画前 |
| `writing-plans` | 実装プラン作成・永続化 | 計画時 |
| `test-driven-development` | テスト先行開発（必須） | 実装時 |
| `systematic-debugging` | 体系的バグ調査（必須） | バグ修正前 |
| `subagent-driven-development` | レビュー付き実装 | 実装時 |
| `verification-before-completion` | 完了前検証（必須） | タスク完了時 |

### 決定マトリクス

| 状況 | 使用ツール | 理由 |
| --- | --- | --- |
| 要件が曖昧・複数アプローチ可能 | `brainstorming` | 方向性を探索で決定 |
| 要件が明確・実装のみ | `writing-plans` | 直接プラン作成 |
| 現在セッションで実装 | `subagent-driven-development` | 即フィードバック |
| 別セッションで実装 | worktree で別セッション起動 | 長時間・バッチ |
| 内部レビュー（自動） | `/review-cycle` | 2段階レビュー |
| 外部レビュー対応 | `superpowers:receiving-code-review` | 指摘の技術的検証 |
| 全チェック並列 | `/parallel-checks` | 時間短縮 |
| PR 作成前 | `/sync-main` | コンフリクト事前検出 |

### プランの保存先

`docs/plans/YYYY-MM-DD-<feature-name>.md`

## Claude Code

スキルは `/<スキル名>` で呼び出す。

### Skills（グローバル `~/.claude/skills/`）

| スキル | 役割 |
| --- | --- |
| next-todo | TODO.md から次タスクの worktree をセットアップ |
| commit | 並列チェック + ドキュメント自動更新付きコミット |
| pr / commit --pr | コミット → sync-main → push → PR 作成 |
| sync-main | main との同期、コンフリクト検出 |
| parallel-checks | lint + typecheck + test を並列実行 |
| review-plan | 実装プランの品質検証 |
| review-cycle | Agent Teams によるレビュー→修正サイクル |
| merge-pr | プリフライト → main 取り込み → マージ → worktree 削除 → 次タスク提案 |
| ship | commit→PR→review-cycle(2パス)→merge の自動パイプライン |
| ask-gemini / ask-codex | セカンドオピニオン |

### Hooks（プロジェクト `.claude/hooks/`）

| フック | タイミング | 役割 |
| --- | --- | --- |
| [session-start.sh](../.claude/hooks/session-start.sh) | セッション開始時 | gone ブランチ・残存 worktree の自動削除、stale worktree 警告 |
| [post-edit-format.sh](../.claude/hooks/post-edit-format.sh) | Write/Edit 後 | JS/TS を prettier フォーマット + eslint 診断（ローカル未導入時は no-op） |

注: prettier / eslint は現状このプロジェクト未導入のため post-edit-format.sh は no-op。導入すれば自動で有効化される。

## GitHub Actions

| ワークフロー | トリガー | 役割 |
| --- | --- | --- |
| [publish.yml](../.github/workflows/publish.yml) | `v*` タグ push 時 | tag と package.json の version 一致を検証 → `npm test` → production build → `.vsix` を VS Code Marketplace(`vsce`) と Open VSX(`ovsx`) の両方へ publish |

リリース手順（[CLAUDE.md](../CLAUDE.md) 参照）:

```bash
# version bump + commit を master に push 済みであること。承認後にのみ:
git tag v<version>
git push origin v<version>
```

⚠️ タグ push は本番 Marketplace への publish を即トリガーする。ユーザーの明示承認なしにタグを切らない。

## ファイル構成

```
.claude/
├── hooks/
│   ├── session-start.sh      # セッション開始時クリーンアップ
│   └── post-edit-format.sh   # Write/Edit 後の自動フォーマット + リント
├── settings.json             # 権限・hook 配線（コミット対象）
└── settings.local.json       # マシン固有設定（.gitignore 対象）

.github/
└── workflows/
    └── publish.yml           # タグ push で Marketplace / Open VSX へ公開

docs/
├── ARCHITECTURE.md           # システム構成・データフロー
├── WORKFLOW.md               # 本ファイル
├── LEARNING.md               # 設計判断・落とし穴の記録
├── SPEC.md                   # 機能仕様
├── TODO.md                   # 未着手タスク
└── plans/                    # 実装プラン（YYYY-MM-DD-*.md）
```

## 注意事項

- worktree 内からは `/merge-pr` を使う。直接 `gh pr merge` すると worktree 削除に失敗する
- README.md / CHANGELOG.md は **root に置く**（Marketplace が root の両ファイルを参照。docs/ へ移すと拡張ページ / Changelog タブが壊れる）
- 内部ドキュメント（docs/**, SPEC.md, TODO.md, CLAUDE.md）は [.vscodeignore](../.vscodeignore) で vsix から除外済み
