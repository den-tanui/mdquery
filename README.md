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
- Output as **json**, **table**, or **csv**
- Aggregates, joins, pipes, and triggers
- Single markdown file or a whole directory
- Recursive search with depth control, hidden-file and `.gitignore` awareness
- Every row exposes `filename`, `path` (relative), and `abspath` (absolute)
- `body` (markdown body without frontmatter) and `frontmatter` (raw parsed object) fields on every row
- Presence-aware queries with `has()`, `is empty`, `is not empty`
- Subqueries with `count(select ...)`, `exists(select ...)`, and `outer.field` correlation
- Set arithmetic: `+` (union), `-` (difference) on lists
- Negated operators: `not contains`, `not starts_with`, `not ends_with`
- Triggers: before/after create/update/delete with deny, set, run
- Markdown body parsing with `sections()`, `section("name")`, `has section("name")`, and `toc()` builtins
- `fields()` builtin returning a frontmatter field map
- Immutable fields: `createdAt` and `updatedAt` cannot be changed via `update`

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
mdquery --format=json "select title, status" > saved.json  # valid JSON, includes meta
```

### Options

| Flag | Description |
| --- | --- |
| `-h`, `--help` | Print the full manual and exit |
| `-v`, `--version` | Print the version and exit |
| `--dir=<path>` | Directory to query (default `.`); repeatable or comma-separated. Supports `.`, `..`, `~`/`~/...`, `$VAR`/`$VAR/suffix` expansion |
| `-f`, `--file=<path>` | Query specific markdown file(s); repeatable or comma-separated. Use `-f -` to read file paths from stdin |
| `-d`, `--depth=<n>` | Search depth: `0` = recursive (default), `1` = top level only, `2+` = limited depth |
| `-H`, `--hidden` | Include hidden files/directories (skipped by default) |
| `--no-ignore` | Disable `.gitignore` filtering (enabled by default) |
| `-y`, `--yes` | Skip confirmation prompts for `update`/`delete` |
| `--format=<fmt>` | Output format: `json`, `table`, `csv` (default `json`) |
| `--json` | Shortcut for `--format=json` |
| `--csv` | Shortcut for `--format=csv` |
| `--table` | Shortcut for `--format=table` |
| `-o`, `--out=<file>` | Write output to a file instead of stdout. If the filename has no extension, the resolved format's extension is appended (e.g. `--out results` → `results.json`); an explicit extension is kept as-is. Parent directories are created automatically |
| `--color` | Force colored output, even when piped (default: auto) |
| `--no-color` | Disable colored output entirely |

Calling `mdquery` with no arguments prints the manual.

### Output modes

**JSON** (default) and **CSV** are data formats — `mdquery "query" --json > saved.json` and `--csv > saved.csv` produce valid files. JSON emits the full result object `{type, data, count, meta}`; CSV is RFC 4180 (proper quoting, newlines, formula escaping).

**Table** is the presentation format: all fields in a box-drawing grid with uppercase headers and row separators. Content column capped at 20 chars (first line + `…`). `abspath` capped at 24 chars (tail display). Long values are truncated with `…` to fit their column (no wrapping). Good for piping, scripts, and quick browsing.

Table/CSV require **scalar columns** (string/number/boolean/null). Arrays of scalars (e.g. `tags`) flatten to `"a,b"`. Functions returning maps or arrays of maps (e.g. `sections()`, `links()`, `codeblocks()`) are JSON-only — table/CSV throw an early error suggesting a rewrite (e.g. `sections().map('title')`).

```bash
# Compact table view
mdquery --format=table "select *"

# Data formats for piping
mdquery --format=json "select *" > saved.json
mdquery --format=csv "select *" > saved.csv

# Write to a file (extension inferred from format)
mdquery --out results "select *"
```

### Colors

Table output is colorized automatically when stdout is a terminal (headers bold blue, borders gray). Piped output and `--out` files are always clean. Override with `--color` (force, even piped) or `--no-color` (disable).

Colors are configurable via the `MDQUERY_COLORS` environment variable (LS_COLORS-style, colon-separated `key=value` SGR codes):

| Key | Default | Used for |
| --- | --- | --- |
| `title` | `01;34` (bold blue) | Table headers |
| `border` | `90` (bright black) | Table borders |
| `error` | `31` (red) | Error messages |
| `warning` | `33` (yellow) | Warning messages |

```bash
MDQUERY_COLORS="title=31:border=36" mdquery --format=table "select *"
```

Unspecified keys fall through to `LS_COLORS` file-like entries (`fi` for title, `di` for border), then to the defaults above. Help text is styled with chalk when on a terminal.

### Configuration file

Defaults can be set in a user-level YAML config file at `$XDG_CONFIG_HOME/mdquery/config.yaml` (or `~/.config/mdquery/config.yaml` when `XDG_CONFIG_HOME` is unset). Keys mirror the CLI flag vocabulary; command-line flags always override config values. Precedence: **flags > environment > config > defaults**.

```yaml
# ~/.config/mdquery/config.yaml
dir: ["~/tasks", "~/notes"]   # default search dirs (--dir)
depth: 2                      # default depth (--depth, 0 = recursive)
hidden: false                 # include hidden files (--hidden)
ignore: true                  # respect .gitignore (--no-ignore to disable)
format: table                 # default output format (--format)
color: auto                   # auto | always | never (--color / --no-color)
compact: false                # compact table view (--compact)
rows: 10                      # max table lines per record (--rows)
columns: "20,*,40"            # table column widths (--columns)
colors:                       # SGR codes, same keys as MDQUERY_COLORS
  title: "01;34"
  border: "90"
```

Unknown keys are ignored (forward compatible); values of the wrong type produce an error. The `colors` map sits below `MDQUERY_COLORS` and `LS_COLORS` in precedence, above the built-in defaults.

### File identity fields

Every row exposes these fields regardless of frontmatter:

| Field | Meaning |
| --- | --- |
| `filename` | File name without the `.md` extension (e.g. `task-001`) |
| `path` | Path relative to the search directory (e.g. `tasks/task-001`) |
| `abspath` | Absolute path to the file |
| `source_dir` | The search directory the file was found in (useful with multiple `--dir`s) |
| `body` | Markdown body with the frontmatter block stripped |
| `frontmatter` | Raw parsed frontmatter object as a single field |

`id` is a plain frontmatter field — it is only present when the file defines it.

### Section and TOC queries

Query markdown body sections:

```bash
# Find files with TODO section
mdquery "select id, filename where has section(\"TODO\")"

# Return the first TODO section's content
mdquery "select id, section(\"TODO\").content where has section(\"TODO\")"

# List all section titles
mdquery "select id, sections().map('title')"

# Return table of contents
mdquery "select id, toc()"
```

`section("name")` returns the first exact-match section as a map `{title, level, position, hierarchy, content}` (or `null`); `sections()` returns all sections as an array of those maps. `section("name").title` / `.content` select scalar properties for table/CSV output.

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

The query engine is a character-by-character lexer, a Pratt parser with a binding-power table, and an expression-tree executor. Supporting modules: `type-system.ts` (typed comparisons, coercion, array set arithmetic), `query-analyzer.ts` (pushdown predicates, lazy-loading analysis), and `content-extractor.ts` (remark-based body extraction). See `docs/superpowers/specs/2026-08-09-parser-rewrite-design.md` for the design.

## License

MIT