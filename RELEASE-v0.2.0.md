# Release v0.2.0

## What's New

### Features
- **Section parsing** — query markdown body sections with `section.<name>`
- **TOC builtin** — return table of contents with `toc()` or `toc(true)` for structured output
- **Fields builtin** — list frontmatter fields with `fields()` or `fields(true)` for field map
- **ExecutorHooks** — extensible executor with `onBeforeExecute`, `onEvaluateValue`, `onBeforeWrite`, `onAfterRead` hooks
- **CI/CD pipeline** — GitHub Actions workflow for testing and releasing binaries

### Improvements
- **Install script** — one-line install via curl
- **Binary builds** — pre-built binaries for linux-x64, darwin-x64, darwin-arm64
- **Version auto-update** — CI automatically updates version from git tags
- **Pre-commit hooks** — runs tests, formatter, and linter before each commit

### Bug Fixes
- Updated GitHub Actions to Node.js 24 compatible versions
- Fixed repo references to den-tanui/mdquery

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/den-tanui/mdquery/main/scripts/install.sh | bash
```

## Query Examples

```sql
-- Find files with TODO section
select id, filename where has section.TODO

-- Return section content
select id, section.TODO where has section.TODO

-- Return table of contents
select id, toc()

-- Return structured TOC with tree formatting
select id, toc(true)

-- List all frontmatter fields
select id, fields()
```

## Binary Downloads

| Platform | Architecture | Binary |
|----------|--------------|--------|
| Linux | x86_64 | `mdquery-linux-x64` |
| macOS | Intel | `mdquery-darwin-x64` |
| macOS | Apple Silicon | `mdquery-darwin-arm64` |

## Full Changelog

https://github.com/den-tanui/mdquery/compare/v0.1.1...v0.2.0
