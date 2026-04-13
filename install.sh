#!/bin/bash
set -e

REPO="megatronlabs/Pi3"
INSTALL_DIR="/usr/local/bin"
BINARY="pi3"

# Detect architecture
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  ASSET="pi3-mac-arm64"
else
  ASSET="pi3-mac-x64"
fi

# Get latest release URL
echo "Fetching latest Pi3 release..."
URL=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
  | grep "browser_download_url" \
  | grep "$ASSET" \
  | cut -d '"' -f 4)

if [ -z "$URL" ]; then
  echo "Error: Could not find release asset for $ASSET"
  exit 1
fi

echo "Downloading $ASSET..."
curl -fsSL "$URL" -o "/tmp/$BINARY"
chmod +x "/tmp/$BINARY"

echo "Installing to $INSTALL_DIR/$BINARY (may require sudo)..."
sudo mv "/tmp/$BINARY" "$INSTALL_DIR/$BINARY"

echo ""
echo "Pi3 installed! Run: pi3 --help"
