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
- Presence-aware queries with `has()`, `is empty`, `is not empty`
- Subqueries with `count(select ...)`, `exists(select ...)`, and `outer.field` correlation
- Set arithmetic: `+` (union), `-` (difference) on lists
- Negated operators: `not contains`, `not starts_with`, `not ends_with`
- Triggers: before/after create/update/delete with deny, set, run
- Markdown body parsing with `section.<name>` and `toc()` builtins
- `fields()` builtin to list frontmatter fields

## Install

### Via install script (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/den-tanui/mdquery/main/scripts/install.sh | bash
```

### From source

```sh
git clone https://github.com/den-tanui/mdquery.git && cd mdquery
bun install
bun run build:cli   # produces bin/mdquery
```

### As a library

```sh
bun install @den-tanui/mdquery
```

> `bun install` requires `bun`. For other package managers, public release will document equivalents (`npm install @den-tanui/mdquery`).

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

Pipe file paths in via stdin:

```bash
fd SKILL.md | mdquery -f - "select name, description"
find . -name "*.md" | mdquery -f - "select filename, title"
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
| `-f`, `--file=<path>` | Query specific markdown file(s); repeatable or comma-separated. Use `-f -` to read file paths from stdin |
| `-d`, `--depth=<n>` | Search depth: `0` = recursive (default), `1` = top level only, `2+` = limited depth |
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

### Section and TOC queries

Query markdown body sections:

```bash
# Find files with TODO section
mdquery "select id, filename where has section.TODO"

# Return section content
mdquery "select id, section.TODO where has section.TODO"

# Return table of contents
mdquery "select id, toc()"

# Return structured TOC with tree formatting
mdquery --card "select id, toc()"
```

## Query language

See **[docs/syntax.md](docs/syntax.md)** for the full grammar reference (statements, operators, functions, joins, pipes, triggers).

## Examples

See **[docs/examples.md](docs/examples.md)** for worked scenarios.

## Development

```sh
bun install
bun run test    # vitest unit + integration tests
bun run build   # build the library (dist/) and CLI binary (bin/mdquery)
```

## License

MIT