#!/bin/bash
set -e

echo "Setting up git hooks..."

# Configure git to use our hooks directory
git config core.hooksPath .githooks

echo "Git hooks configured!"
echo ""
echo "Pre-commit hook will run:"
echo "  - Formatter"
echo "  - Linter"
echo "  - Tests"
