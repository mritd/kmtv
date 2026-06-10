#!/bin/bash
set -euo pipefail

APPLE_DIR="$(cd "$(dirname "$0")/../apple" && pwd)"
OUTPUT_DIR="${KMTV_IPA_OUTPUT_DIR:-$APPLE_DIR/build/ipa}"

cleanup() {
    [[ -n "${BUILD_PID:-}" ]] && kill "$BUILD_PID" 2>/dev/null
    if [[ -n "${TMP_DIR:-}" && -d "$TMP_DIR" ]]; then
        rm -rf "$TMP_DIR"
    fi
    exit 130
}
trap cleanup INT

list_xctrace_section() {
    local section="$1"

    xcrun xctrace list devices 2>/dev/null | awk -v section="$section" '
        $0 == "== " section " ==" { in_section = 1; next }
        /^==/ { in_section = 0 }
        in_section { print }
    '
}

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

load_available_devices() {
    DEVICES=()
    UDIDS=()

    while IFS= read -r device; do
        is_supported_physical_device "$device" || continue
        DEVICES+=("$device")
        UDIDS+=("$(device_udid "$device")")
    done < <(list_xctrace_section "Devices" | sort)
}

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

configure_target() {
    if [[ "$DEVICE_NAME" =~ [Aa]pple[[:space:]]*TV ]]; then
        SCHEME="KMTVTV"
        APP_NAME="KMTVTV.app"
        IPA_PREFIX="KMTVTV"
    else
        SCHEME="KMTV"
        APP_NAME="KMTV.app"
        IPA_PREFIX="KMTV"
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

package_ipa() {
    local app_path="$1"
    local timestamp ipa_path

    if [[ ! -d "$app_path" ]]; then
        echo "Built app not found: $app_path"
        exit 1
    fi

    timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    ipa_path="$OUTPUT_DIR/${IPA_PREFIX}-${timestamp}.ipa"
    TMP_DIR="$(mktemp -d)"

    mkdir -p "$OUTPUT_DIR" "$TMP_DIR/Payload"
    cp -R "$app_path" "$TMP_DIR/Payload/"

    (
        cd "$TMP_DIR"
        ditto -c -k --sequesterRsrc --keepParent Payload "$ipa_path"
    )

    rm -rf "$TMP_DIR"
    TMP_DIR=

    echo ""
    echo "IPA created: $ipa_path"
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
    package_ipa "$(built_app_path)"
}

main "$@"
