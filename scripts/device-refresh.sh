#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="${KMTV_DEVICE_REFRESH_STATE_DIR:-$HOME/Library/Application Support/KMTV/device-refresh}"
LOG_DIR="${KMTV_DEVICE_REFRESH_LOG_DIR:-$HOME/Library/Logs/KMTV}"
INTERVAL_SECONDS="${KMTV_DEVICE_REFRESH_INTERVAL_SECONDS:-172800}"
TASK_BIN="${KMTV_TASK_BIN:-}"
LOCK_DIR="$STATE_DIR/lock"
LOG_FILE="$LOG_DIR/device-refresh.log"

log() {
    mkdir -p "$LOG_DIR"
    printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG_FILE"
}

now_epoch() {
    date +%s
}

last_success_epoch() {
    local udid="$1"
    local last_success_file="$STATE_DIR/last-success-$udid"

    if [[ -f "$last_success_file" ]]; then
        cat "$last_success_file"
    else
        echo 0
    fi
}

is_due() {
    local udid="$1"
    local now last

    now="$(now_epoch)"
    last="$(last_success_epoch "$udid")"
    [[ $((now - last)) -ge "$INTERVAL_SECONDS" ]]
}

acquire_lock() {
    mkdir -p "$STATE_DIR"
    if mkdir "$LOCK_DIR" 2>/dev/null; then
        trap 'rm -rf "$LOCK_DIR"' EXIT
        return 0
    fi

    log "Another refresh is already running."
    exit 0
}

resolve_task_bin() {
    if [[ -n "$TASK_BIN" && -x "$TASK_BIN" ]]; then
        return
    fi

    TASK_BIN="$(command -v task || true)"
    if [[ -n "$TASK_BIN" ]]; then
        return
    fi

    for candidate in "$HOME/gopath/bin/task" "/opt/homebrew/bin/task" "/usr/local/bin/task"; do
        if [[ -x "$candidate" ]]; then
            TASK_BIN="$candidate"
            return
        fi
    done

    log "task binary not found. Set KMTV_TASK_BIN."
    exit 2
}

device_udids() {
    local raw="${KMTV_DEVICE_UDIDS:-${KMTV_DEVICE_UDID:-}}"

    if [[ -z "$raw" ]]; then
        log "KMTV_DEVICE_UDID or KMTV_DEVICE_UDIDS is required."
        exit 2
    fi

    echo "$raw" | tr ',' '\n' | awk '{$1=$1; if ($0 != "") print}'
}

refresh_device() {
    local udid="$1"
    local last_success_file="$STATE_DIR/last-success-$udid"

    if ! is_due "$udid"; then
        log "Refresh skipped for $udid; last successful install is still recent."
        return 0
    fi

    log "Starting device refresh for $udid."
    if (
        cd "$REPO_DIR"
        KMTV_DEVICE_UDID="$udid" "$TASK_BIN" device
    ) >>"$LOG_FILE" 2>&1; then
        now_epoch >"$last_success_file"
        log "Device refresh completed for $udid."
    else
        log "Device refresh failed for $udid."
        return 1
    fi
}

main() {
    local failed=0
    local udid

    acquire_lock
    resolve_task_bin

    while IFS= read -r udid; do
        if ! refresh_device "$udid"; then
            failed=1
        fi
    done < <(device_udids)

    exit "$failed"
}

main "$@"
