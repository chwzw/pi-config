#!/usr/bin/env bash
# Apply local patches to pi packages installed under ~/.pi/agent/npm.
# Re-run after any `pi package update` that touches a patched package.
set -euo pipefail

NPM_DIR="$HOME/.pi/agent/npm/node_modules"
PATCH_DIR="$(cd "$(dirname "$0")" && pwd)"

apply() {
	local pkg="$1" patch="$2" base="${3:-$NPM_DIR}"
	local target="$base/$pkg"
	if [[ ! -d "$target" ]]; then
		echo "skip: $pkg not installed"
		return
	fi
	if patch -d "$target" -p1 --dry-run -R -s < "$PATCH_DIR/$patch" 2>/dev/null; then
		echo "already applied: $pkg <- $patch"
	elif patch -d "$target" -p1 --dry-run -s < "$PATCH_DIR/$patch" 2>/dev/null; then
		patch -d "$target" -p1 -s < "$PATCH_DIR/$patch"
		echo "applied: $pkg <- $patch"
	else
		echo "ERROR: patch does not fit (package updated?): $pkg <- $patch" >&2
		return 1
	fi
}

# vim j/k navigation; d = stop task, D = stop all (was k/K/a); src + dist runtime copies
apply pi-background-tasks pi-background-tasks-vim-keys.patch
# accent-only tint: drop the light-blue background blocks (src + dist runtime copies)
apply pi-background-tasks pi-background-tasks-accent-tint.patch
# then_run JSON-string shim: some models stringify nested tool args (src + tests)
apply github.com/NVlabs/SoL-Pi sol-pi-action-fusion-then-run-shim.patch "$HOME/.pi/agent/git"
