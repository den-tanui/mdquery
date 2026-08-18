# Architecture

How mdquery's query engine works internally. This document explains the *why* behind the design, not just the *what*.

## Overview

mdquery is a query engine over markdown files. A query string goes through a five-stage pipeline, and the result comes back as structured data.

```
Query string
    │
    ▼
┌─────────┐
│  Lexer  │  ← character-by-character tokenizer
└────┬────┘
     │ tokens
     ▼
┌─────────┐
│  Parser │  ← Pratt parser, operator precedence
└────┬────┘
     │ AST
     ▼
┌──────────────┐
│QueryAnalyzer │  ← static analysis: what fields/content are needed?
└────┬─────────┘
     │ analysis
     ▼
┌──────────┐
│ Executor │  ← reads files, evaluates AST, filters, sorts, mutates
└────┬─────┘
     │ QueryResult
     ▼
┌───────────┐
│ Formatter │  ← JSON / table / CSV
└───────────┘
```

Each stage is independent and testable in isolation. The Executor is the orchestrator — it calls the others in sequence.

---

## The query pipeline

### 1. Lexer (`src/lexer.ts`)

A hand-written, character-by-character tokenizer. No external dependencies.

The lexer handles: keywords (`SELECT`, `WHERE`, `ORDER BY`, `LIMIT`, `SET`, `UPDATE`, `CREATE`, `DELETE`, `JOIN`, `UNION`, `PIPE`), string literals (single-quoted with escape sequences), numbers, field names, operators (`=`, `!=`, `<`, `>`, `<=`, `>=`, `contains`, `starts_with`, `ends_with`, `matches`), parentheses, commas, wildcards (`*`), and pipe (`|`).

Design choice: a hand-written lexer (rather than a parser generator) keeps the dependency tree minimal and makes error messages precise — the lexer can point to the exact character that failed.

### 2. Parser (`src/parser.ts`)

A Pratt parser (top-down operator precedence). The binding-power table defines operator precedence without explicit grammar rules.

Key design decisions:
- **No explicit grammar file** — the binding-power table *is* the grammar, expressed as data.
- **Method chain support** — `tags.contains('x')` is parsed as a method call on a field node. The parser handles arbitrary nesting: `sections().first().title.links()[0].url`.
- **Paren-free function calls** — 0-arg functions like `h1`, `code`, `toc`, `outline`, `fields` can be called without parentheses. The parser treats a bare identifier that matches a known function name as a function call.
- **Pipe operator** — `... | top 5` or `... | clipboard` is parsed as a pipe node wrapping the preceding expression.

### 3. QueryAnalyzer (`src/query-analyzer.ts`)

A pure function (no I/O) that walks the AST and determines:
- **Which fields are referenced** — needed for frontmatter-only optimization.
- **Whether content is needed** — if the query references `body`, `sections()`, `toc()`, `codeblocks()`, `grep()`, etc., the body must be read.
- **Whether metadata is needed** — if the query references `file().mtime`, `file().size`, etc., stat data must be loaded.

This analysis drives the fast path: if only frontmatter fields are needed, the Executor skips body parsing entirely.

`buildContentPrefilterTree()` takes the AST and produces a tree of content-level predicates (like `body contains "TODO"`). This tree is passed to `FastFileOps.preFilterByContent()`, which uses `grepts` (a grep-like search engine) to filter files *before* reading them.

### 4. Executor (`src/executor.ts`)

The orchestrator. Reads files, evaluates the AST against each file's data, and produces a `QueryResult`.

Responsibilities:
- **File discovery** — delegates to `FileOps` (legacy) or `FastFileOps` (fast path).
- **Data population** — reads frontmatter, body, sections, identity fields, metadata.
- **Expression evaluation** — walks the AST, evaluates WHERE clauses, ORDER BY, LIMIT, OFFSET.
- **Mutations** — UPDATE, CREATE, DELETE with confirmation safety.
- **JOINs** — links queries across files using field matching.
- **Subqueries** — nested SELECT inside WHERE or FROM.
- **Triggers** — before/after hooks on mutations.
- **Piping** — top N, clipboard output.
- **Error resilience** — per-file try/catch, skip-and-record pattern.

#### Builtin resolution order

When the executor encounters a function call like `upper(title)` or `my_func(x)`, it resolves the function through a layered lookup:

1. **Executor handlers** — built-in case statements for `has`, `has_section`
2. **`onBuiltinCall` hook** (first chance) — your custom function, checked before standard builtins
3. **`Builtins` class** — static methods like `now()`, `upper()`, `len()`, `split()`, etc.
4. **`onBuiltinCall` hook** (fallback) — checked again inside `Builtins.call()` as a second chance
5. **Throws** `Unknown builtin` if nothing matched

