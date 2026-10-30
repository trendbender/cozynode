#!/usr/bin/env bash
# Pack extension/ into dist/cozynode-<version>.zip for the Chrome Web Store.
set -euo pipefail
cd "$(dirname "$0")/.."
v=$(python3 -c 'import json;print(json.load(open("extension/manifest.json"))["version"])')
mkdir -p dist
rm -f "dist/cozynode-$v.zip"
(cd extension && zip -qr -X "../dist/cozynode-$v.zip" . -x '.*')
echo "dist/cozynode-$v.zip"
