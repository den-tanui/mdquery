#!/bin/bash
set -e

# mdquery installer
# Usage: curl -fsSL https://raw.githubusercontent.com/den-tanui/mdquery/main/scripts/install.sh | bash

REPO="den-tanui/mdquery"
BINARY_NAME="mdquery"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"

# Detect OS and architecture
detect_platform() {
  local os arch
  
  case "$(uname -s)" in
    Linux*)     os="linux" ;;
    Darwin*)    os="darwin" ;;
    MINGW*|MSYS*|CYGWIN*)  os="windows" ;;
    *)
      echo "Error: Unsupported OS $(uname -s)"
      exit 1
      ;;
  esac
  
  case "$(uname -m)" in
    x86_64|amd64)  arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *)
      echo "Error: Unsupported architecture $(uname -m)"
      exit 1
      ;;
  esac
  
  echo "${os}-${arch}"
}

# Get latest release version
get_latest_version() {
  curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/'
}

# Download binary
download_binary() {
  local version=$1
  local platform=$2
  local url="https://github.com/${REPO}/releases/download/${version}/${BINARY_NAME}-${platform}"
  local tmp_file
  
  tmp_file=$(mktemp)
  
  echo "Downloading ${BINARY_NAME} ${version} for ${platform}..."
  curl -fsSL -o "$tmp_file" "$url"
  
  chmod +x "$tmp_file"
  echo "$tmp_file"
}

# Install binary
install_binary() {
  local binary_path=$1
  
  mkdir -p "$INSTALL_DIR"
  mv "$binary_path" "${INSTALL_DIR}/${BINARY_NAME}"
  echo "Installed ${BINARY_NAME} to ${INSTALL_DIR}/${BINARY_NAME}"
}

# Add to PATH if needed
check_path() {
  if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo ""
    echo "Note: ${INSTALL_DIR} is not in your PATH."
    echo "Add the following to your shell profile:"
    echo ""
    echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    echo ""
  fi
}

main() {
  local platform version binary_path
  
  echo "Installing ${BINARY_NAME}..."
  echo ""
  
  platform=$(detect_platform)
  version=$(get_latest_version)
  
  if [ -z "$version" ]; then
    echo "Error: Could not determine latest version"
    exit 1
  fi
  
  echo "Latest version: ${version}"
  echo "Platform: ${platform}"
  echo ""
  
  binary_path=$(download_binary "$version" "$platform")
  install_binary "$binary_path"
  
  echo ""
  echo "Installation complete!"
  echo ""
  
  check_path
  
  echo "Run '${BINARY_NAME} --help' to get started."
}

main "$@"
