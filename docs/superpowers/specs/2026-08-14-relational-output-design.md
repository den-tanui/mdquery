# Relational Output Model + sections()/section() Redesign + Error Handling Design

Date: 2026-08-14
Status: Approved (design decisions), spec written for implementation planning

## Overview

mdquery currently returns whatever natural types its builtins produce (arrays of maps, arrays of strings, single maps, scalars) and formats them naively (JSON dumps `result.data`, CSV only quotes commas, a `card` format exists). This design:

1. Redesigns `sections()` / `section("name")` to return full `SectionData` objects with correct (non-duplicated) content.
2. Establishes a **relational output model**: queries select scalar columns; arrays-of-scalars flatten; arrays-of-maps / single maps are JSON-only; table/CSV insist on scalars and throw early.
3. Adds **execution-scoped error handling**: problematic files are skipped and logged in `meta` instead of crashing the whole query.
4. Reworks **output formats**: JSON = full `QueryResult` object with `meta`; CSV = proper RFC 4180 via `csv-stringify/sync`; TABLE = presentation only; CARD = removed.
5. Folds in the 8 CHANGES.md bug fixes (filter/map/sort eager-arg eval, regex value eval, grep 2-arg crash, section content duplication, section("name") ignoring args, docs `section.TODO`, malformed frontmatter crash, mtime missing).

## Architecture

```
CLI → Lexer → Parser → AST → Query Analyzer → Executor → Files → Formatter → Output
                              ↓                    ↓
                    scalar return-type      ExecutionState
                    inference (early        (errors, timings,
                    throw for table/csv)    filesSearched, filesMatched)
```

### Components

| Component | Responsibility |
|-----------|----------------|
| **QueryAnalyzer** | Static scalar return-type inference per expression (field/function_call/method_call/array_index/map_index) |
| **Executor** | Thread `ExecutionState` through `executeAST`/`executeSelect`/`readFilesWithHooks`; per-file try/catch in evaluate phase; skip + record errors |
| **FileOps / FastFileOps** | Read-phase error capture via `onError` callback on `ReadOptions`; fast path gains try/catch |
| **Formatter** | JSON = full QueryResult; CSV = csv-stringify/sync; TABLE = presentation only; CARD removed |
| **Builtins** | `fields()` → single map object; `trimAll()` new; `section()`/`sections()` redesign |

## 1. sections() / section() Redesign

### Behavior

- `sections()` → array of full `SectionData` objects: `{title, level, position, hierarchy, content}`.
- `section("name")` → FIRST exact-match section as a full `SectionData`, or `null` if no match.
- `section()` with no args → FIRST section as a full `SectionData`, or `null` if the file has no sections (consistent with "first match" semantics).
- Pattern matching is done by composition: `sections().filter(title starts_with 'Set')` (requires the filter/map/sort bug fix, §6.1).
- `has section("name")` / `has_section("name")` unchanged.
- `[n]` indexing is universal (0-based, negative supported); non-array index throws.
- `.first()` / `.last()` / `.map()` / `.count()` etc. work on the returned array.

### Content correctness (fixes bug #4 duplication)

`SectionData.content` is sliced from the raw body between the heading's end position and the next heading's start position (or end of body). This replaces `extractSectionContent`'s visitor walk, which currently duplicates each line twice (parent `extractText` + child text nodes). Verified slicing gives `"Do it now."`, `"Other stuff."`, `"End."` for the fixture.

### Latent bug acknowledged

`extractSectionHierarchy` parent-walk returns `[]` for content under headings (headings are siblings of content in mdast). This affects links/images/codeblocks inside sections. Not fixed in this plan (documented; future work).

## 2. Relational Output Model (Scalar Enforcement)

### Contract

- Functions return their natural types (arrays/maps/scalars) — **never change what functions return**.
- Queries select **scalar columns** (SQL philosophy): string / number / boolean / null.
- Arrays of scalars (e.g. `tags`) are OK everywhere; table/CSV flatten to `"a,b"` (comma-joined); JSON keeps them as arrays (natural types).
- Arrays of maps (`codeblocks()`) and single maps (`section('TODO')`) are **JSON-only**. Table/CSV **insist on scalar** and throw an error **as early as possible** — static AST analysis before any file reads.

### Scalar return-type inference (QueryAnalyzer)

Per expression node, infer the return type:

| Expression | Inferred type |
|------------|---------------|
| `field` | scalar (frontmatter value) |
| `function_call` | per-builtin table (below) |
| `method_call` | per-method table (below) |
| `array_index` | element type of the indexed array |
| `map_index` | value type of the map property |

Builtin return types (with shapes for error messages):

| Builtin | Type | Shape (for suggestions) |
|---------|------|-------------------------|
| `content()` | string (scalar) | — |
| `fields()` | map (JSON-only) | `{field: value}` |
| `links()` | array of maps (JSON-only) | `{text, url, position, paragraph?, section?}` |
| `images()` | array of maps (JSON-only) | `{alt, url, position, paragraph?, section?}` |
| `codeblocks()` | array of maps (JSON-only) | `{content, lang?, position, paragraph?, section?}` |
| `section()` | map (JSON-only) | `{title, level, position, hierarchy, content}` |
| `sections()` | array of maps (JSON-only) | `{title, level, position, hierarchy, content}` |
| `toc()` | array of maps (JSON-only) | `{level, title}` |
| `has_section()` | boolean (scalar) | — |
| `now()`, `upper()`, `next_date()`, ... | scalar | — |

Array methods: `filter`/`where`/`map`/`sort`/`first`/`last`/`slice`/`flatten`/`unique`/`count` + `[n]` — `first`/`last`/`[n]`/`count` produce scalars or maps depending on element type; `map` produces an array of the mapped expression's type.

Object methods: `keys`/`values`/`entries`/`length` — `keys`/`values` produce arrays of scalars (flattenable); `length` scalar.

String methods: `length`/`toLowerCase`/`toUpperCase`/`trim`/`startsWith`/`endsWith`/`includes`/`slice` — all scalar.

### Flattening tools (escape hatch)

`.map().join()`, `.count()`, `.first()`, `[n]`, `.property` — these let users reduce non-scalar values to scalars for table/CSV output. `.join()` on arrays needs to be added (currently missing from `evaluateArrayMethod`).

### Enforcement point

- Table/CSV: after parsing, before file reads, walk the SELECT expressions with the inference table. If any expression's inferred type is `array-of-maps` or `map`, throw a clear error naming the expression and suggesting a flattening tool.
- JSON: no enforcement (natural types allowed).

### Helpful error messages

Scalar enforcement errors must be actionable — they name the offending expression, state what it returns (type + shape), and suggest concrete rewrites using flattening tools. The shape column above feeds the suggestion.

Message format:

```
Scalar value error: `sections()` returns an array of maps in the shape
{title, level, position, hierarchy, content}. Table/CSV output requires scalar
columns. Consider rewriting the query, e.g. `sections().map('title')`,
`sections().first().title`, or `sections().count()`.
```

Per-shape suggestions:

| Expression | Suggested rewrites |
|------------|--------------------|
| `sections()` | `sections().map('title')`, `sections().first().title`, `sections().count()` |
| `section("name")` | `section("name").title`, `section("name").content` |
| `links()` | `links().map('url')`, `links().map('text')`, `links().count()` |
| `images()` | `images().map('url')`, `images().map('alt')` |
| `codeblocks()` | `codeblocks().map('lang')`, `codeblocks().map('content')` |
| `toc()` | `toc().map('title')`, `toc().map('level')` |
| `fields()` | `fields().keys()`, `fields().values()` |

The suggestion must use the **actual shape keys** of the builtin (from the table above), never a generic message. If the expression is nested (e.g. `sections().first()`), the message names the full expression and suggests the shortest scalar-producing rewrite.

## 3. Error Handling + meta

### ExecutionState (execution-scoped collector, NOT an instance field)

```typescript
interface ExecutionState {
  errors: FileError[];        // {path, error, phase: 'read'|'prefilter'|'evaluate'}
  timings: { list, read, prefilter, evaluate, total };
  filesSearched: number;
  filesMatched: number;
}
```

Created per `execute()` call, threaded through `executeAST` / `executeSelect` / `readFilesWithHooks`.

### Read phase

- `onError` callback on `ReadOptions`.
- Legacy `FileOps.read` already try/catch → null (silent skip) — wire it to record.
- Fast `FastFileOps.readFiles` currently has **no try/catch** → a single malformed file crashes the whole query (verified: gray-matter throws `YAMLException` on unterminated double-quoted scalar). Add per-file try/catch; skip + record.

### Evaluate phase

