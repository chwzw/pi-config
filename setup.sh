#!/usr/bin/env bash
# Bootstrap a new machine's pi environment from this repo.
# Safe to re-run. Handles: clone to ~/.pi/agent, preserve auth/trust/sessions,
# install extension dependencies.
set -euo pipefail

REPO="git@github.com:chwzw/pi-config.git"
DEST="$HOME/.pi/agent"
KEEP="auth.json trust.json"          # local files worth carrying over
KEEP_DIRS="sessions"                 # local dirs worth carrying over

backup_and_clone() {
  local backup=""
  if [ -d "$DEST" ]; then
    backup="$(mktemp -d)/pi-agent-backup"
    mv "$DEST" "$backup"
    echo "Existing ~/.pi/agent moved to $backup"
  fi
  mkdir -p "$HOME/.pi"
  git clone "$REPO" "$DEST"
  if [ -n "$backup" ]; then
    for f in $KEEP; do
      [ -f "$backup/$f" ] && [ ! -f "$DEST/$f" ] && cp "$backup/$f" "$DEST/$f" \
        && echo "Restored $f"
    done
    for d in $KEEP_DIRS; do
      [ -d "$backup/$d" ] && [ ! -d "$DEST/$d" ] && cp -r "$backup/$d" "$DEST/$d" \
        && echo "Restored $d/"
    done
  fi
}

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) echo "Windows: use WSL."; exit 1 ;;
esac

if [ -d "$DEST/.git" ] && [ "$(git -C "$DEST" remote get-url origin 2>/dev/null || true)" = "$REPO" ]; then
  echo "~/.pi/agent already points at $REPO — pulling latest"
  git -C "$DEST" pull --ff-only
else
  backup_and_clone
fi

# Extension/skill npm deps (node_modules is gitignored; archify needs none)
if [ -f "$DEST/extensions/visual-tools/package.json" ] && [ ! -d "$DEST/extensions/visual-tools/node_modules" ]; then
  echo "Installing visual-tools dependencies..."
  npm install --omit=dev --prefix "$DEST/extensions/visual-tools"
fi

echo
echo "Done. Restart pi to pick up skills/extensions."
