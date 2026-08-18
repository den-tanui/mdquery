# mdquery Roadmap

**Goal:** Ship a hardened, well-documented, published v1.0 — the stable query engine between AI agents and markdown-as-data.

mdquery is already feature-complete and bug-fixed for its core use cases (579 tests passing, 29 test files). v1.0 is about making what exists bulletproof, tested at scale, and teaching people how to use it.

---

## Use cases driving v1.0

1. **AI agent file reading** — return TOC/section titles so agents don't load full files (token savings)
2. **AI agent skill discovery** — query name/description across non-standard dirs without loading every file
3. **AI memory** — CRUD + rich query over markdown knowledge bases
4. **Projext** — project/task management backed by markdown files

---

## Phase 1: Performance benchmarks

Expand the existing benchmark suite (`tests/benchmark-*.test.ts`) with synthetic fixture generation.

### Fixture generator (`tests/fixtures/generator.ts`)

A function that creates temporary directories with configurable markdown files:

```typescript
generateFixture({
  count: 10000,         // number of files
  fields: 10,           // frontmatter fields per file
  sections: 20,         // sections per file body
  links: 50,            // links per file
  codeblocks: 10,       // codeblocks per file
  malformedRate: 0.05,  // 5% malformed files
})
```

### Benchmark scenarios

| Scenario | What it measures | Scale |
|----------|-----------------|-------|
| Frontmatter scan | `select name, description` on N files | 100 / 1k / 10k / 50k files |
| TOC extraction | `select sections().map('title')` on single file | 10 / 100 / 1000 sections |
| Body content search | `select * where body contains "X"` | 100 / 1k / 10k files |
| Complex query pipeline | JOIN + subquery + GROUP BY | 500 files, 2 dirs |
| Malformed file resilience | Query with 5%, 20%, 50% bad files | 1000 files |
| Memory usage | Track heap growth during large queries | All scales |
| Legacy vs fast path | `FileOps` vs `FastFileOps` timing | 100 / 1k / 10k |

### Tooling

- `vitest bench` for statistical rigor (ops/sec, variance, p99)
- `performance.now()` + `process.memoryUsage()` for timing and memory
- Fixtures created in `os.tmpdir()`, cleaned in `afterAll`

**Acceptance criteria:** Benchmark suite runs, produces repeatable numbers. Performance baselines recorded.

---

## Phase 2: Correctness edge cases

Add a dedicated test file for edge cases the happy-path tests miss.

### Input edge cases

- Empty files, files with no frontmatter, files with empty frontmatter
- Very large frontmatter (100KB, 1MB)
- Deeply nested YAML (objects 10+ levels deep)
- Binary files in search directory
- Symlinks to markdown files
- Read-only files
- Unicode: CJK filenames, emoji in fields, RTL text, zero-width characters
- Path edge cases: spaces, special characters, very long paths

### Content edge cases

- Deeply nested headings (h1→h6→h6→h6)
- Codeblocks with every language
- Markdown tables, images, links, blockquotes
- Files with only frontmatter (no body)
- Files with only body (no frontmatter)
- Very long lines (10KB+)

### Query edge cases

- Empty result sets from every clause
- NULL comparisons (`= null`, `!= null`, `is empty`)
- Self-referencing subqueries
- 0-row GROUP BY (no groups match HAVING)
- LIMIT 0, OFFSET beyond result count
- ORDER BY on mixed types (strings + numbers + nulls)

**Acceptance criteria:** Edge case test file covers all categories. All tests pass.

---

## Phase 3: Documentation site (VitePress)

### Structure

```
docs/
  index.md                          # Landing page: what mdquery does, install, 30-second example
  guide/
    getting-started.md              # First query, output formats, file structure
    cli.md                          # Full CLI reference (flags, stdin, file identity fields)
    library.md                      # Library API: Executor, FileOps, Formatter, types
    query-language.md               # SELECT, UPDATE, CREATE, DELETE, WHERE, ORDER BY, etc.
    content-extraction.md           # sections(), section(), toc(), body field
    config.md                       # Config file, env vars, precedence
    recipes/
      agent-file-reading.md         # Use case 1: TOC/section extraction for agents
      skill-metadata.md             # Use case 2: querying skill dirs
      ai-memory.md                  # Use case 3: memory as markdown
      projext-tasks.md              # Use case 4: task management
      custom-builtins.md            # Extending with hooks (projext layer)
  reference/
    syntax.md                       # Complete grammar (statements, operators, builtins, types)
    builtins.md                     # Every builtin function: signature, args, return type, examples
    error-handling.md               # meta.errors, error phases, resilience behavior
    type-system.md                  # Coercion rules, array operations, set arithmetic
  examples/
    filtering.md                    # WHERE clause examples (string, numeric, array, nested)
    aggregation.md                  # GROUP BY, HAVING, aggregates
    joins.md                        # JOIN across directories
    subqueries.md                   # count(), exists(), correlated subqueries
    triggers.md                     # before/after create/update/delete
    stdin-pipe.md                   # Piping queries and file lists
  changelog.md                      # What changed in each version
```