- Replace `.filter()` / `.map()` with loops in `executeSelect`; per-file try/catch; skip + record (option a: skipped files excluded from data).

### Helpful error context (all phases)

Every recorded error must be actionable, not just a raw exception:

- **Read/prefilter phase**: include the file `path`, the phase, and a human-readable reason (e.g. `malformed frontmatter: unexpected end of the stream within a double quoted scalar`). The underlying exception message is preserved, but prefixed with the file path so the user knows which file to fix.
- **Evaluate phase**: include the file `path`, the phase, and the failing expression (e.g. `evaluate error in <file>: expression `links().map('url')` failed: <reason>`).
- **Scalar enforcement** (table/CSV): the shape-aware message from §2 — not a file error, thrown before reads.

The `errors` array in `meta` is the machine-readable record; the CLI also prints a concise summary line per error (e.g. `warning: skipped 2 files (see meta.errors)`).

### QueryResult.meta

```typescript
interface QueryMeta {
  filesSearched: number;
  filesMatched: number;
  timings: { list, read, prefilter, evaluate, total };
  errors: { path, error, phase }[];
}
```

`QueryResult` gains `meta?: QueryMeta`. JSON output = full `QueryResult` object `{type, data, count, meta}`.

## 4. Output Formats

| Format | Role | Implementation |
|--------|------|----------------|
| **JSON** | Data format | Full `QueryResult` object `{type, data, count, meta}`; valid JSON; ISO date strings (Date → ISO via JSON.stringify) |
| **CSV** | Data format | `csv-stringify/sync` (NEW dependency); RFC 4180 quoting, newlines, quotes, `escape_formulas` |
| **TABLE** | Presentation only | Parses data internally; unchanged role |
| **CARD** | **REMOVED** | `toCard` (formatter.ts:100-194), `--card` (cli.ts:138), `'card'` in OutputFormat (cli.ts:169) all removed |

### CLI flags (Option C: both)

- `--format=<fmt>` remains the canonical flag: `json`, `table`, `csv` (default `json`).
- Shortcut flags are aliases: `--json` ≡ `--format=json`, `--csv` ≡ `--format=csv`, `--table` ≡ `--format=table`.
- If both `--format` and a shortcut flag are given, the **last one on the command line wins** (standard getopt behavior).
- `--card` is removed (no shortcut for a removed format).

`mdquery "query" --json > saved.json` and `--csv > saved.csv` must produce valid files.

`select *` → flat map (frontmatter + filename/path/abspath/filepath) — mostly scalar, fine in JSON.

## 5. Builtin Changes

- `fields()` → **single map object** `{field: value}` (was array of strings). Enables `fields().keys()` / `.values()`. `.map()` is an array method and does not apply to the map object.
- `trim()` confirmed: JS `String.trim()` — leading/trailing whitespace only; internal newlines/pipes kept.
- `trimAll()` **NEW builtin**: replaces presentation-breaking chars with SPACES: `\n \r \t \v \f \u2028 \u2029 \u0085 | \0 \x00-\x1f`.

## 6. Bug Fixes Folded In

### 6.1 filter/map/sort eager-arg eval (bug #1, executor.ts:681)

