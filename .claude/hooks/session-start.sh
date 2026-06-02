#!/bin/bash
# Session start - cleanup gone branches, leftover worktree directories, and stale worktree warnings

cd "$(git rev-parse --show-toplevel)" || exit 0

git fetch --prune 2>/dev/null

OUTPUT=""

GONE_BRANCHES=$(git branch -vv 2>/dev/null | grep '\[.*: gone\]' | awk '{print $1}')

for branch in $GONE_BRANCHES; do
    WORKTREE_PATH=$(git worktree list 2>/dev/null | grep "\[$branch\]" | awk '{print $1}')
    if [ -n "$WORKTREE_PATH" ]; then
        git worktree remove "$WORKTREE_PATH" --force 2>/dev/null
        OUTPUT+="  🗑️ Removed worktree: $WORKTREE_PATH\n"
    fi
    git branch -d "$branch" 2>/dev/null
    OUTPUT+="  🗑️ Deleted branch: $branch\n"
done

git worktree prune 2>/dev/null

# Clean up leftover worktree directories (git worktree remove leaves .gitignored files like .claude/)
MAIN_REPO=$(git rev-parse --show-toplevel)
WORKTREES_DIR="${MAIN_REPO}--worktrees"
if [ -d "$WORKTREES_DIR" ]; then
    ACTIVE_PATHS=$(git worktree list 2>/dev/null | awk '{print $1}')
    for dir in "$WORKTREES_DIR"/*/; do
        [ -d "$dir" ] || continue
        dir="${dir%/}"  # remove trailing slash
        if ! echo "$ACTIVE_PATHS" | grep -qF "$dir"; then
            rm -rf "$dir"
            OUTPUT+="  🗑️ Removed leftover directory: $(basename "$dir")\n"
        fi
    done
fi

if [ -n "$OUTPUT" ]; then
    echo -e "✅ Cleaned up stale branches:\n$OUTPUT"
fi

# Check for stale worktrees (no commits in 7+ days)
STALE_OUTPUT=""
SEVEN_DAYS_AGO=$(date -v-7d +%s 2>/dev/null || date -d '7 days ago' +%s 2>/dev/null)

while IFS= read -r line; do
    WORKTREE_PATH=$(echo "$line" | awk '{print $1}')
    BRANCH=$(echo "$line" | sed -n 's/.*\[\(.*\)\].*/\1/p')

    if [ -n "$BRANCH" ] && [ "$BRANCH" != "main" ] && [ "$BRANCH" != "master" ]; then
        LAST_COMMIT_DATE=$(git log -1 --format=%ct "$BRANCH" 2>/dev/null)

        if [ -n "$LAST_COMMIT_DATE" ] && [ "$LAST_COMMIT_DATE" -lt "$SEVEN_DAYS_AGO" ]; then
            DAYS_AGO=$(( ($(date +%s) - LAST_COMMIT_DATE) / 86400 ))
            STALE_OUTPUT+="  ⚠️  $WORKTREE_PATH ($BRANCH) - last commit $DAYS_AGO days ago\n"
        fi
    fi
done < <(git worktree list 2>/dev/null | tail -n +2)

if [ -n "$STALE_OUTPUT" ]; then
    echo -e "⚠️  Stale worktrees (7+ days without commits):\n$STALE_OUTPUT"
fi
