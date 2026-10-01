#!/bin/bash
# device.sh selects an online physical iOS or tvOS device, builds the matching
# scheme, and installs the resulting app bundle.
#
# device.sh 选择在线的 iOS 或 tvOS 物理设备, 构建匹配的 scheme, 并安装生成的 app bundle.

set -euo pipefail

APPLE_DIR="$(cd "$(dirname "$0")/../apple" && pwd)"

cleanup() {
    [[ -n "${BUILD_PID:-}" ]] && kill "$BUILD_PID" 2>/dev/null
    [[ -n "${INSTALL_PID:-}" ]] && kill "$INSTALL_PID" 2>/dev/null
    exit 130
}
trap cleanup INT

# Capture one xctrace snapshot and propagate discovery failures before parsing.
# xctrace remains the source of truth for online install targets.
#
# 先获取完整的 xctrace 快照并检查命令错误, 再解析设备列表.
# 安装候选设备的在线状态仍以 xctrace 为准.
read_xctrace_devices() {
    if ! XCTRACE_OUTPUT="$(xcrun xctrace list devices)"; then
        echo "Device discovery failed. Check xcode-select -p and select a full Xcode installation." >&2
        return 1
    fi
}

list_xctrace_section() {
    local section="$1"

    printf '%s\n' "$XCTRACE_OUTPUT" | awk -v section="$section" '
        $0 == "== " section " ==" { in_section = 1; next }
        /^==/ { in_section = 0 }
        in_section { print }
    '
}

# Physical device records contain an OS version and a legacy or modern UDID.
# Match that structure rather than the customizable Mac host name.
#
# 物理设备记录包含系统版本和旧版或新版 UDID.
# 按记录结构匹配, 避免依赖可以自定义的 Mac 主机名.
is_supported_physical_device() {
    local device="$1"
    local physical_pattern=' \([0-9]+(\.[0-9]+)*\) \(([[:xdigit:]]{40}|[[:xdigit:]]{8}-[[:xdigit:]]{16})\)$'

    [[ "$device" =~ $physical_pattern ]] \
        && [[ ! "$device" =~ [Aa]pple[[:space:]]*Watch ]]
}

device_udid() {
    local device="$1"

    echo "$device" | sed -E 's/.*\(([A-Fa-f0-9-]{20,})\).*/\1/'
}

# A paired device can appear offline until CoreDevice establishes its connection.
# Probe offline targets once, then require a fresh online xctrace record.
#
# 已配对设备可能在 CoreDevice 建立连接前被列为离线.
# 对离线候选设备探测一次, 随后必须由新的 xctrace 记录确认其在线状态.
refresh_offline_devices() {
    local device udid
    local attempted=false

    while IFS= read -r device; do
        is_supported_physical_device "$device" || continue
        udid="$(device_udid "$device")"
        [[ -z "${KMTV_DEVICE_UDID:-}" || "$udid" == "$KMTV_DEVICE_UDID" ]] || continue

        echo "Checking connection to: $device"
        if ! xcrun devicectl device info details --device "$udid" --timeout 10 >/dev/null; then
            echo "Could not connect. Unlock the device and check USB/Wi-Fi pairing." >&2
        fi
        attempted=true
    done < <(list_xctrace_section "Devices Offline")

    if [[ "$attempted" == true ]]; then
        read_xctrace_devices
    fi
}

# Keep the selected device line and its UDID at the same array index so the
# shell select menu can map a human-readable choice back to xcodebuild's ID.
#
# 设备描述与 UDID 必须保存在相同数组下标, 使 shell select 菜单能把可读选项映射回
# xcodebuild 使用的设备 ID.
load_available_devices() {
    read_xctrace_devices
    refresh_offline_devices
    DEVICES=()
    UDIDS=()

    while IFS= read -r device; do
        is_supported_physical_device "$device" || continue
        DEVICES+=("$device")
        UDIDS+=("$(device_udid "$device")")
    done < <(list_xctrace_section "Devices" | sort)
}

# Offline devices cannot be selected, but list them separately so a missing
# install target points the user to unlocking or reconnecting that device.
#
# 离线设备不能参与选择, 但需要单独列出. 这样安装目标缺失时, 用户能明确判断应解锁
# 或重新连接对应设备.
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
#
# 根据设备类型选择匹配的 Xcode scheme 和构建产物 app bundle 名称.
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

    print_offline_devices
    select_device
    configure_target
    generate_project
    build_app
    install_app "$(built_app_path)"

    echo "Done!"
}

main "$@"