`evaluateMethodCall` evaluates ALL args eagerly → predicate becomes `false` before `evaluateArrayFilter`. Three sub-bugs:
- (a) raw-Expression passthrough needed for `filter`/`where`/`map`/`sort` (don't pre-evaluate the predicate/mapper args).
- (b) `map('url')` / `sort('line')` string args pre-evaluated then crash — pass raw expression.
- (c) bare fields in filter predicates don't resolve to the item — `evaluateArrayFilter` only binds `_`; `evaluateField` checks `variables[name]` then falls to file → add `_`-fallback.

### 6.2 regex value eval (bug #2, evaluateValue 'regex' case)

`new RegExp(expr.value)` where value is `/TODO/` (with slashes) matches literal `/TODO/` → grep always `[]`. Fix: strip `/…/flags`.

### 6.3 grep(content, /x/) 2-arg crash (bug #3, evaluateGrep:944)

`args[0]` passed as pattern → `pattern.flags.includes` throws. Fix: implicit content + 1-arg regex form.

### 6.4 section content duplication (bug #4) — see §1

### 6.5 section("name") ignores args (bug #5, evaluateSection:936)

Returns `extractSections()` unconditionally. Fix: filter by name (multi-arg), return first match or null.

### 6.6 section.TODO parse failure (bug #6) — NOT a code bug

Outdated syntax; parser correctly rejects. README.md lines 31/150/153 document the old form → docs fix only.

### 6.7 malformed frontmatter kills whole query (bug #7) — see §3 read phase

### 6.8 order by mtime silently no-ops (bug #8, evaluateField:826-872)

No `mtime`/`updatedAt`/`createdAt` handling. **Moved to a separate plan** (see §7) — not part of this implementation.

## 7. File Metadata — SEPARATE PLAN (not in this implementation)

A dedicated future plan with its own spec: **[2026-08-14-file-metadata-design.md](./2026-08-14-file-metadata-design.md)**. Summary:

- **`file()` builtin** returns a **single map object** — the metadata of the current file (the row being evaluated), like `fields()` / `section("name")` are per-row: `{abspath, mtime, atime, ctime, owner, group, size, mode, ...}`.
- Access via property only: `file().abspath`, `file().mtime`, `file().ctime`, `file().owner`, etc. **`file().mtime()` is NOT valid** — a map is not callable; data types are respected (property access via `.property`, never `()` on a map).
- **Define the type of each field**: `mtime`/`atime`/`ctime` → Date; `owner`/`group` → string; `size` → number; `mode` → string; `abspath` → string.
- **Transform when necessary**: Date fields are real Date objects in memory so `ORDER BY file().mtime`, `WHERE file().mtime > ...`, and comparisons work via the TypeSystem; they serialize to ISO strings in JSON output.
- **`updatedAt`/`createdAt` are NOT aliases** — they are explicit frontmatter fields (immutable via `update`), unrelated to file metadata. No aliasing.
- Existing flat identity fields (`filename`, `path`, `abspath`) remain row columns; `file()` is the metadata accessor.
- Fixes bug #8 (`order by mtime` silently no-ops → `order by file().mtime`).

This plan is tracked separately; the current spec does not include it.

## 8. Implementation Order

Dependency-ordered steps (each independently testable):

1. **Error handling** — ExecutionState threading, read-phase onError, fast-path try/catch, evaluate-phase loops + per-file try/catch. Foundation.
2. **Output formats** — JSON full QueryResult with meta (depends on 1); CSV via csv-stringify/sync; CARD removal. All formatter.ts changes.
3. **Flattening tools + builtins** — `.join()` on arrays; `fields()` → map object; `trimAll()` new. Independent.
4. **filter/map/sort bug fixes** — §6.1 (a)(b)(c). Independent.
5. **Section content dedup** — §1 content slicing. Independent.
6. **sections()/section() redesign** — §1 API change (depends on 5 for correct content).
7. **Scalar enforcement** — §2 inference + early throw (depends on 3 for escape hatch, 1 for executeSelect refactor).
8. **README docs fix** — §6.6 (`section.TODO` → `section("name")`). Independent.

> File metadata (bug #8) is a **separate plan** (§7) — not in this order.

## 9. Testing

- TDD regression tests per bug (tests in `tests/content-extractor.test.ts`, `tests/file-io.test.ts`, `tests/parser-rewrite.test.ts`).
- New tests: scalar enforcement throws for table/CSV with map/array-of-maps; **scalar enforcement error message names the expression, its shape, and a concrete rewrite suggestion** (e.g. `sections()` → suggests `sections().map('title')`); JSON includes meta; CSV RFC 4180 quoting (newlines, quotes, formula escape); malformed frontmatter file skipped + recorded in meta with path and reason; `section("name")` returns first match or null; `sections()` content non-duplicated; shortcut flags `--json`/`--csv`/`--table` behave as `--format=` aliases with last-wins conflict rule.
- Validation: `bun run test` (currently 418/418 across 25 files) + `bun run build:lib` + `bun run build:cli`.

## 10. Backward Compatibility

- Existing queries must work unchanged where they select scalars.
- `fields()` return shape changes (array → map) — documented breaking change, intentional.
- CARD format removed — documented breaking change, intentional.
- JSON output shape changes (adds `meta`) — additive.
- `section.TODO` syntax was never supported by the current parser — docs-only fix.

## Out of Scope

- `extractSectionHierarchy` parent-walk bug for content under headings (links/images/codeblocks inside sections) — documented, future work.
- JOIN / aggregate / scalar-subquery SQL features — referenced as philosophy, not implemented.