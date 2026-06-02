---
name: update-extension
description: Rebuild, repackage, and reinstall the Markdown Studio VS Code extension so local source changes take effect. Use when the user says "拡張を更新", "拡張機能を更新", "反映して", "update the extension", "rebuild and install", "reflect my changes", or after editing extension source (src/, webview/, esbuild.js). NOT for publishing to the Marketplace (that is a git tag → publish.yml, separate).
---

# Update (reflect) the Markdown Studio extension

Source edits do NOT auto-reflect into the installed extension. This skill runs the
project's mandatory reflect sequence so the change shows up in VS Code.

## When to use

- The user changed extension source (`src/`, `webview/`, `esbuild.js`, `package.json` contributes) and wants to see it in their VS Code.
- The user says "反映して" / "更新して" / "rebuild and install".

Do NOT use for:

- Doc/config-only changes (nothing to reflect — say so and skip).
- Releasing to the Marketplace — that is `git tag v<version>` → `.github/workflows/publish.yml`. Ask before tagging.

## Steps (run in order — all four, no exceptions)

Run from the repo root.

1. **Test** — `npm test`
   - Runs `test/test-conversions.ts` then `test/test-roundtrip.ts`. Expect all pass, 0 known-failing.
   - If any test fails, STOP and report — do not ship a broken build.
2. **Build** — `npm run build`
   - esbuild for extension (node) + webview (browser). Type errors halt the build.
3. **Package** — `npm run package`
   - Produces `its-markdown-studio-<version>.vsix` via `vsce package`.
4. **Force install** — install that exact vsix:
   - First read the version so the filename never goes stale: `node -p "require('./package.json').version"`.
   - Then: `code --install-extension its-markdown-studio-<version>.vsix --force`.

After step 4, tell the user to reload the VS Code window (Cmd+Shift+P → "Developer: Reload Window") — this cannot be triggered reliably from the CLI, so it stays a manual step.

## Notes

- Reinstalling the same version with `--force` overwrites the installed copy — no version bump needed for local iteration.
- `node_modules` must exist first (`npm install`) — the build fails with "Cannot find module 'esbuild'" otherwise.
- For a fast inner dev loop instead of full reinstall: open the project, press F5 (Extension Development Host) and run `npm run watch`; reload the dev window (Cmd+R) after edits.
- Heads-up: VS Code may auto-update a Marketplace-published extension over a locally-installed one. While testing local changes, prefer the F5 dev host to avoid the published version overwriting your build.
