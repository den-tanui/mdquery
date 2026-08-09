# mdquery

A SQL-like query language for markdown files. Query the YAML frontmatter of your markdown docs as if it were a database table.

```bash
$ mdquery "select title, status where status = 'todo' order by priority"
+----------+--------+
| title    | status |
+----------+--------+
| Fix bug  | todo   |
| Add logo | todo   |
+----------+--------+
$ mdquery "select count(*) group by status"
```

## Features

- SQL-style grammar (`select`, `update`, `create`, `delete`, `where`, `order by`, `group by`, ...)
- Read/write YAML frontmatter in markdown files
- Output as **json**, **table**, **csv**, or **card**
- Aggregates, joins, pipes, and triggers
- Single markdown file or a whole directory
- Recursive search with depth control, hidden-file and `.gitignore` awareness
- Every row exposes `filename`, `path` (relative), and `abspath` (absolute)

## Install

### Via scripts

```bash
git clone <repo-url> mdquery && cd mdquery

# build (requires bun) and copy the binary into ~/.local/bin
./scripts/install.sh

# remove it again
./scripts/uninstall.sh
```

### From source

```sh
bun install
bun run build:cli   # produces the standalone ./mdquery binary
```

### As a library

```sh
bun install @projext/mdquery
```

> `bun install` requires `bun`. For other package managers, public release will document equivalents (`npm install @projext/mdquery`).

## Quick start

Query files in the current directory:

```bash
mdquery "select where status = 'done'"
```

Query a specific directory:

```bash
mdquery --dir tasks/ "select id, title order by priority desc"
```

Query a single file:

```bash
mdquery --file task.md "select title, status"
```

Pipe a query in via stdin:

```bash
echo "select" | mdquery
```

Choose an output format:

```bash
mdquery --format=csv "select title, status"
mdquery --card "select *"  # expanded view with full content
```

### Options

| Flag | Description |
| --- | --- |
| `-h`, `--help` | Print the full manual and exit |
| `-v`, `--version` | Print the version and exit |
| `--dir=<path>` | Directory to query (default `.`) |
| `-f`, `--file=<path>` | Query specific markdown file(s); repeatable or comma-separated |
| `-d`, `--depth=<n>` | Search depth: `0` = current dir only (default), `1` = one level down, `-1` = recursive |
| `-H`, `--hidden` | Include hidden files/directories (skipped by default) |
| `--no-ignore` | Disable `.gitignore` filtering (enabled by default) |
| `-y`, `--yes` | Skip confirmation prompts for `update`/`delete` |
| `--format=<fmt>` | Output format: `json`, `table`, `csv`, `card` (default `json`) |
| `--card` | Shortcut for `--format=card` (expanded view with full content) |

Calling `mdquery` with no arguments prints the manual.

### Output modes

**Compact mode** (default `--format=table`): All fields in a grid. Content column capped at 20 chars (first line + `…`). `abspath` capped at 24 chars (tail display). Good for piping, scripts, and quick browsing.

**Card mode** (`--card`): Expanded view with metadata on top and content below. Content gets full terminal width with multiline preservation. Good for reading full content.

```bash
# Compact table view
mdquery --format=table "select *"

# Card view with full content
mdquery --card "select *"
```

### File identity fields

Every row exposes these fields regardless of frontmatter:

| Field | Meaning |
| --- | --- |
| `filename` | File name without the `.md` extension (e.g. `task-001`) |
| `path` | Path relative to the search directory (e.g. `tasks/task-001`) |
| `abspath` | Absolute path to the file |

`id` is a plain frontmatter field — it is only present when the file defines it.

## Query language

See **[docs/syntax.md](docs/syntax.md)** for the full grammar reference (statements, operators, functions, joins, pipes, triggers).

## Examples

See **[docs/examples.md](docs/examples.md)** for worked scenarios.

## Development

```sh
bun install
bun run test    # vitest unit + integration tests
bun run build   # build the library (dist/) and CLI binary (/mdquery)
```

## License

MIT