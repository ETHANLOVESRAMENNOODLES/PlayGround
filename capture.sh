#!/usr/bin/env bash
# Capture desktop + mobile screenshots of the deployed app.
#
# Contract:
#   * CAPTURE_URL: exact URL to open (used verbatim, never modified)
#   * CAPTURE_DIR: evidence directory receiving final-desktop.png and
#     final-mobile.png (created if missing; always outside the source tree)
#   * closes its own browser session, leaves the app server running
#   * exit 75: temporary navigation / browser infrastructure failure
#   * exit 1:  script usage error or rendering defect
set -euo pipefail
: "${CAPTURE_URL:?CAPTURE_URL must be set to the exact URL to capture}"
: "${CAPTURE_DIR:?CAPTURE_DIR must be set to the evidence directory}"
SESSION="capture"

close_browser() {
  /usr/bin/time -p playwright-cli -s="$SESSION" close >/dev/null 2>&1 || true
}
trap close_browser EXIT

# ---- evidence directory (outside the project source) ----
/usr/bin/time -p mkdir -p "$CAPTURE_DIR"
/usr/bin/time -p test -w "$CAPTURE_DIR"

# ---- open the exact URL (transient browser/tunnel trouble -> 75) ----
opened=false
for attempt in 1 2 3 4 5; do
  if /usr/bin/time -p playwright-cli -s="$SESSION" open "$CAPTURE_URL"; then
    opened=true
    break
  fi
  echo "capture: open attempt $attempt failed, retrying..." >&2
  /usr/bin/time -p sleep 3
done
if [[ "$opened" != true ]]; then
  echo "capture: browser failed to open $CAPTURE_URL (infrastructure)" >&2
  exit 75
fi

# ---- wait for rendered content: DOM ready + WebGL canvas with real size ----
# Loaded-but-blank means the app itself is broken -> exit 1.
# Never reaching DOM readiness means navigation/infra trouble -> exit 75.
rendered=false
for _ in $(/usr/bin/time -p seq 1 30); do
  if /usr/bin/time -p playwright-cli -s="$SESSION" eval \
    "() => { const c = document.querySelector('canvas#scene'); return document.readyState === 'complete' && !!c && c.width > 10 && !!(document.querySelector('#lobby') || document.querySelector('#hud:not(.hidden)')); }" \
    2>/dev/null | grep -q true; then
    rendered=true
    break
  fi
  /usr/bin/time -p sleep 2
done
if [[ "$rendered" != true ]]; then
  if /usr/bin/time -p playwright-cli -s="$SESSION" eval \
    "() => document.readyState" 2>/dev/null | grep -q complete; then
    echo "capture: page loaded but app content did not render (rendering defect)" >&2
    exit 1
  fi
  echo "capture: page did not finish loading (infrastructure)" >&2
  exit 75
fi

take_shot() {
  local width="$1" height="$2" dest="$3"
  /usr/bin/time -p playwright-cli -s="$SESSION" resize "$width" "$height" || {
    echo "capture: browser resize failed (infrastructure)" >&2
    exit 75
  }
  /usr/bin/time -p sleep 2
  /usr/bin/time -p playwright-cli -s="$SESSION" screenshot --filename="$dest" || {
    echo "capture: screenshot command failed (infrastructure)" >&2
    exit 75
  }
  # A missing/tiny/non-PNG file means the render itself is defective.
  if [[ ! -f "$dest" ]] || [[ "$(/usr/bin/time -p stat -c%s "$dest")" -lt 4096 ]] \
    || [[ "$(/usr/bin/time -p head -c 8 "$dest" | od -An -tx1 | tr -d ' \n')" != "89504e470d0a1a0a" ]]; then
    echo "capture: invalid screenshot $dest (rendering defect)" >&2
    exit 1
  fi
  echo "capture: wrote $dest ($(/usr/bin/time -p stat -c%s "$dest") bytes)"
}

# ---- desktop view ----
take_shot 1280 800 "$CAPTURE_DIR/final-desktop.png"

# ---- mobile view (same session, narrowed viewport) ----
take_shot 390 844 "$CAPTURE_DIR/final-mobile.png"

/usr/bin/time -p playwright-cli -s="$SESSION" close
trap - EXIT
echo "capture: done ($CAPTURE_URL)"
