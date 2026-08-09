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
```

### Options

| Flag | Description |
| --- | --- |
| `-h`, `--help` | Print the full manual and exit |
| `-v`, `--version` | Print the version and exit |
| `--dir=<path>` | Directory to query (default `.`) |
| `--file=<path>` | Query a single markdown file |
| `--format=<fmt>` | Output format: `json`, `table`, `csv` (default `json`) |

Calling `mdquery` with no arguments prints the manual.

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