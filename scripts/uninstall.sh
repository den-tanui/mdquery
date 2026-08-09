#!/bin/bash
set -e

# mdquery uninstaller
# Usage: bash scripts/uninstall.sh

BINARY_NAME="mdquery"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
BINARY_PATH="${INSTALL_DIR}/${BINARY_NAME}"

echo "Uninstalling ${BINARY_NAME}..."
echo ""

if [ -f "$BINARY_PATH" ]; then
  rm "$BINARY_PATH"
  echo "Removed ${BINARY_PATH}"
else
  echo "Note: ${BINARY_PATH} not found"
fi

echo ""
echo "Uninstall complete!"
