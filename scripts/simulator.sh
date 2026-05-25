#!/bin/bash
set -euo pipefail

# Build, install, and launch an Apple platform app on a simulator.
# Keep simulator-specific choices in Taskfile.yml, and keep the flow here.

usage() {
    cat <<'EOF'
Usage:
  simulator.sh <scheme> <platform> <device-name> <os-version> <bundle-id> <app-name>

Example:
  simulator.sh KMTV "iOS Simulator" "iPhone 16 Pro" "18.6" com.mritd.kmtv.ios KMTV.app
EOF
}

if [[ $# -ne 6 ]]; then
    usage >&2
    exit 2
fi

SCHEME="$1"
PLATFORM="$2"
DEVICE_NAME="$3"
OS_VERSION="$4"
BUNDLE_ID="$5"
APP_NAME="$6"

cd "$(dirname "$0")/../apple"

DESTINATION="platform=${PLATFORM},name=${DEVICE_NAME},OS=${OS_VERSION}"

sim_udid() {
    local runtime="$1"
    local device="$2"

    xcrun simctl list devices "$runtime" -j \
        | ruby -rjson -e '
            data = JSON.parse($stdin.read)
            devices = data.fetch("devices", {}).values.flatten
            match = devices.find { |d| d["name"] == ARGV[0] && d["isAvailable"] }
            abort("Simulator not found: #{ARGV[0]}") unless match
            puts match.fetch("udid")
        ' "$device"
}

built_app_path() {
    xcodebuild -scheme "$SCHEME" \
        -destination "$DESTINATION" \
        -configuration Debug \
        -showBuildSettings 2>/dev/null \
        | awk '/BUILT_PRODUCTS_DIR/ { print $3; exit }'
}

if [[ ! -d KMTV.xcodeproj ]]; then
    echo "Generating Xcode project..."
    xcodegen generate
fi

echo "Building ${SCHEME} for ${DEVICE_NAME} (${OS_VERSION})..."
xcodebuild -scheme "$SCHEME" \
    -destination "$DESTINATION" \
    -configuration Debug \
    build

UDID="$(sim_udid "${PLATFORM/ Simulator/} ${OS_VERSION}" "$DEVICE_NAME")"
APP_PATH="$(built_app_path)/${APP_NAME}"

echo "Booting simulator..."
xcrun simctl boot "$UDID" 2>/dev/null || true

echo "Installing ${APP_NAME}..."
xcrun simctl install "$UDID" "$APP_PATH"

echo "Launching ${BUNDLE_ID}..."
xcrun simctl launch "$UDID" "$BUNDLE_ID"
open -a Simulator
