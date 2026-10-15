#!/usr/bin/env bash
# Once-per-worker prerequisites for capture.sh (idempotent).
set -euo pipefail

# Playwright Chromium used by capture.sh. Skips the download when a
# browser binary is already present from a previous worker start.
if ! /usr/bin/time -p bash -c 'ls "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux64/chrome "$HOME"/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell 2>/dev/null | grep -q .'; then
  /usr/bin/time -p playwright-cli install-browser chromium
fi
