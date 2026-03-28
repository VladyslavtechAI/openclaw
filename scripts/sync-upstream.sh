#!/bin/bash
# OpenClaw Fork — Upstream Sync Script
# Pulls latest changes from openclaw/openclaw and merges into our fork
# Usage: ./scripts/sync-upstream.sh [--dry-run] [--auto-resolve]

set -euo pipefail

UPSTREAM_REMOTE="upstream"
UPSTREAM_BRANCH="main"
FORK_BRANCH="main"
LOG_DIR="$(dirname "$0")/../.sync-logs"
DATE=$(date +%Y-%m-%d_%H%M)
DRY_RUN=false
AUTO_RESOLVE=false

# Parse args
for arg in "$@"; do
  case $arg in
    --dry-run) DRY_RUN=true ;;
    --auto-resolve) AUTO_RESOLVE=true ;;
  esac
done

mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/sync-$DATE.log"

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG_FILE"; }

log "=== OpenClaw Fork Sync ==="
log "Date: $DATE"
log "Dry run: $DRY_RUN"

# 1. Ensure upstream remote exists
if ! git remote | grep -q "$UPSTREAM_REMOTE"; then
  log "Adding upstream remote..."
  git remote add "$UPSTREAM_REMOTE" https://github.com/openclaw/openclaw.git
fi

# 2. Fetch upstream
log "Fetching upstream..."
git fetch "$UPSTREAM_REMOTE" 2>&1 | tee -a "$LOG_FILE"

# 3. Check for new commits
LOCAL_HASH=$(git rev-parse "$FORK_BRANCH")
UPSTREAM_HASH=$(git rev-parse "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH")
MERGE_BASE=$(git merge-base "$FORK_BRANCH" "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH")

if [ "$UPSTREAM_HASH" = "$MERGE_BASE" ]; then
  log "✅ Already up to date with upstream."
  exit 0
fi

NEW_COMMITS=$(git log --oneline "$MERGE_BASE..$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" | wc -l | tr -d ' ')
log "📥 $NEW_COMMITS new commits from upstream"

# 4. Show what's new
log "=== New upstream commits ==="
git log --oneline "$MERGE_BASE..$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" | head -20 | tee -a "$LOG_FILE"

# 5. Check for conflicts
log "=== Checking for conflicts ==="
CONFLICTING_FILES=$(git diff --name-only "$MERGE_BASE" "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" | while read file; do
  if git diff --name-only "$MERGE_BASE" "$FORK_BRANCH" | grep -q "^$file$"; then
    echo "$file"
  fi
done)

if [ -n "$CONFLICTING_FILES" ]; then
  log "⚠️ Potentially conflicting files:"
  echo "$CONFLICTING_FILES" | tee -a "$LOG_FILE"
else
  log "✅ No conflicting files detected"
fi

if [ "$DRY_RUN" = true ]; then
  log "Dry run complete. Use without --dry-run to merge."
  exit 0
fi

# 6. Merge
log "=== Merging upstream ==="
git checkout "$FORK_BRANCH"

if git merge "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" --no-edit 2>&1 | tee -a "$LOG_FILE"; then
  log "✅ Merge successful!"
  
  # 7. Run tests on our modules
  log "=== Verifying our modules ==="
  if npx vitest run src/security/ src/billing/ src/health/ src/agents/agent-permissions.test.ts src/routing/smart-router.test.ts 2>&1 | tee -a "$LOG_FILE" | tail -5; then
    log "✅ All our modules still pass!"
  else
    log "❌ Some tests failed after merge. Review needed."
    exit 1
  fi
  
  log "=== Push merged changes ==="
  git push origin "$FORK_BRANCH"
  log "✅ Pushed to origin/$FORK_BRANCH"
else
  log "❌ Merge conflicts detected!"
  
  if [ "$AUTO_RESOLVE" = true ]; then
    log "Auto-resolving: keeping OUR version for src/security/, src/billing/, src/health/"
    for dir in src/security src/billing src/health; do
      git checkout --ours "$dir/" 2>/dev/null || true
    done
    git add -A
    git commit --no-edit
    log "⚠️ Auto-resolved. Manual review recommended for other conflicts."
  else
    log "Run with --auto-resolve or resolve manually."
    git merge --abort
    exit 1
  fi
fi

log "=== Sync complete ==="
