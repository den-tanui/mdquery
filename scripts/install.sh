#!/usr/bin/env bash
# Install the mdquery binary into ~/.local/bin
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target_dir="${MDQUERY_INSTALL_DIR:-$HOME/.local/bin}"
binary="$repo_root/mdquery"

mkdir -p "$target_dir"

if [[ ! -x "$binary" ]]; then
  echo "=> mdquery binary not found, building first..."
  if ! command -v bun >/dev/null 2>&1; then
    echo "error: 'bun' is required to build mdquery (https://bun.sh)" >&2
    exit 1
  fi
  (cd "$repo_root" && bun run build:cli)
fi

install -m 0755 "$binary" "$target_dir/mdquery"
echo "Installed mdquery to $target_dir/mdquery"

case ":$PATH:" in
  *":$target_dir:"*) ;;
  *)
    echo ""
    echo "NOTE: $target_dir is not on your PATH."
    echo "Add this line to your shell profile:"
    echo "  export PATH=\"$target_dir:\$PATH\""
    ;;
esac