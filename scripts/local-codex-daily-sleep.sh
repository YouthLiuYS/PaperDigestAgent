#!/bin/zsh

set -u

PROJECT_DIR="${PAPER_AGENT_PROJECT_DIR:-/Users/cyyoung/PaperDigestAgent}"
NODE_BIN="${PAPER_AGENT_NODE_BIN:-/opt/homebrew/bin/node}"
SLEEP_AFTER="${PAPER_AGENT_SLEEP_AFTER_CODEX:-true}"
MIN_IDLE_SECONDS="${PAPER_AGENT_SLEEP_MIN_IDLE_SECONDS:-300}"

timestamp() {
  /bin/date "+%Y-%m-%d %H:%M:%S %Z"
}

log() {
  /bin/echo "[$(timestamp)] $*"
}

idle_seconds() {
  /usr/sbin/ioreg -c IOHIDSystem 2>/dev/null \
    | /usr/bin/awk '/HIDIdleTime/ { print int($NF / 1000000000); exit }'
}

maybe_sleep() {
  if [[ "$SLEEP_AFTER" != "true" ]]; then
    log "Sleep skipped: PAPER_AGENT_SLEEP_AFTER_CODEX is not true."
    return 0
  fi

  local idle
  idle="$(idle_seconds)"
  if [[ -z "$idle" ]]; then
    log "Sleep skipped: could not read HID idle time."
    return 0
  fi

  if (( idle < MIN_IDLE_SECONDS )); then
    log "Sleep skipped: user activity detected recently (${idle}s idle, need ${MIN_IDLE_SECONDS}s)."
    return 0
  fi

  log "Codex task finished and system is idle (${idle}s). Sleeping now."
  /usr/bin/pmset sleepnow
}

log "Local Codex daily task started."
cd "$PROJECT_DIR" || {
  log "Project directory not found: $PROJECT_DIR"
  exit 1
}

if [[ ! -x "$NODE_BIN" ]]; then
  log "Node binary is not executable: $NODE_BIN"
  exit 1
fi

if [[ -x /usr/bin/caffeinate ]]; then
  /usr/bin/caffeinate -dimsu "$NODE_BIN" scripts/local-codex-digest.mjs --pull --send-email --push
else
  "$NODE_BIN" scripts/local-codex-digest.mjs --pull --send-email --push
fi

status=$?
log "Local Codex daily task exited with status ${status}."

if (( status == 0 )); then
  maybe_sleep
else
  log "Sleep skipped: task failed."
fi

exit "$status"