### VitePress setup

- **Config:** `docs/.vitepress/config.ts`
- **Theme:** Default VitePress theme with sidebar, search, dark mode
- **Deployment:** GitHub Actions workflow → GitHub Pages
- **Code examples:** Fenced code blocks with `mdquery` shell prompts
- **Search:** Built-in local search (no external service needed)

### Deployment workflow

```yaml
# .github/workflows/docs.yml
name: Deploy docs
on:
  push:
    branches: [main]
    paths: ['docs/**']
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: cd docs && npm install && npm run build
      - uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: docs/.vitepress/dist
```

**Acceptance criteria:** Doc site builds, deploys to GitHub Pages, all pages have content, search works.

---

## Phase 4: Library API polish

mdquery is both a CLI and a library. The library surface needs to be clean for v1.0.

### Current exports (`src/index.ts`)

```typescript
export { Lexer, Parser, QueryAnalyzer, Executor }
export { FileOps, FastFileOps, Builtins, Formatter, OutputFormat }
export * from './types'
```

### v1.0 targets

- **JSDoc comments** on every exported class and method
- **Usage examples** in JSDoc for `Executor`, `Formatter`, `FileOps`
- **Type exports** — ensure all consumer-facing types are exported and documented
- **Error types** — custom error classes for parse errors, execution errors, file errors
- **README library section** — expand with install, basic usage, API overview

**Acceptance criteria:** Library API has JSDoc on every export. README has library usage section. `bun run build:lib` produces clean `.d.ts` files.

---

## Phase 5: Publishing

### npm

- Package name: `@den-tanui/mdquery`
- Dual entry: CLI binary + library ESM
- `.npmignore` to exclude test fixtures, docs, scripts
- `prepublishOnly` script runs tests + build
- Tag `v1.0.0` on npm publish

### AUR

- Package name: `mdquery-bin` (binary package)
- Install script: `scripts/install.sh` fetches GitHub release binary
- PKGBUILD in AUR repo

### GitHub Release

- Tag `v1.0.0`
- Release notes: highlights, install methods, breaking changes (if any)
- Binary assets for linux-x64, linux-arm64, macos-x64, macos-arm64

**Acceptance criteria:** `npm install -g @den-tanui/mdquery` works. AUR package installable. GitHub release with binaries.

---

## Pre-release improvements (v0.2.3–v0.2.9)

Incremental engine improvements. These run in parallel with Phases 1–6 and ship as separate minor releases before v1.0.

**Ordering principle:** All standalone features ship first (v0.2.3–v0.2.6). Dependent features ship after their prerequisites (v0.2.7–v0.2.9). Max dependency depth: 1.

```
Tier 1 (standalone):    v0.2.3 ──→ v0.2.4 ──→ v0.2.5 ──→ v0.2.6
                                                              │
Tier 2 (dependent):     v0.2.7 ←── v0.2.3    v0.2.8 ←── v0.2.3    v0.2.9 ←── v0.2.6
```

---

### v0.2.3 — Metrics, observability & atomic batch operations

**Foundation release.** No dependencies on other v0.2.x versions.

#### Metrics & observability

Expand the existing `QueryMeta` (types.ts) to give users visibility into query execution. Currently `meta` contains `filesSearched`, `filesMatched`, `timings`, and `errors`. Enhance it:

```typescript
interface QueryMeta {
  filesSearched: number;
  filesMatched: number;
  timings: QueryTimings;          // existing
  errors: FileError[];            // existing
  // NEW ↓
  queryHash: string;              // SHA-256 of normalized query string
  cacheHit: boolean;              // whether result came from materialized cache
  indexUsed: boolean;             // whether index was used for lookup
  pipeline: string[];             // execution steps taken (e.g. ['list', 'prefilter', 'read', 'evaluate', 'project'])
  fieldCount: number;             // number of fields in projection
  sortApplied: boolean;           // whether ORDER BY was applied
  distinctApplied: boolean;       // whether DISTINCT was applied
  rowsBeforeLimit: number;        // total rows before LIMIT/OFFSET (for pagination info)
}
```

**CLI enhancements:**
- `mdquery --meta` — print meta to stderr after query results
- `mdquery --meta --json` — full `QueryResult` object in JSON output (already includes meta)

**Library usage:**
```typescript
const result = await executor.execute('select title, status where status = "todo"');
console.log(result.meta);  // full execution report
```

