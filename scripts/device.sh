#!/bin/bash
set -euo pipefail

APPLE_DIR="$(cd "$(dirname "$0")/../apple" && pwd)"

cleanup() {
    [[ -n "${BUILD_PID:-}" ]] && kill "$BUILD_PID" 2>/dev/null
    [[ -n "${INSTALL_PID:-}" ]] && kill "$INSTALL_PID" 2>/dev/null
    exit 130
}
trap cleanup INT

# xctrace is the source of truth for physical-device visibility. Parse sections
# explicitly so offline devices are never offered as install targets.
list_xctrace_section() {
    local section="$1"

    xcrun xctrace list devices 2>/dev/null | awk -v section="$section" '
        $0 == "== " section " ==" { in_section = 1; next }
        /^==/ { in_section = 0 }
        in_section { print }
    '
}

# Filter out host/watch entries. This script only installs the app targets that
# this project owns: iOS and tvOS.
is_supported_physical_device() {
    local device="$1"

    [[ -n "$device" ]] \
        && [[ "$device" != *MacBook* ]] \
        && [[ ! "$device" =~ [Aa]pple[[:space:]]*Watch ]]
}

device_udid() {
    local device="$1"

    echo "$device" | sed -E 's/.*\(([A-Fa-f0-9-]{20,})\).*/\1/'
}

# Keep the selected device line and its UDID at the same array index so the
# shell select menu can map a human-readable choice back to xcodebuild's ID.
load_available_devices() {
    DEVICES=()
    UDIDS=()

    while IFS= read -r device; do
        is_supported_physical_device "$device" || continue
        DEVICES+=("$device")
        UDIDS+=("$(device_udid "$device")")
    done < <(list_xctrace_section "Devices" | sort)
}

# Offline devices are not actionable, but showing them makes the common
# "unlock or reconnect the device" failure mode obvious.
print_offline_devices() {
    local offline_devices=()

    while IFS= read -r device; do
        is_supported_physical_device "$device" || continue
        offline_devices+=("$device")
    done < <(list_xctrace_section "Devices Offline")

    if [[ ${#offline_devices[@]} -eq 0 ]]; then
        return
    fi

    echo ""
    echo "Offline devices:"
    printf '%s\n' "${offline_devices[@]}"
}

select_device() {
    if [[ -n "${KMTV_DEVICE_UDID:-}" ]]; then
        local index
        for index in "${!UDIDS[@]}"; do
            if [[ "${UDIDS[$index]}" == "$KMTV_DEVICE_UDID" ]]; then
                DEVICE_UDID="$KMTV_DEVICE_UDID"
                DEVICE_NAME="${DEVICES[$index]}"
                echo "Selected device from KMTV_DEVICE_UDID: $DEVICE_NAME"
                return
            fi
        done

        echo "Device not found for KMTV_DEVICE_UDID=$KMTV_DEVICE_UDID"
        print_offline_devices
        exit 1
    fi

    echo "Available devices:"
    echo ""

    PS3=$'\nSelect device: '
    select choice in "${DEVICES[@]}"; do
        if [[ -n "$choice" ]]; then
            DEVICE_NAME="$choice"
            DEVICE_UDID="${UDIDS[$((REPLY - 1))]}"
            return
        fi

        echo "Invalid selection."
    done
}

# Map device family to the matching Xcode scheme and built app bundle.
configure_target() {
    if [[ "$DEVICE_NAME" =~ [Aa]pple[[:space:]]*TV ]]; then
        SCHEME="KMTVTV"
        APP_NAME="KMTVTV.app"
    else
        SCHEME="KMTV"
        APP_NAME="KMTV.app"
    fi
}

generate_project() {
    cd "$APPLE_DIR"
    if [[ ! -d KMTV.xcodeproj ]]; then
        xcodegen generate
    fi
}

build_app() {
    echo ""
    echo "Building $SCHEME for: $DEVICE_NAME"
    echo ""

    xcodebuild -scheme "$SCHEME" \
        -destination "id=$DEVICE_UDID" \
        -configuration Debug \
        -allowProvisioningUpdates \
        build &
    BUILD_PID=$!
    wait "$BUILD_PID"
    BUILD_PID=
}

built_app_path() {
    local products_dir

    products_dir="$(
        xcodebuild -scheme "$SCHEME" \
            -destination "id=$DEVICE_UDID" \
            -configuration Debug \
            -showBuildSettings 2>/dev/null \
            | awk '/BUILT_PRODUCTS_DIR/ { print $3; exit }'
    )"

    echo "${products_dir}/${APP_NAME}"
}

install_app() {
    local app_path="$1"

    echo ""
    echo "Installing $app_path..."

    xcrun devicectl device install app --device "$DEVICE_UDID" "$app_path" &
    INSTALL_PID=$!
    wait "$INSTALL_PID"
    INSTALL_PID=
}

main() {
    load_available_devices
    if [[ ${#DEVICES[@]} -eq 0 ]]; then
        echo "No physical devices found."
        echo "Check USB/Wi-Fi connection and Xcode pairing."
        print_offline_devices
        exit 1
    fi

    select_device
    configure_target
    generate_project
    build_app
    install_app "$(built_app_path)"

    echo "Done!"
}

main "$@"
