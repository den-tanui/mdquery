# Design: `--dir` multi-dir + path expansion + `--out`

Session: 2026-08-15-cli-dir-out
Status: draft

## Summary

Enhance the CLI with three capabilities:
1. `--dir` accepts comma-separated directories and resolves `~`, `$ENV`, `.` internally
2. Multi-dir queries produce a flat union with a `source_dir` column
3. `--out` / `-o` writes formatted output to a file

## 1. Path expansion (internal)

### Rules

| Input | Resolved to |
|-------|-------------|
| `.` | `process.cwd()` |
| `..` | `path.resolve('..')` |
| `~` | `os.homedir()` |
| `~/sub` | `os.homedir() + '/sub'` |
| `$ENV_VAR` | `process.env[name]` or error |
| `$ENV_VAR/sub` | `process.env[name] + '/sub'` if set, else `path.resolve('sub')` |
| Relative path | `path.resolve(input)` |

### Behavior

- Expansion runs **after** comma-split, **before** passing to Executor
- Reject `~other` (only current user's home supported)
- Reject undefined env vars without suffix: `error: environment variable $FOO is not set`
- `$VAR/suffix` is **shell-like**: when `$VAR` is set, append the suffix (like the shell would); when unset, use the suffix as a fallback path
- All paths resolved to absolute before Executor sees them
- Single `--dir` values without special chars resolve via `path.resolve()` (i.e. relative to cwd)
- Internal expansion is the fallback for quoted values (`'$HOME/tasks'`), `~` (not expanded inside quotes), and non-shell callers (projext, scripts). Unquoted values are already expanded by the shell before mdquery sees them.

### Implementation

New function `resolveDir(input: string): string` in `cli.ts`:

```typescript
import { homedir } from 'os';
import { resolve } from 'path';

function resolveDir(input: string): string {
  if (input === '.') return process.cwd();
  if (input === '..') return resolve('..');
  if (input.startsWith('~')) {
    if (input === '~') return homedir();
    if (input.startsWith('~/')) return homedir() + input.slice(1);
    throw new Error(`Only ~ (current user) is supported, got: ${input}`);
  }
  if (input.startsWith('$')) {
    const slashIdx = input.indexOf('/');
    const varName = slashIdx > 0 ? input.slice(1, slashIdx) : input.slice(1);
    const suffix = slashIdx > 0 ? input.slice(slashIdx + 1) : undefined;
    const val = process.env[varName];
    if (val === undefined) {
      if (suffix !== undefined) return resolve(suffix);
      throw new Error(`Environment variable $${varName} is not set`);
    }
    return suffix !== undefined ? resolve(val, suffix) : resolve(val);
  }
  return resolve(input);
}
```

### CLI parsing changes

- `--dir` / `--dir=` accepts comma-separated values: `--dir=~/a,~/b`
- Repeatable: `--dir=~/a --dir=~/b` accumulates into the same list
- Each value runs through `resolveDir()`
- Default remains `.` (resolves to cwd)

## 2. Multi-dir queries

### Model: flat union with `source_dir` column

Every row from a multi-dir query includes a `source_dir` column containing the resolved absolute path of the directory the file came from. Single-dir queries also include `source_dir` for consistency.

### Column semantics

| Field | Description | Example |
|-------|-------------|---------|
| `filename` | basename minus `.md` | `foo` |
| `path` | relative to the file's **own** `source_dir` | `skills/foo.md` |
| `abspath` | always absolute | `/home/user/.agents/skills/foo.md` |
| `source_dir` | resolved absolute dir | `/home/user/.agents/skills` |

`path` is always relative to `source_dir`, not to cwd. This preserves single-dir semantics and keeps `path` lightweight.

### Executor changes

**Constructor:** `dir: string` → `dirs: string[]`

**`readFilesWithHooks`:**
1. Loop over each dir in `dirs`
2. For each dir, call `FileOps.readFiles(dir, ...)` or `FastFileOps.listFiles(dir, ...)` + read
3. Stamp `source_dir` on each `FileData` row
4. Merge all `FileData[]` into one flat array
5. Continue with existing WHERE/projection logic on the merged set

**`path` resolution:** In `FileOps.read`, `path = relative(dir, fullPath)` already uses the per-file `dir`. With the loop, each file's `path` is relative to its own `source_dir`.

**Backward compatibility for library consumers:** The `Executor` constructor changes from `dir: string` to `dirs: string[]`. A single string is wrapped in `[dir]` internally. The public API can accept either `string | string[]` for backward compat.

### Query interactions

- `select source_dir` — returns the dir each file came from
- `where source_dir contains 'skills'` — filter by dir
- `order by source_dir` — sort/group by dir
- `group by source_dir` — aggregate per dir
- `select *` — includes `source_dir` (it's a row-level identity field alongside `filename`/`path`/`abspath`)

### Edge cases

- Duplicate files across dirs: possible (same filename in two dirs). `abspath` is unique, `filename` is not. User can deduplicate with `distinct` or `where` as needed.
- **Non-existent dir — CLI behavior (option C):**
  - Single dir (`--dir=/nonexistent`): fail fast — `Error: directory /nonexistent does not exist`, exit 1
  - Multi-dir (`--dir=/a,/b,/missing`): warn + continue — `warning: directory /missing does not exist`, query runs over `/a` and `/b`, exit 0
- **Non-existent dir — Executor behavior:** record in `meta.errors` with `phase: 'read'` and the dir path, continue with remaining dirs. Library consumers (projext, scripts) get the error via `meta.errors` in JSON output, never a crash.
- Empty dir in list: no rows from that dir, no error
- Mixed absolute and relative dirs: all resolved to absolute before Executor

## 3. `--out` / `-o`

### CLI parsing

- `--out=<file>` or `-o <file>` or `-o=<file>`
- `--out=-` explicitly writes to stdout (same as no `--out`)
- Without `--out`, output goes to stdout (backward compatible)

### Format resolution

Format is resolved in this priority order:

1. **`--format` flag** (if explicitly provided) — always wins
2. **File extension** (if `--out` is used and extension is `.json` or `.csv`) — inferred
3. **Default** — `json`

| `--format` | `--out` extension | Resolved format |
|------------|-------------------|-----------------|
| (none)     | `.json`           | json            |
| (none)     | `.csv`            | csv             |
| (none)     | `.txt` or none    | json            |
| `csv`      | `.json`           | csv (flag wins) |
| `json`     | `.csv`            | json (flag wins) |

### Output filename

- If the `--out` filename **has no extension**, infer the extension from the resolved format and append it: `--out results` → `results.json` (default format), `--out results --format=csv` → `results.csv`
- If the `--out` filename **has an extension**, use the user-provided extension as-is (never rewritten): `--out results.csv --format=json` → writes to `results.csv` with JSON content

| `--format` | `--out` path | Written file | Content format |
|------------|--------------|--------------|----------------|
| (none)     | `results`    | `results.json` | json         |
| (none)     | `results.csv`| `results.csv`  | csv          |
| `csv`      | `results`    | `results.csv`  | csv          |
| `csv`      | `results.json`| `results.json`| csv (flag wins) |
| `json`     | `results.csv`| `results.csv`  | json (flag wins) |
| (none)     | `results.txt`| `results.txt`  | json (default) |

### Write behavior

- Creates parent directories if needed (`mkdirSync` with `recursive: true`)
- Overwrites existing file (no append mode)
- Errors (permission, disk full) → `fail()` with message

### Interaction with stdin

- `--out` works with piped input: `echo "select ..." | mdquery --out=results.json`
- `--out=-` with pipe is redundant but harmless

### Interaction with `--dir`

- `--out` captures the formatted output regardless of how many dirs
- `meta.filesSearched` sums across all dirs
- `meta.errors` includes per-dir errors with the dir path

## 4. CLI library: Commander.js

Replace the hand-rolled argument parser in `cli.ts` with Commander.js.

### Why Commander
- Auto-generated `--help` and `--version`
- Variadic options: `--dir <dirs...>` for repeatable flags
- Typed options with TypeScript
- Mature, widely used, zero dependencies

### Definition

```typescript
import { program } from 'commander';
import { VERSION } from './version';

program
  .name('mdquery')
  .version(VERSION)
  .description('Query YAML frontmatter of markdown files with a SQL-like language')
  .argument('[query]', 'SQL-like query string (or pipe from stdin)')
  .option('--dir <dirs...>', 'Directories to query (default: .)', ['.'])
  .option('-f, --file <files...>', 'Specific file(s) to query')
  .option('-d, --depth <n>', 'Directory depth (0 = recursive)', '0')
  .option('-H, --hidden', 'Include hidden files/dirs')
  .option('--no-ignore', 'Do not respect .gitignore')
  .option('-y, --yes', 'Skip confirmation prompts')
  .option('--format <format>', 'Output format: json | table | csv', 'json')
  .option('-o, --out <file>', 'Write output to file (default: stdout)')
  .allowUnknownOption(false)
  .addHelpText('after', `

Examples:
  mdquery "select where status = 'done'"
  mdquery --dir tasks/ "select order by priority"
  mdquery --dir ~/.agents/skills --dir ~/opt/skills "select filename, source_dir"
  mdquery --out results.json "select filename, description"
  fd SKILL.md | mdquery -f - "select name, description"

Query language: docs/syntax.md`);
```

### Changes from current parser

| Current | Commander |
|---------|-----------|
| `--dir=<dir>` single string | `--dir <dirs...>` variadic array |
| Hand-rolled `-h`, `-v` | Built-in `--help`, `--version` |
| Hand-rolled format validation | Option type with validation |
| Manual help text (MANUAL const) | Auto-generated + `addHelpText` |
| No `--out` | `-o, --out <file>` |

### Backward compatibility

- `--dir=~/a,~/b` (comma-separated) — Commander splits on space, not comma. Need a post-processing step: split each dir value on `,` to support comma-separated syntax.
- `-f -` stdin file reading — remains as post-parse logic (Commander doesn't handle this natively).
- Query as positional argument — `program.argument('[query]')` handles this.

## 5. Terminal coloring

### Architecture: presentation-layer coloring only

Coloring is applied ONLY in the presentation layer (terminal display). The formatter
produces clean output by default; file output is clean by construction — never
stripped after the fact.

```
Formatter.format(result, format, { colorize }) → clean output by default
        ↓
CLI presentation layer decides:
  toTerminal = !outPath || outPath === '-'
  colorize   = toTerminal && format === 'table' && color decision
        ↓
--out → write clean output as-is (never colored, no stripping)
stdout → table gets colored titles/border
```

### Color control: CLI flags

- `--color` → force color (even piped)
- `--no-color` → never color
- default → color iff stdout is a TTY (not piped, not `--out` file)

```typescript
const toTerminal = !outPath || outPath === '-';
const colorize = resolvedFormat === 'table' && (
  opts.color === true ||
  (opts.color !== false && toTerminal && !!process.stdout.isTTY)
);
```

Chalk respects `NO_COLOR` / `FORCE_COLOR` env vars and `--color`/`--no-color` in argv.

### Fine-tuning: `MDQUERY_COLORS` env var

LS_COLORS-compatible format (colon-separated `key=value`, values are SGR codes):

```sh
export MDQUERY_COLORS="title=01;34:border=90:error=31:warning=33"
```

| Key | Element | Default |
|-----|---------|---------|
| `title` | table header | `01;34` (bold blue) |
| `border` | table border | `90` (bright black) |
| `error` | `Error: ...` messages | `31` (red) |
| `warning` | `warning: ...` messages | `33` (yellow) |
| `file` | filename/path values (future) | from LS_COLORS `fi` |
| `dir` | source_dir values (future) | from LS_COLORS `di` |

Precedence per element:

```
1. --color / --no-color flags        (on/off, highest)
2. MDQUERY_COLORS env var            (per-element colors)
3. LS_COLORS                         (file-like keys only: file→fi, dir→di)
4. Built-in defaults
```

Partial env var → only specified keys override; rest fall through. The future
config system becomes another layer in the same chain (config → env → flags),
writing the same `key=value` pairs — no new mechanism needed.

### Table rendering: cli-table3

Table output is rendered by **cli-table3** (battle-tested, ANSI-aware width via
`string-width`, custom borders, per-column alignment/wrapping, cell colors).

- Full box-drawing borders (`│ ─ ┌ ┐ └ ┘`) — style configurable later via config system
- `style: { head: [], border: [] }` → clean output by default (file-safe by construction)
- MDQUERY_COLORS SGR codes applied to titles/border as pre-colored strings; the
  library's ANSI-aware width calculation handles them
- mdquery-specific pre-processing stays: semantic caps (content → 20 chars,
  abspath → tail display), toc/section formatting, width fitting to terminal
  (reuse `allocateWidths` → pass as `colWidths`), `No results` for empty

### Use cases in mdquery

**Error messages:**
```typescript
console.error(chalk.red(`Error: ${message}`));
```

**Meta output (warnings):**
```typescript
console.error(chalk.yellow(`warning: skipped ${count} file(s)`));
```

**`--out` success:**
```typescript
console.log(chalk.green(`Written to ${file}`));
```

### Integration with Commander

Commander parses `--color`/`--no-color` as `opts.color` (true/false). Chalk reads
them via `process.argv` and respects `NO_COLOR`/`FORCE_COLOR`. No extra wiring
needed — both respect the same env vars and CLI flags.

### Integration with `--out`

File output is clean by construction: the formatter is called with
`colorize: false` when writing to a file, so no ANSI codes are ever produced.
No stripping, no `chalk.level = 0` needed.

## 6. Updated MANUAL (after Commander + Chalk integration)

Add to options:

```
  --out=<file>, -o <file>  Write output to file (default: stdout)
                           Inferred format from extension: .json, .csv
                           Use -o - for explicit stdout
  --dir=<directories>      Directory to query, comma-separated (default: .)
                           Supports ~, $ENV_VAR, relative paths
```

Update examples:

```
  mdquery --dir=~/.agents/skills,~/opt/skills "select filename, source_dir"
  mdquery --out=results.json "select filename, description"
  mdquery -o results.csv --format=csv "select filename, path"
```

## 7. Testing plan

### Path expansion
- `resolveDir('.')` → cwd
- `resolveDir('~')` → homedir
- `resolveDir('~/foo')` → homedir + '/foo'
- `resolveDir('$HOME')` → env var value
- `resolveDir('$UNDEFINED_VAR')` → error
- `resolveDir('$UNDEFINED_VAR/fallback')` → fallback
- `resolveDir('~other')` → error
- `resolveDir('../foo')` → resolved relative path

### Multi-dir
- Two dirs, flat union, `source_dir` column present
- Single dir, `source_dir` column present (consistency)
- `where source_dir contains 'x'` filters correctly
- Non-existent single dir → CLI fails fast with `Error: directory ... does not exist`, exit 1
- Non-existent dir in multi-dir list → warning printed, other dirs still queried, exit 0
- Non-existent dir → `meta.errors` contains entry with `phase: 'read'` and dir path
- Duplicate filenames across dirs → both rows present
- `path` is relative to each file's source dir

### `--out`
- `--out=test.json` → inferred JSON
- `--out=test.csv` → inferred CSV
- `--out=-` → stdout
- `--out=test.json --format=csv` → CSV (flag wins over extension)
- `--out=nonexistent/dir/file.json` → creates parent dirs
- `--out=test.json` → clean output, no ANSI codes (clean by construction)

### Table rendering (cli-table3)
- Box-drawing borders present in table output
- Width fitting: longest line ≤ terminal width (semantic caps + allocateWidths preserved)
- Semantic caps: content → 20 chars, abspath → tail display
- `No results` for empty result
- toc/section special formatting preserved
- `colorize: false` → no ANSI codes (clean output)
- `colorize: true` → titles/border colored per MDQUERY_COLORS

### Coloring
- `--no-color` flag → no ANSI codes in output
- `--color` flag → force ANSI codes (even piped)
- default → color iff stdout is a TTY
- piped stdout → no color (unless `--color`)
- `NO_COLOR` env var → no ANSI codes
- `FORCE_COLOR` env var → force ANSI codes
- File output (`--out=file.json`) → no ANSI codes regardless of flags
- `MDQUERY_COLORS="title=01;34:border=90"` → titles/border use those SGR codes
- `MDQUERY_COLORS` partial → unspecified keys fall through to defaults
- `MDQUERY_COLORS` unset → defaults used

## 8. Files to modify

| File | Change |
|------|--------|
| `src/cli.ts` | Add `resolveDir`, parse `--dir` as list, parse `--out`, write to file, integrate Commander, `--color`/`--no-color`, presentation-layer colorize decision |
| `src/executor.ts` | `dir: string` → `dirs: string[]`, loop in `readFilesWithHooks`, stamp `source_dir` |
| `src/files.ts` | No changes (already takes single `dir` per call) |
| `src/file-io.ts` | No changes (already takes single `dir` per call) |
| `src/formatter.ts` | Rewrite `toTable` with cli-table3 (box-drawing borders), `colorize` option, MDQUERY_COLORS parsing, keep semantic caps + width fitting |
| `src/types.ts` | `QueryOptions.dir` → `dirs?: string[]` |
| `tests/cli.test.ts` | Add tests for `--dir` multi-dir, path expansion, `--out`, `--color`/`--no-color` |
| `tests/executor.test.ts` | Add tests for multi-dir `readFilesWithHooks` |
| `tests/formatter.test.ts` | Update table tests for cli-table3 output, add colorize/MDQUERY_COLORS tests |

### New dependencies

| Package | Purpose |
|---------|---------|
| `commander` | CLI argument parsing |
| `chalk` | Terminal coloring (CLI messages) |
| `cli-table3` | Table rendering (box-drawing borders, ANSI-aware width) |
