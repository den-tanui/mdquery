#!/usr/bin/env bash
# Remove the mdquery binary installed by scripts/install.sh
set -euo pipefail

target_dir="${MDQUERY_INSTALL_DIR:-$HOME/.local/bin}"
target="$target_dir/mdquery"

if [[ -f "$target" ]]; then
  rm -f "$target"
  echo "Removed $target"
else
  echo "mdquery is not installed at $target" >&2
fi