**Implementation:**
- `queryHash`: normalize query string (trim, collapse whitespace), SHA-256 it in `execute()` (executor.ts:77)
- `pipeline`: push step names into `ExecutionState` as each phase completes
- `rowsBeforeLimit`: track total before LIMIT is applied in the projection loop (executor.ts:303-322)
- `cacheHit`/`indexUsed`: set by the cache/index layers (v0.2.8/v0.3) — default `false` for now

#### Atomic batch operations

Currently `update`/`delete` mutate files one-by-one (executor.ts:559-577, 642-645). A crash at file 50/100 leaves a partially-applied batch.

**Write-ahead log (WAL):**

```
.mdquery/
  wal/
    2026-08-17T20:00:00Z.jsonl     # one entry per mutation batch
```

WAL entry format:
```json
{
  "id": "2026-08-17T20:00:00Z-abc123",
  "timestamp": "2026-08-17T20:00:00Z",
  "operation": "update",
  "query": "update set status = 'done' where status = 'todo'",
  "files": [
    {"path": "skills/auth.md", "before": {"status": "todo"}, "after": {"status": "done"}},
    {"path": "skills/db.md", "before": {"status": "todo"}, "after": {"status": "done"}}
  ],
  "status": "pending"  // pending → committed
}
```

**Execution flow:**
1. Read matched files, snapshot `before` state for each
2. Write WAL entry with `status: "pending"`
3. Apply mutations to files
4. Update WAL entry to `status: "committed"`

**Recovery:** On `mdquery recover`, scan WAL for `pending` entries and either re-apply or revert using `before` snapshots.

**Implementation:**
- New module: `src/wal.ts` — `WalWriter`, `WalEntry`, `recover()`
- `executeUpdate`/`executeDelete` wrap existing logic in WAL transactions (executor.ts:542-651)
- CLI: `mdquery recover` command in `src/cli.ts`
- No-op for single-file operations (optimization: skip WAL for `count === 1`)

**Acceptance criteria:** `QueryMeta` includes new fields. `--meta` flag prints execution report. Batch update writes WAL entry. `mdquery recover` reverts incomplete batch. All 579 existing tests still pass. New tests for WAL + meta.

---

### v0.2.4 — Output formats: markdown, XML, HTML

**Standalone release.** No dependencies on other v0.2.x versions.

Extend the formatter to support three new output formats alongside existing json/table/csv.

#### Markdown table output

Produces a GFM-compatible markdown table. Useful for embedding in documents, pasting into GitHub issues, or piping to markdown renderers.

```bash
mdquery "select title, status where status = 'todo'" --format=markdown
```

Output:
```markdown
| title | status |
|-------|--------|
| Auth Skills | todo |
| DB Skills | todo |
| API Skills | todo |
```

**Implementation:**
- New method `toMarkdownTable()` in `src/formatter.ts`
- GFM pipe-delimited format with header separator row
- Handles pipe characters in values (escape with `\|`)
- Handles newlines in values (replace with `<br>`)
- Long values wrap per column width (same logic as table renderer)

**CLI flag:** `--format=markdown` or `--md` (shortcut alias)

#### XML output

Produces well-formed XML. Useful for interoperability with XML-based tools, XSLT transformations, and enterprise systems.

```bash
mdquery "select title, status where status = 'todo'" --format=xml
```

Output:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<results count="3" query="select title, status where status = &quot;todo&quot;">
  <row>
    <title>Auth Skills</title>
    <status>todo</status>
  </row>
  <row>
    <title>DB Skills</title>
    <status>todo</status>
  </row>
  <row>
    <title>API Skills</title>
    <status>todo</status>
  </row>
</results>
```

**Implementation:**
- New method `toXml()` in `src/formatter.ts`
- Escape `<`, `>`, `&`, `"`, `'` in values
- `<results>` root with `count` and `query` attributes
- `<row>` elements with child elements per field
- Field names become element names (sanitize: `filename` → `filename`, `file.name` → `file_name`)
- UTF-8 encoding declaration

**CLI flag:** `--format=xml` or `--xml` (shortcut alias)

#### HTML table output

Produces a self-contained HTML document with a styled `<table>`. Open directly in a browser, embed in emails, or serve from a web server.

```bash
mdquery "select title, status where status = 'todo'" --format=html > report.html
```

