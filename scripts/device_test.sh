#!/bin/bash
# Exercise device discovery through the real CLI with controlled Xcode responses.
#
# 使用可控的 Xcode 响应, 通过真实 CLI 验证设备发现流程.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
mkdir -p "$TEST_DIR/bin"

cat > "$TEST_DIR/bin/xcrun" <<'MOCK'
#!/bin/bash
set -euo pipefail
if [[ "$*" == "xctrace list devices" ]]; then
    if [[ "$KMTV_TEST_CASE" == tool_error ]] \
        || { [[ "$KMTV_TEST_CASE" == refresh_error ]] && [[ -f "$KMTV_TEST_DIR/probed" ]]; }; then
        echo 'xcrun: error: unable to find utility "xctrace"' >&2
        exit 72
    fi
    if [[ "$KMTV_TEST_CASE" == reconnect && -f "$KMTV_TEST_DIR/probed" ]]; then
        cat "$KMTV_TEST_DIR/online"
    else
        cat "$KMTV_TEST_DIR/initial"
    fi
elif [[ "${1:-} ${2:-} ${3:-} ${4:-}" == 'devicectl device info details' ]] \
    && [[ "${5:-}" == --device && "${6:-}" == 00008122-000909903498401C ]] \
    && [[ "${7:-}" == --timeout && "${8:-}" =~ ^[0-9]+$ ]]; then
    touch "$KMTV_TEST_DIR/probed"
    [[ "$KMTV_TEST_CASE" != unreachable ]]
else
    echo "Unexpected xcrun call: $*" >&2
    exit 99
fi
MOCK

cat > "$TEST_DIR/bin/xcodebuild" <<'MOCK'
#!/bin/bash
echo 'Unexpected build after closing the device menu.' >&2
exit 99
MOCK
chmod +x "$TEST_DIR/bin/xcrun" "$TEST_DIR/bin/xcodebuild"

host='xmac (5778F003-F65A-5022-B013-2EA58398B7C1)'
ipad='iPad (18.6.2) (00008122-000909903498401C)'
tv='Apple TV (18.5) (1234567890abcdef1234567890abcdef12345678)'
watch='Apple Watch (11.6) (00008110-000909903498401C)'
simulator='iPad Simulator (18.6) (00000000-1111-2222-3333-444444444444)'

run_case() {
    local scenario="$1"
    local case_dir="$TEST_DIR/$scenario"
    mkdir -p "$case_dir"

    case "$scenario" in
        host_only | tool_error)
            printf '== Devices ==\n%s\n' "$host" > "$case_dir/initial"
            ;;
        online)
            printf '== Devices ==\n%s\n%s\n%s\n%s\n\n== Simulators ==\n%s\n' \
                "$host" "$ipad" "$tv" "$watch" "$simulator" > "$case_dir/initial"
            ;;
        renamed)
            printf '== Devices ==\n%s\nMacBook (18.6.2) (00008122-000909903498401C)\n' \
                "$host" > "$case_dir/initial"
            ;;
        mixed)
            printf '== Devices ==\n%s\n%s\n\n== Devices Offline ==\n%s\n' \
                "$host" "$tv" "$ipad" > "$case_dir/initial"
            ;;
        *)
            printf '== Devices ==\n%s\n\n== Devices Offline ==\n%s\n' \
                "$host" "$ipad" > "$case_dir/initial"
            ;;
    esac
    printf '== Devices ==\n%s\n%s\n' "$host" "$ipad" > "$case_dir/online"

    status=0
    PATH="$TEST_DIR/bin:$PATH" KMTV_TEST_DIR="$case_dir" KMTV_TEST_CASE="$scenario" \
        KMTV_DEVICE_UDID= /bin/bash "$SCRIPT_DIR/device.sh" </dev/null \
        > "$case_dir/output" 2>&1 || status=$?
    output="$(cat "$case_dir/output")"
}

contains() { [[ "$output" == *"$1"* ]]; }
excludes() { [[ "$output" != *"$1"* ]]; }

check_case() {
    [[ "$status" -ne 0 ]] \
        && excludes 'Unexpected' \
        && excludes 'unbound variable' \
        && excludes 'xmac' || return 1

    case "$1" in
        host_only)
            contains 'No physical devices found.' && excludes 'Available devices:'
            ;;
        online)
            contains "1) $tv" && contains "2) $ipad" \
                && excludes "$watch" && excludes "$simulator"
            ;;
        renamed)
            contains '1) MacBook (18.6.2)'
            ;;
        reconnect)
            contains "1) $ipad" && excludes 'No physical devices found.'
            ;;
        unreachable | still_offline)
            contains 'No physical devices found.' && contains 'Offline devices:' \
                && contains "$ipad" && excludes 'Available devices:'
            ;;
        mixed)
            contains "1) $tv" && contains 'Offline devices:' && contains "$ipad" \
                && excludes "2) $ipad"
            ;;
        tool_error | refresh_error)
            contains 'unable to find utility "xctrace"' \
                && excludes 'No physical devices found.' && excludes 'Available devices:'
            ;;
    esac
}

failures=0
for scenario in host_only online renamed reconnect unreachable still_offline mixed tool_error refresh_error; do
    run_case "$scenario"
    if check_case "$scenario"; then
        echo "PASS: $scenario"
    else
        echo "FAIL: $scenario (exit $status)"
        printf '%s\n' "$output"
        failures=$((failures + 1))
    fi
done

[[ "$failures" -eq 0 ]]