This two-pass hook design means custom functions are checked early (step 2) for performance, but also get a fallback chance (step 4) inside `Builtins.call()`. You can also **override** standard builtins by returning a value for a name like `'upper'` at step 2 — it runs before the static method lookup.

### 5. Formatter (`src/formatter.ts`)

Takes a `QueryResult` and produces output:
- **JSON** — valid JSON, ISO date strings, full `QueryResult` object including `meta`.
- **Table** — box-drawing grid with display-width-aware columns (handles CJK, emoji).
- **CSV** — RFC 4180 compliant via `csv-stringify/sync`.

Table formatting is presentation-only: column widths are calculated from data, headers are case-formatted, and cells are trimmed/normalized based on `TableOptions`.

---

## File discovery: two paths

mdquery has two file discovery strategies, tradeable via `ReadOptions.fast`:

### Legacy path (`FileOps` in `src/files.ts`)

```
ReadFiles ──► readdir (recursive) ──► .gitignore filter ──► read each file ──► parse frontmatter ──► parse body/sections
```

Uses Node.js `readdir` with recursive descent and the `ignore` package for `.gitignore` support (layered per-directory). Reads every matching file fully before any filtering.

**Pros:** Full `.gitignore` support, always available, simpler to reason about.
**Cons:** Reads every file (even if 99% won't match the query), slow for large directories.

### Fast path (`FastFileOps` in `src/file-io.ts`)

```
ListFiles (fdir) ──► .gitignore filter ──► preFilterByContent (grepts) ──► readFiles (lazy, analysis-driven)
```

Uses `fdir` (a compiled C directory walker, 10-50x faster than `readdir`) for listing, and `grepts` (a compiled grep engine) for content prefiltering. Only reads files that pass the prefilter.

**Analysis-driven reading:** The `QueryAnalyzer` tells `FastFileOps` what's needed:
- Frontmatter only → skip body parsing entirely.
- Content needed → read body, parse sections.
- Metadata needed → load stat data.

**Pros:** Dramatically faster for large directories (3000+ files). The prefilter can skip thousands of files without reading them.
**Cons:** `.gitignore` support is a simplified approximation. Some edge cases may differ from the legacy path.

### When to use which

| Scenario | Recommended | Why |
|----------|-------------|-----|
| Small directories (<100 files) | Either | Difference is negligible |
| Large directories (1000+ files) | Fast | `fdir` + `grepts` prefilter is 10-50x faster |
| Complex `.gitignore` patterns | Legacy | More complete gitignore implementation |
| Need full file metadata | Fast with `metadata: true` | Only reads stat for matched files |
| Frontmatter-only queries | Fast | Skips body parsing entirely |

---

## Frontmatter and identity

Every markdown file in mdquery has two kinds of data:

### Identity fields (derived from the file system)

| Field | Source | Description |
|-------|--------|-------------|
| `filename` | `basename - '.md'` | e.g., `auth` from `tasks/auth.md` |
| `path` | relative to search dir | e.g., `auth.md` or `subdir/auth.md` |
| `abspath` | absolute path | Full filesystem path |
| `filepath` | same as `abspath` | Alias for compatibility |

These are **never read from frontmatter** — they're derived from the file's location on disk. This prevents confusion about where a file actually lives.

### Frontmatter fields (from YAML)

Everything between the `---` fences. `gray-matter` parses YAML, then `parseDates()` auto-converts ISO date strings to `Date` objects.

**Immutable fields:** `createdAt` and `updatedAt` are in `FileOps.IMMUTABLE_FIELDS` — they're never overwritten by UPDATE or CREATE. This prevents accidental time-travel.

**NON_FRONTMATTER_FIELDS:** The list `['id', 'filename', 'path', 'abspath', 'filepath']` ensures identity fields aren't written back into frontmatter during UPDATE/CREATE.

### Body and sections

- **`body`** — The markdown content after the frontmatter block. Available when the query references `body` or content functions.
- **`sections`** — A `Map<string, Section>` parsed from markdown headings. Available when the query references `section()`, `sections()`, `h1()`–`h6()`, or `toc()`.

---

## Content extraction

The markdown body is parsed into an AST using `remark-parse` (MDAST). The `ContentExtractor` (`src/content-extractor.ts`) walks this AST to extract structured data:

### What's available

| Query function | Extraction method | Returns |
|----------------|-------------------|---------|
| `section("name")` | Walk headings, collect content until next heading | String content of that section |
| `sections()` | Walk all headings | Array of `{title, level, content, hierarchy}` |
| `h1()`–`h6()` | Filter sections by level | Sections at that heading level |
| `toc()` | Walk headings | Table of contents entries |
| `links()` | Walk `link` nodes | Array of `{text, url, context}` |
| `images()` | Walk `image` nodes | Array of `{alt, url, context}` |
| `codeblocks()` | Walk `code` nodes | Array of `{lang, content, context}` |
| `grep(pattern)` | Text search on raw body | Array of `{line, text, captures, section}` |

### Section hierarchy

Each section tracks its hierarchy — the chain of parent headings. For example, under:

```markdown
# Backend
## Authentication
### OAuth
```

The `OAuth` section has hierarchy `['Backend', 'Authentication']`. This is built via `unist-util-visit-parents` during extraction.

---

## Type system

mdquery has a runtime type system (`src/type-system.ts`) that handles value comparison and coercion:

### Null semantics

`null` is less than any non-null value. This follows SQL convention: `ORDER BY` puts nulls first.

### Array operations

Arrays support set arithmetic:
- **Union** (`+`): `['a'] + ['b']` → `['a', 'b']`
- **Difference** (`-`): `['a', 'b'] - ['b']` → `['a']`

Arrays of scalars (like `tags`) flatten to comma-separated strings in table/CSV output.

### Date comparison

ISO date strings are auto-parsed to `Date` objects by `gray-matter`'s `parseDates()`. This means:
- `due_date < today()` works as expected
- `ORDER BY created_at` sorts chronologically
- Date functions (`daysSince`, `isBefore`, etc.) operate on real `Date` objects

### Explicit type hints in SET clauses

UPDATE and CREATE support type annotations:

```sql
update set priority = int(priority) + 1
create set due_date = date('2026-02-01'), tags = array('new')
```

The `int()`, `float()`, `bool()`, `str()`, `array()` builtins handle coercion.

---

## Error resilience

mdquery is designed to never crash on bad data. The guiding principle: **a query with 1000 files and 50 bad files should return results for the 950 good ones.**

### Three phases, three catch points

| Phase | What can fail | What happens |
|-------|--------------|--------------|
| **Read** | Malformed YAML frontmatter, missing files, permission errors | `gray-matter` throws `YAMLException` → file is skipped, error recorded in `meta.errors` |
| **Prefilter** | `grepts` pattern compilation failure | Falls back to reading all files (over-approximation is safe) |
| **Evaluate** | Expression evaluation (type mismatch, missing field, etc.) | File is skipped for that row, error recorded in `meta.errors` |

### The skip-and-record pattern

```typescript
// In the executor's SELECT loop:
for (const file of files) {
  try {
    const row = evaluateSelect(file, ast);
    if (row) results.push(row);
  } catch (error) {
    meta.errors.push({ path: file.path, error: error.message, phase: 'evaluate' });
    // Continue to next file — don't abort the query
  }
}
```

### onError callback

For real-time error handling, pass `onError` in `ReadOptions`:

```typescript
const executor = new Executor('./tasks', undefined, undefined, {
  onError: (error) => console.warn(`[${error.phase}] ${error.path}: ${error.error}`)
});
```

### What meta.errors looks like

```json
{
  "errors": [
    { "path": "broken.md", "error": "Unterminated double-quoted scalar", "phase": "read" },
    { "path": "bad-eval.md", "error": "Cannot convert 'high' to number", "phase": "evaluate" }
  ]
}
```

---

## Performance characteristics

### Scaling behavior

The query time is approximately:

```
Total = List + (Read × N_matched) + Prefilter + Evaluate × N_matched
```

Where:
- **List** is the time to discover files on disk. `fdir` is ~0.1ms per 1000 files; `readdir` is ~5ms per 1000 files.
- **Read** is per-file: frontmatter parse ~0.1ms, body parse ~1-5ms (depends on size). The fast path skips body parsing when not needed.
- **Prefilter** is `grepts` search: ~0.01ms per file for simple patterns.
- **Evaluate** is per-file: ~0.01-0.1ms depending on query complexity.

### Benchmarks (representative)

| Scenario | Legacy | Fast path | Speedup |
|----------|--------|-----------|---------|
| 100 files, frontmatter only | ~50ms | ~30ms | 1.7x |
| 3000 files, WHERE on body | ~2s | ~200ms | 10x |
| 3000 files, frontmatter only | ~500ms | ~100ms | 5x |
| 10000 files, simple query | ~5s | ~500ms | 10x |

### Memory

The legacy path loads all file data into memory upfront. The fast path loads lazily — files are read, evaluated, and can be garbage-collected as the executor iterates.

For very large result sets, the `LIMIT` clause is critical: it stops evaluation early, avoiding work on files that won't appear in the output.