Output:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>mdquery results</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 2rem; color: #1a1a1a; }
    h2 { font-size: 1.1rem; color: #555; margin-bottom: 0.5rem; }
    p.meta { color: #888; font-size: 0.9rem; margin-bottom: 1rem; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    tr:nth-child(even) { background: #f8f9fa; }
    th { background: #343a40; color: #fff; font-weight: 600; }
    td { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.9rem; }
    tr:hover { background: #e9ecef; }
  </style>
</head>
<body>
  <h2>Query results</h2>
  <p class="meta">select title, status where status = "todo" &mdash; 3 rows</p>
  <table>
    <thead>
      <tr><th>title</th><th>status</th></tr>
    </thead>
    <tbody>
      <tr><td>Auth Skills</td><td>todo</td></tr>
      <tr><td>DB Skills</td><td>todo</td></tr>
      <tr><td>API Skills</td><td>todo</td></tr>
    </tbody>
  </table>
</body>
</html>
```

**Implementation:**
- New method `toHtml()` in `src/formatter.ts`
- Full HTML5 document with `<meta charset>`, `<title>`, embedded `<style>`
- Query text + row count in `<p class="meta">`
- `<thead>` / `<tbody>` for semantic table markup
- Alternating row colors, hover highlight, monospace font for values
- HTML-escape all values (`&` → `&amp;`, `<` → `&lt;`, etc.)
- Style is intentionally minimal — easy to override with custom CSS

**CLI flag:** `--format=html` or `--html` (shortcut alias)

#### Formatter integration

Current OutputFormat enum (types.ts):
```typescript
export type OutputFormat = 'json' | 'table' | 'csv';
```

Updated:
```typescript
export type OutputFormat = 'json' | 'table' | 'csv' | 'markdown' | 'xml' | 'html';
```

**CLI flags:**
- `--format=markdown` / `--format=xml` / `--format=html` — canonical form
- `--md` / `--xml` / `--html` — shortcut aliases (last-wins on conflict)
- `--json` / `--csv` / `--table` — existing shortcuts unchanged

**Acceptance criteria:** All three new formats produce valid output. Markdown is GFM-compatible. XML is well-formed with proper escaping. HTML opens correctly in browsers. `--md`, `--xml`, `--html` shortcut flags work. JSON/CSV/table output unchanged. Tests for all three formatters. All 579 existing tests still pass.

---

### v0.2.5 — Scatter/gather parallel execution

**Standalone release.** No dependencies on other v0.2.x versions.

Parallelize multi-directory queries across CPU cores.

**Current behavior:** `readFilesWithHooks` iterates directories sequentially (executor.ts:128-203).

**New behavior:** When multiple directories are provided, read and evaluate each directory in parallel, then merge results.

```
Query: select * where status = "todo"
Dirs: [~/.agents/skills, ~/opt/skills, ~/opt/my-skills]

Phase 1 (scatter):
  Worker 1 → read + evaluate ~/.agents/skills (1000 files)
  Worker 2 → read + evaluate ~/opt/skills (2800 files)
  Worker 3 → read + evaluate ~/opt/my-skills (60 files)

Phase 2 (gather):
  Merge results → apply global ORDER BY / LIMIT / DISTINCT
```

**Implementation approach:** Node.js `worker_threads` (no external deps).

- New module: `src/parallel-executor.ts` — `scatterGather()`
- Each worker reads + evaluates one directory (WHERE filtering, field projection)
- Workers return partial result arrays
- Main thread merges results, applies global ORDER BY / LIMIT / DISTINCT / GROUP BY
- Fallback: if only 1 directory or `readOptions.parallel === false`, use sequential path

**Parallelism rules:**
- WHERE filtering: parallel (embarrassingly parallel per-directory)
- GROUP BY: parallel per-directory, then merge groups
- ORDER BY: sequential (must sort merged results)
- LIMIT/OFFSET: sequential (applied after merge)
- JOIN: sequential (requires full left dataset)

**CLI:**
- `mdquery --parallel "select ..."` — enable parallel execution (default: auto-detect)
- `mdquery --no-parallel "select ..."` — force sequential

**Library:**
```typescript
const executor = new Executor(['~/.agents/skills', '~/opt/skills'], undefined, undefined, { parallel: true });
```

**Performance target:** For 3 directories with 1000 files each: 2–3x speedup over sequential on 4-core machine.

**Acceptance criteria:** Multi-dir queries execute in parallel. Results are identical to sequential execution. Single-dir queries are unaffected. Tests verify parallel vs sequential produce same results. Benchmark shows speedup.

---

### v0.2.6 — Markdown viewer: terminal rendering

**Standalone release.** No dependencies on other v0.2.x versions. Enables v0.2.9 (pager).

Render markdown with ANSI styling for terminal display. This module is used by the pager (v0.2.9), the TUI file preview (Phase 6), and any future `--render` flag.

#### What it renders

| Markdown element | ANSI rendering |
|-----------------|----------------|
| `# Heading 1` | Bold, bright white, full terminal width underline |
| `## Heading 2` | Bold, bright white |
| `###–######` | Bold, progressively dimmer |
| `**bold**` | Bold |
| `*italic*` | Italic |
| `` `code` `` | Dim background, bright foreground (inline code) |
| Code blocks | Fenced block with language label, syntax-colored if language recognized |
| `- item` / `* item` | Bullet with `•` prefix |
| `1. item` | Numbered prefix |
| `[text](url)` | Underlined text, URL dimmed in parentheses |
| `> blockquote` | Italic, left border `│` in accent color |
| `---` | Horizontal rule: `──────────────` |
| `![alt](src)` | `[image: alt]` placeholder (no image rendering in terminal) |
| Tables | Rendered as aligned text table with header separator |

#### Implementation

- New module: `src/markdown-viewer.ts`
- Entry point: `renderMarkdown(raw: string, options?: MarkdownViewerOptions): string`
- Uses existing `mdast` AST from `src/content-extractor.ts` (already parses markdown body)
- Walks AST nodes, applies ANSI escape codes via existing `sgr()` from `src/colors.ts`
- Line numbers: optional, prepended as dim `4:` style prefix

**Options:**
```typescript
interface MarkdownViewerOptions {
  lineNumbers?: boolean;      // show line numbers (default: false)
  width?: number;             // terminal width for wrapping (default: process.stdout.columns)
  colors?: boolean;           // enable ANSI colors (default: true)
  wrap?: boolean;             // wrap long lines (default: true)
}
```

**CLI flag:** `--render` or `--cat` — render a single file's markdown body with syntax highlighting (like `bat` for markdown specifically)
```bash
mdquery --render skills/auth.md           # render with syntax highlighting
mdquery --render --line-numbers skills/auth.md  # with line numbers
```

**Library usage:**
```typescript
import { renderMarkdown } from '@den-tanui/mdquery';
const rendered = renderMarkdown(fileContent, { lineNumbers: true });
console.log(rendered);
```

**Acceptance criteria:** All markdown elements render with correct ANSI styling. Line numbers display correctly. Long lines wrap at terminal width. Colors respect `--no-color` flag. TTY detection: no ANSI codes when piped. Tests for all element types. All 579 existing tests still pass.

---

### v0.2.7 — Event sourcing for mutations

**Depends on:** v0.2.3 (WAL).

Extend the WAL from v0.2.3 into a full event log for audit, undo, and replay.

**Event log format:**

```
.mdquery/
  events/
    2026-08-17.jsonl               # one event per line, append-only
```

Event entry:
```json
{
  "id": "evt_abc123",
  "timestamp": "2026-08-17T20:00:00Z",
  "operation": "update",
  "query": "update set status = 'done' where status = 'todo'",
  "files": [
    {"path": "skills/auth.md", "field": "status", "old": "todo", "new": "done"}
  ],
  "user": "alice"
}
```

**Operations tracked:** create, update, delete (all three executor write paths).

**New commands:**
- `mdquery log` — show recent events (last 20, `--limit N` for more)
- `mdquery log --since 2026-08-01` — filter by date
- `mdquery undo` — revert the last event (reads `old` values, writes them back)
- `mdquery undo --last N` — revert last N events

**Implementation:**
- New module: `src/event-log.ts` — `EventLogWriter`, `EventEntry`, `readEvents()`, `undoLast()`
- `executeUpdate`/`executeDelete`/`executeCreate` append to event log after WAL commit
- `event.user` from `Builtins.user()` (process.env.USER)
- CLI commands in `src/cli.ts`
- Event log is append-only — never modified, only appended

**Acceptance criteria:** Every mutation creates an event log entry. `mdquery log` shows events. `mdquery undo` reverts last mutation. Event log is append-only. Tests for log + undo.

---

### v0.2.8 — Materialized query cache

**Depends on:** v0.2.3 (queryHash).

Cache query results keyed by query hash + file mtimes. Re-run only when source files change.

**Cache storage:**

```
.mdquery/
  cache/
    <query-sha256>.json     # cached result + metadata
```

Cache entry:
```json
{
  "queryHash": "abc123...",
  "query": "select title, status where status = 'todo'",
  "result": {"type": "select", "data": [...], "count": 47},
  "meta": {...},
  "fileMtimes": {
    "skills/auth.md": "2026-08-17T20:00:00Z",
    "skills/db.md": "2026-08-17T19:30:00Z"
  },
  "createdAt": "2026-08-17T20:01:00Z"
}
```

**Cache invalidation:**
1. Compute query hash (same as v0.2.3 `queryHash`)
2. Load cached entry if it exists
3. Compare `fileMtimes` against current file stat mtimes
4. If any mtime changed → cache miss → re-execute → update cache
5. If all mtimes match → cache hit → return cached result

**CLI flags:**
- `mdquery --cache "select ..."` — enable caching for this query
- `mdquery --no-cache "select ..."` — bypass cache (default)
- `mdquery cache clear` — clear all cached results

**Library usage:**
```typescript
const executor = new Executor(dir, undefined, undefined, { cache: true });
const result = await executor.execute('select title, status');
// result.meta.cacheHit === true on second call
```

**Implementation:**
- New module: `src/query-cache.ts` — `QueryCache`, `get()`, `set()`, `invalidate()`, `clear()`
- `Executor.execute()` checks cache before execution when `readOptions.cache === true`
- On cache hit, populate `meta.cacheHit = true` and `meta.timings.total = cache_read_time`
- Cache directory configurable via `config.yaml`: `cache: { enabled: true, dir: ".mdquery/cache" }`
- Maximum cache size: 100MB (evict LRU when exceeded)

**Acceptance criteria:** Cached query returns instantly on repeat. File change invalidates cache. `--no-cache` bypasses. `cache clear` removes all entries. Cache hit reflected in `meta.cacheHit`. Tests for cache hit/miss/invalidation.

---

### v0.2.9 — Alt-screen pager for interactive results

**Depends on:** v0.2.6 (markdown viewer for rendered markdown in pager).

Auto-pager for long query results when running in an interactive terminal. Pipes output through a terminal pager (like `less`) so users can scroll, search, and navigate large result sets.

#### Which formats get paged

| Format | Paged? | Why |
|--------|--------|-----|
| **table** | Yes | Wide, scroll-heavy, primary interactive format |
| **markdown** | Yes | Readable in terminal, rendered via v0.2.6 viewer |
| **json** | No | Users pipe `--json` to `jq`, files, other tools |
| **csv** | No | Almost always piped to `awk`/spreadsheets/databases |
| **html** | No | Redirected to `.html` files |
| **xml** | No | Redirected to `.xml` files |

#### Behavior

```
# Auto-pager when stdout is a TTY and rows > threshold
mdquery "select *" --dir ~/skills          # → alt-screen pager (500+ rows)
mdquery "select *" --dir ~/skills | wc -l  # → raw output (piped, no pager)
mdquery "select *" --json                  # → raw output (JSON never paginated)

# Manual override
mdquery "select *" --pager                # → force pager
mdquery "select *" --no-pager             # → force no pager
```

**TTY detection:** Check `process.stdout.isTTY` (same approach as `bat`, `git log`, `systemctl`). When piped, never activate pager automatically.

**Threshold:** Auto-pager activates when result rows exceed a configurable threshold (default: 50 rows). Below threshold, output prints directly.

#### Implementation

- New module: `src/pager.ts` — `PagerStream`, `shouldPage()`, `launchPager()`
- Detect TTY + format suitability + row count
- Pipe formatted output to `less -RX` (supports ANSI colors, exits cleanly)
- Alt-screen: `less -X` keeps pager content after exit; `less -R` handles ANSI escape codes
- Configurable pager program via `config.yaml` or `$PAGER` env var
- Fallback: if `less` not available, print directly

**Markdown in pager:** When paging markdown output, the v0.2.6 markdown viewer renders headings, code blocks, and links with ANSI styling before piping to `less`. This makes markdown output visually rich in the terminal.

**Config:**
```yaml
# config.yaml
pager:
  enabled: true          # default: true when TTY
  threshold: 50          # rows before pager activates
  program: "less -RX"    # default pager (override via $PAGER)
```

**CLI flags:**
- `--pager` — force pager on (even for small results, even when piped)
- `--no-pager` — force pager off (even for large results in TTY)

**Library usage:**
```typescript
const executor = new Executor(dir, undefined, undefined, { pager: true });
const result = await executor.execute('select *');
// If TTY + table/markdown format + rows > threshold → pager launches
```

**Acceptance criteria:** Large table results auto-page in TTY. Piped output never pages. JSON/CSV/HTML/XML never page. `--pager`/`--no-pager` override works. Markdown output renders with syntax highlighting in pager. Pager exits cleanly (alt-screen restore). Config overrides work. Tests for TTY detection, threshold, format filtering. All 579 existing tests still pass.

---

### v0.2.10 — User-defined functions

**Standalone release.** No dependencies on other v0.2.x versions.

Allow users to define custom functions for use in queries. Inline lambdas (`fn`) and named functions (`def`) work in any query. Reusable function libraries load from a directory.

#### Inline functions (always available)

```sql
-- Anonymous lambdas
select toc.map(fn(x) => '\t'.repeat(x.level - 1) + x.title).join('\n')

-- Named functions (defined once per query)
def repeat(s, n): s.repeat(n);
select toc.map(repeat('\t', level - 1) + title).join('\n')
```

**Syntax:**
- Anonymous: `fn(args) => expression`
- Named: `def name(args): body;`
- Multiple statements in `def` body separated by `;`
- Last expression is the return value
- JS standard library available: `String.repeat`, `Array.filter`, `Math.max`, etc.

#### Function directory (requires config)

```
~/.config/mdquery/functions/
├── repeat.js
├── toc-helpers.js
├── project.js
└── ...
```

Each file exports named functions:
```js
// ~/.config/mdquery/functions/repeat.js
export function repeat(s, n) { return s.repeat(n); }
export function indent(s, level) { return '\t'.repeat(level) + s; }
```

Query uses them directly:
```sql
select toc.map(indent(title, level - 1)).join('\n')
```

**Config option:**
```yaml
# ~/.config/mdquery/config.yaml
functions:
  enable: true   # default: false; controls directory loading only
```

| `functions.enable` | `fn()`/`def` in query | `~/.config/mdquery/functions/*.js` |
|---------------------|----------------------|-------------------------------------|
| `false` (default) | ✅ Always available | ❌ Not loaded |
| `true` | ✅ Always available | ✅ Auto-imported at startup |

**Features:**
- Anonymous functions: `fn(x) => expression` for inline use
- Named functions: `def name(args): body;` for reuse
- Function directory: `~/.config/mdquery/functions/*.js` for persistence
- JS standard library available: `String.repeat`, `Array.filter`, etc.
- Builtin override: user functions shadow builtins (same name wins)
- Security: local CLI only, no sandboxing needed

**Implementation:**
- New module: `src/user-functions.ts` — `loadFunctionDir()`, `parseDef()`, `evalFn()`
- Anonymous functions: parse `fn(args) => expression`, compile via `new Function()`
- Named functions: parse `def name(args): body;`, compile via `new Function()`
- Function directory: scan `~/.config/mdquery/functions/*.js`, import each via dynamic `import()`
- Query execution: register user functions in `Builtins` before evaluating expressions
- Config check: only load directory when `functions.enable === true`
- Inline functions always work regardless of config

**Acceptance criteria:** `fn(x) => x.length` works inline. `def add(a, b): a + b;` works in queries. Function directory loads when enabled. Function directory not loaded when disabled. User functions shadow builtins. Tests for anonymous, named, directory, config, shadowing. All 579 existing tests still pass.

---

## Phase 6: mdquery-tui (interactive REPL)

**Full specification:** [MDQUERY-TUI.md](./MDQUERY-TUI.md)

A "lazygit for markdown" — interactive TUI for querying markdown directories. Built with [OpenTUI](https://opentui.com) (React reconciler).

### Features

- **File-centric sidebar** — browse, select, delete individual .md files across multiple dirs
- **Query editor** — mdquery syntax, history, autocomplete
- **Results table** — auto-width columns, fuzzy filter, vim navigation
- **File preview** — toggleable markdown viewer with syntax highlighting
- **Query history** — persisted per directory
- **4 themes** — Rose Pine, Tokyo Night, Nord, Gruvbox
- **CLI mode** — non-interactive query flag for scripting
- **Config** — extends existing `config.yaml` with `tui:` section

### Quick start

```bash
# Open TUI with specific directories
mdquery --dir ~/.agents/skills, ~/opt/skills

# Open TUI with current directory
mdquery --dir .

# Open TUI with saved config
mdquery --tui
```

**Acceptance criteria:** See [MDQUERY-TUI.md](./MDQUERY-TUI.md#acceptance-criteria).

---

## Phase 7: mdquery-index (persistent cache with LSM-tree-inspired index)

Persistent index for frontmatter + section trees + file stats. Queries read the index instead of re-parsing every file. Builds on v0.2.5 (materialized query cache) and v0.2.6 (scatter/gather).

**Goal:** 50–100x speedup for frontmatter-only queries on large skill directories (3000+ files).

### Index storage

```
.mdquery/
  index/
    segments/
      000000.jsonl              # sorted segment (immutable after flush)
      000001.jsonl
      ...
    manifest.json              # pointer to active + sealed segments
    metadata.json              # directory configs, index version, creation time
```

### LSM-tree architecture

The index uses an LSM-tree (Log-Structured Merge-tree) design inspired by LevelDB/RocksDB:

**Write path (indexing):**
1. New entries are appended to the active (mutable) segment in memory
2. When the active segment exceeds a size threshold (e.g., 10,000 entries), it is flushed to disk as a new sorted immutable segment
3. Segments are sorted by file path for fast lookups
4. Background compaction merges small segments into larger ones

**Read path (querying):**
1. Check in-memory active segment first
2. Search sealed segments from newest to oldest (newer data wins)
3. Return first match per file path (latest version)
4. Optional Bloom filter per segment to skip segments that definitely don't contain a matching field

**Segment format:**
```jsonl
{"path":"skills/auth.md","mtime":"2026-08-17T20:00:00Z","data":{"title":"Auth Skills","status":"todo","tags":["auth","security"]}}
{"path":"skills/db.md","mtime":"2026-08-17T19:30:00Z","data":{"title":"DB Skills","status":"done","tags":["postgres"]}}
```

**Manifest:**
```json
{
  "version": 1,
  "directoryConfigs": {
    "~/.agents/skills": { "depth": 3, "ignore": ["node_modules"] },
    "~/opt/skills": { "depth": 2, "ignore": [".git"] }
  },
  "segments": [
    {"id": "000004", "path": "segments/000004.jsonl", "entryCount": 10000, "minPath": "a", "maxPath": "z", "createdAt": "2026-08-17T20:00:00Z"},
    {"id": "000003", "path": "segments/000003.jsonl", "entryCount": 8500, "minPath": "a", "maxPath": "z", "createdAt": "2026-08-17T19:55:00Z"}
  ],
  "activeSegment": {
    "entries": 2300,
    "minPath": "auth",
    "maxPath": "web"
  },
  "bloomFilters": true,
  "lastCompaction": "2026-08-17T19:00:00Z"
}
```

### Invalidation

- **mtime-based:** On re-index, stat each file. If mtime matches existing entry → skip. Only re-parse changed files.
- **Partial re-index:** `mdquery index --update` only processes files with changed mtimes (default). `mdquery index --rebuild` drops and rebuilds the full index.
- **Automatic:** `Executor` can auto-index on first query if no index exists (configurable).

### CLI commands

```bash
mdquery index <dirs>           # Build index for directories
mdquery index --update         # Incremental update (only changed files)
mdquery index --rebuild        # Full rebuild
mdquery index --status         # Show index stats (segment count, entry count, size)
mdquery index --compact        # Force compaction
```

### Query-time integration

When an index exists, `Executor` uses it instead of reading files:

1. Extract query-relevant fields from the AST (what fields does the WHERE clause reference?)
2. Look up those fields in the index (column-oriented field lookup)
3. Apply WHERE filtering against index entries
4. For fields not in the index (e.g., `content`, `sections()`), fall back to file read
5. Merge indexed results with file-read results

**Column-oriented field indexes:**

In addition to the full entry segment, maintain per-field sorted indexes for common query fields:

```
.mdquery/
  index/
    fields/
      status.idx        # { field: "status", values: { "todo": ["a.md", "b.md"], "done": ["c.md"] } }
      tags.idx          # { field: "tags", values: { "auth": ["a.md"], "db": ["c.md"] } }
      priority.idx
```

These act like database indexes — `where status = "todo"` does a direct lookup in `status.idx` instead of scanning all entries.

### Performance characteristics

| Metric | Without index | With index |
|--------|--------------|-----------|
| Frontmatter scan (3000 files) | ~500ms | ~5ms (100x) |
| WHERE filter on 1 field | ~500ms | ~2ms (index lookup) |
| Full-text content search | ~500ms | ~500ms (still reads files) |
| Incremental update (10 changed files) | N/A | ~50ms |
| Index size (3000 files) | N/A | ~2MB |

**Acceptance criteria:** `mdquery index` builds index. Queries use index when available. Incremental update only re-parses changed files. Bloom filter skips non-matching segments. Column-oriented index accelerates field lookups. All 579 existing tests still pass. Benchmark shows 50x+ speedup for frontmatter-only queries.

---

## Summary

| Phase | Focus | Depends on | Release |
|-------|-------|-----------|---------|
| Pre v0.2.3 | Metrics, observability, WAL, atomic batches | — | v0.2.3 |
| Pre v0.2.4 | Output formats: markdown, XML, HTML table | — | v0.2.4 |
| Pre v0.2.5 | Scatter/gather parallel execution | — | v0.2.5 |
| Pre v0.2.6 | Markdown viewer (terminal rendering) | — | v0.2.6 |
| Pre v0.2.7 | Event sourcing, undo, audit log | v0.2.3 | v0.2.7 |
| Pre v0.2.8 | Materialized query cache | v0.2.3 | v0.2.8 |
| Pre v0.2.9 | Alt-screen pager (table + markdown) | v0.2.6 | v0.2.9 |
| Pre v0.2.10 | User-defined functions (fn/def + directory) | — | v0.2.10 |
| 1 | Performance benchmarks | — | v1.0 |
| 2 | Correctness edge cases | — | v1.0 |
| 3 | Doc site (VitePress) | — | v1.0 |
| 4 | Library API polish | 3 | v1.0 |
| 5 | Publishing | 3, 4 | v1.0 |
| 6 | mdquery-tui | — | v0.3+ |
| 7 | mdquery-index (LSM-tree) | v0.2.8, v0.2.5 | v0.3+ |

**Parallel execution:** Phases 1–7 and v0.2.3–v0.2.6, v0.2.10 can all run in parallel. v0.2.7 depends on v0.2.3, v0.2.8 depends on v0.2.3, v0.2.9 depends on v0.2.6. Max dependency depth: 1. Phase 4 needs Phase 3. Phase 5 is the final gate for v1.0.
