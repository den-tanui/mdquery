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
- Arrays of scalars (e.g. `tags`) are OK everywhere; table/CSV flatten to `"a,b"`.
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

Builtin return types:

| Builtin | Type |
|---------|------|
| `content()` | string (scalar) |
| `fields()` | map (JSON-only) |
| `links()` / `images()` / `codeblocks()` | array of maps (JSON-only) |
| `section()` / `sections()` | map / array of maps (JSON-only) |
| `toc()` | array of maps (JSON-only) |
| `has_section()` | boolean (scalar) |
| `now()`, `upper()`, `next_date()`, ... | scalar |

Array methods: `filter`/`where`/`map`/`sort`/`first`/`last`/`slice`/`flatten`/`unique`/`count` + `[n]` — `first`/`last`/`[n]`/`count` produce scalars or maps depending on element type; `map` produces an array of the mapped expression's type.

Object methods: `keys`/`values`/`entries`/`length` — `keys`/`values` produce arrays of scalars (flattenable); `length` scalar.

String methods: `length`/`toLowerCase`/`toUpperCase`/`trim`/`startsWith`/`endsWith`/`includes`/`slice` — all scalar.

### Flattening tools (escape hatch)

`.map().join()`, `.count()`, `.first()`, `[n]`, `.property` — these let users reduce non-scalar values to scalars for table/CSV output. `.join()` on arrays needs to be added (currently missing from `evaluateArrayMethod`).

### Enforcement point

- Table/CSV: after parsing, before file reads, walk the SELECT expressions with the inference table. If any expression's inferred type is `array-of-maps` or `map`, throw a clear error naming the expression and suggesting a flattening tool.
- JSON: no enforcement (natural types allowed).

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

`mdquery "query" --json > saved.json` and `--csv > saved.csv` must produce valid files.

`select *` → flat map (frontmatter + filename/path/abspath/filepath) — mostly scalar, fine in JSON.

## 5. Builtin Changes

- `fields()` → **single map object** `{field: value}` (was array of strings). Enables `fields().keys()` / `.values()` / `.map('field')`.
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

No `mtime`/`updatedAt`/`createdAt` handling. Feature: add file metadata fields (see §7).

## 7. File Metadata Fields (bug #8 feature)

Add to each row's identity fields:
- `mtime` — file modification time (Date → ISO in JSON)
- `updatedAt` — alias for `mtime`
- `createdAt` — file creation time (best-effort; may be unavailable on some filesystems → null)

These are scalar (Date) and usable in `WHERE`/`ORDER BY`/`SELECT`.

## 8. Implementation Order

Dependency-ordered steps (each independently testable):

1. **Error handling** — ExecutionState threading, read-phase onError, fast-path try/catch, evaluate-phase loops + per-file try/catch. Foundation.
2. **Output formats** — JSON full QueryResult with meta (depends on 1); CSV via csv-stringify/sync; CARD removal. All formatter.ts changes.
3. **Flattening tools + builtins** — `.join()` on arrays; `fields()` → map object; `trimAll()` new. Independent.
4. **filter/map/sort bug fixes** — §6.1 (a)(b)(c). Independent.
5. **Section content dedup** — §1 content slicing. Independent.
6. **sections()/section() redesign** — §1 API change (depends on 5 for correct content).
7. **Scalar enforcement** — §2 inference + early throw (depends on 3 for escape hatch, 1 for executeSelect refactor).
8. **mtime + file metadata** — §7. Independent.
9. **README docs fix** — §6.6 (`section.TODO` → `section("name")`). Independent.

## 9. Testing

- TDD regression tests per bug (tests in `tests/content-extractor.test.ts`, `tests/file-io.test.ts`, `tests/parser-rewrite.test.ts`).
- New tests: scalar enforcement throws for table/CSV with map/array-of-maps; JSON includes meta; CSV RFC 4180 quoting (newlines, quotes, formula escape); malformed frontmatter file skipped + recorded in meta; `section("name")` returns first match or null; `sections()` content non-duplicated; `mtime`/`updatedAt`/`createdAt` present and sortable.
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