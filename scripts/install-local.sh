#!/usr/bin/env bash
# Rebuild the release binary that the app-menu entry (~/.local/share/applications/oviate.desktop) launches.
# Run after every push to main. Restart a running Oviate afterwards to load the new build.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only origin main || true
npm install --no-audit --no-fund
npm run tauri build -- --no-bundle
# CLI on PATH and the /oviate skill for Claude
mkdir -p "$HOME/.local/bin" "$HOME/.claude/skills/oviate"
ln -sf "$PWD/cli/oviate" "$HOME/.local/bin/oviate"
cp skills/oviate/SKILL.md "$HOME/.claude/skills/oviate/SKILL.md"
echo "Installed: $(git rev-parse --short HEAD) -> src-tauri/target/release/oviate"
