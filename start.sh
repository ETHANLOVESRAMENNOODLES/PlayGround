#!/usr/bin/env bash
# Rooms — install dependencies, build the static bundle when needed,
# publish deployment metadata, then serve ./dist in the foreground.
#
# Layout contract:
#   * source and built output stay inside this directory (PROJECT_DIR),
#     the bundle lands in ./dist
#   * OPENCODE_WEB_DIR / RUNNER_TEMP are only used for worker metadata
#     (deployment-output.json) and capture evidence, never for the build
set -euo pipefail
cd "$(dirname "$0")"
PROJECT_ROOT="$PWD"

PORT="${PORT:-3000}"
export PORT
DIST_DIR="$PROJECT_ROOT/dist"
/usr/bin/time -p test -f "$PROJECT_ROOT/package.json"

# ---- install dependencies (only when node_modules is missing or stale) ----
if [[ ! -d "$PROJECT_ROOT/node_modules" ]] || [[ "$PROJECT_ROOT/package-lock.json" -nt "$PROJECT_ROOT/node_modules" ]]; then
  if [[ -f "$PROJECT_ROOT/package-lock.json" ]]; then
    /usr/bin/time -p npm ci --no-audit --no-fund
  else
    /usr/bin/time -p npm install --no-audit --no-fund
  fi
fi

# ---- build the static bundle (only when sources are newer than dist) ----
needs_build=true
if [[ -f "$DIST_DIR/index.html" ]]; then
  needs_build=false
  if [[ -n "$(/usr/bin/time -p find "$PROJECT_ROOT/src" "$PROJECT_ROOT/public" "$PROJECT_ROOT/index.html" "$PROJECT_ROOT/vite.config.js" "$PROJECT_ROOT/package.json" -newer "$DIST_DIR/index.html" -print -quit 2>/dev/null)" ]]; then
    needs_build=true
  fi
fi
if [[ "$needs_build" == true ]]; then
  /usr/bin/time -p npm run build
fi
/usr/bin/time -p test -f "$DIST_DIR/index.html"

# ---- publish deployment metadata for the controller ----
WEB_DIR="${OPENCODE_WEB_DIR:-/home/runner/work/_temp/omgithub-web}"
/usr/bin/time -p mkdir -p "$WEB_DIR"
/usr/bin/time -p /usr/bin/printf '{"project":"%s","directory":"%s"}\n' "$PROJECT_ROOT" "$DIST_DIR" > "$WEB_DIR/deployment-output.json"
TASK_JSON_PATH="/home/runner/work/_temp/omgithub-web/deployment-output.json"
if [[ "$WEB_DIR/deployment-output.json" != "$TASK_JSON_PATH" ]]; then
  /usr/bin/time -p cp "$WEB_DIR/deployment-output.json" "$TASK_JSON_PATH"
fi

# ---- serve the built bundle in the foreground (platform static server:
# install/build steps above are no-ops for it; it also keeps live rebuilds) ----
/usr/bin/time -p node "${RUNTIME_DIR:?RUNTIME_DIR must be set by the launcher}/scripts/default-start.mjs"
