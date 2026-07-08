#!/usr/bin/env bash
# Phase 0 — scaffold an isolated throwaway Knowledge Vault for manual validation.
# Does NOT touch your real ~/papers. Safe to re-run (recreates the scratch vault).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VAULT="${1:-$HOME/papers-phase0}"

echo "==> Resetting scratch vault at: $VAULT"
rm -rf "$VAULT"
mkdir -p "$VAULT"
cp -R "$SCRIPT_DIR/sample-vault/." "$VAULT/"

echo "==> git init + first commit"
git -C "$VAULT" init -q
git -C "$VAULT" add -A
git -C "$VAULT" -c user.name="zotero-agent" -c user.email="agent@local" \
    commit -q -m "phase0: initial vault (text.txt only, no memory yet)"

echo "==> Vault ready:"
find "$VAULT" -not -path '*/.git/*' -type f | sed "s#$VAULT#.#" | sort
echo
echo "Export it for convenience:  export VAULT=\"$VAULT\""
echo "Then follow phase0/CHECKLIST.md"
