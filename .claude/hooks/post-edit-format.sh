#!/usr/bin/env bash
set -euo pipefail

# Format + lint edited JS/TS files. No-op unless prettier/eslint are installed
# locally, so it stays harmless until the project adopts them.

input="$(cat)"
file="$(jq -r '.tool_input.file_path // .tool_input.path // empty' <<< "$input")"

# Only process JS/TS files
case "$file" in
  *.ts|*.tsx|*.js|*.jsx) ;;
  *) exit 0 ;;
esac

# Skip if file doesn't exist (deleted files)
[ -f "$file" ] || exit 0

root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0

# Auto-format first (silent, fast) when prettier is available locally
if [ -x "$root/node_modules/.bin/prettier" ]; then
  "$root/node_modules/.bin/prettier" --write "$file" >/dev/null 2>&1 || true
fi

# Lint and surface errors back to Claude when eslint is available locally
if [ -x "$root/node_modules/.bin/eslint" ]; then
  diag="$("$root/node_modules/.bin/eslint" "$file" 2>&1 | head -30)" || true
  if [ -n "$diag" ]; then
    jq -cn --arg msg "$diag" '{
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: $msg
      }
    }'
  fi
fi
