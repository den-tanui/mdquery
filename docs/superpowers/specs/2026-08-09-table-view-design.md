# Table View Improvement — Design

Date: 2026-08-09
Status: Approved for implementation
Scope: `src/formatter.ts` + `tests/formatter.test.ts`

## Context

The `table` output today (`Formatter.toTable`, `src/formatter.ts:23`) renders header / separator / data lines joined by `" | "`. Two defects:

1. **Columns are squashed regardless of terminal width.** Pre-shrink widths (`rawWidths`) are each column's natural content length, and `shrink()` distributes the budget *proportionally to that length*. A single outsized cell (`content` holds the whole markdown body; `abspath` holds absolute paths) monopolizes the budget and starves every other column down to the 3-character minimum. Verified: `mdquery --format=table "select *` renders `id | ti… | th… | … | cont…` with a giant `content` column.
2. **Multi-line and noise columns.** A bare `select` projects every `FileData` field including `content` (multi-line body) and `filepath`. `pad()` uses `String.length` including `\n`, so multi-line cells mangle the table.

## Decision: no new dependency

Two candidate libraries were evaluated.

### `cli-table3` (v0.6.5 — 1 dependency, `string-width`)
- Fixed-width columns (`colWidths`), word wrap, truncation, unicode borders, alignment.
- **Does not** auto-fit a terminal budget — you must compute and pass `colWidths` yourself.

### `table` (v6.9.0 — 5 dependencies including `ajv`, ~330 KiB unpacked)
- Per-column width, `truncate` with ellipsis, `wrapWord`, alignment, ANSI/fullwidth-aware widths.
- Also requires precomputed per-column widths; there is no "fit this data into N columns" mode.

### Why neither library fixes the reported bug

The reported defect is **width allocation** — one enormous column starving its neighbors. Both libraries expect the caller to supply final per-column widths, so the allocation algorithm stays in mdquery either way. The libraries' main value (multi-row word wrap, ANSI rendering) is not needed for the chosen product behavior:

- The product decision is **first line + ellipsis**: single-line cells, so word-wrap is out of scope.
- Markdown frontmatter/body contains no ANSI escape codes, so display width can stay ASCII/codepoint-based.

### Recommendation

**Hand-rolled, no new dependency** — consistent with the repo's lean two-dependency philosophy. The formatter remains self-contained behind the existing stable API (`Formatter.form`, `toTable(result, width?)`). If ANSI/fullwidth robustness ever becomes necessary, the width helper can be swapped for `string-width` (~8 KiB, zero parsing deps) in one place without a redesign.

Fallback if a maintained renderer is later preferred: **`cli-table3`** (single dependency) over `table` (adds `ajv`). Both still require the allocation algorithm below.

## Goals

1. Every table fits the given terminal width (same guarantee the current tests assert).
2. No single column starves its neighbors; every column keeps a readable floor.
3. Multi-line cell values render as the first line, ellipsized with `…` when it exceeds the column width.
4. Absent fields render as empty cells, aligning with ruki presence semantics.
5. JSON/CSV outputs unchanged.

## Non-goals

- Word-wrapping cells across multiple physical rows.
- Coloring / style, ANSI support.
- Changing the executor's data projection (formatter-only change).
- Changing JSON/CSV output.

## Design

### Cell rendering

Before width math, convert each cell value to a single display string:

- `undefined` / `null` (absent) → `''`
- array → `[a, b]` (bracketed, joined with `", "`), so lists are unambiguous vs commas inside text
- object (non-array) → `JSON.stringify` (single line)
- otherwise → `String(value)`

Then normalize to the first line (product decision: first line + ellipsis):

```ts
const firstLine = cellString.split('\n')[0];
```

Rendering pads/ellipsizes this first line to the assigned column width (existing `pad()` + `ellipsize()`).

### Width allocation

Phase A — compute natural widths:

```
displayWidth(s) = [...s].length          // codepoints; no ANSI in data
natural[i]      = max(displayWidth(header[i]), max over rows displayWidth(cell[i]))
```

Phase B — if `sum(natural) + separators <= usable`: use natural widths (no shrink).

Phase C — else shrink to a guaranteed fit:

```
separators = (n - 1) * 3                  // the " | " joins
usable     = width - separators

floors:    if sum(headerWidths) <= usable → floors = headerWidths
                                                            // headers kept readable
           else if 3 * n <= usable          → floors = MIN_COLUMN_WIDTH (3)
           else                             → floors = max(1, floor(usable / n))
                                                            // degenerate tiny-width fallback

remaining  = usable - sum(floors)

weights[i] = max(natural[i] - floors[i], 0) capped at ceil(remaining / n)
                                                             // no column can eat the whole budget
totalW      = sum(weights)
widths[i]   = floors[i] + (totalW ? floor(remaining * weights[i] / totalW) : 0)
```

Guarantees:

- `sum(widths) + separators <= width` always. The degenerate case where even 3-char floors overflow the budget (very narrow terminal or very many columns) falls back to `max(1, floor(usable / n))` floors, so the fit guarantee holds in every input.
- A single huge cell (`content`, `abspath`) is capped at `remaining / n` contribution, so it can no longer push peers below their floor.
- When every column is already small (weights all 0), floors alone give the widest readable layout.
- Remaining slack after rounding simply stays unused (trailing space — harmless).

### Terminal width detection

Keep `detectColumns()` (TTY → `COLUMNS` env → `tput cols`) and the optional `terminalWidth` argument on `toTable()` for deterministic unit tests. No changes.

## Example

For a 80-col terminal and `select filename, title, content` on files with long bodies:

```
filename  | title            | content
--------- | ---------------- | ---------------------------------
task-001  | Fix the login bug| This is the first line of the body
task-002  | Triage data loss | Derive from the first line with ellipsis…
```

`content` shows only its first line, bounded by its allocation; other columns keep their natural width.

## Testing

Extend `tests/formatter.test.ts`:

- Multi-line cell value → output contains only the first line, plus `…` when truncated.
- One outsized `content`-style column (e.g. 1,000 chars) alongside short columns → the short columns keep readable widths (regression guard for the squashing bug).
- Absent field → empty cell; array field renders `[a, b]`.
- Property-style loop: for random small column counts and long values, every output line ≤ `width`.
- Existing tests remain green (no change when data fits).

## Compatibility

- `Formatter.form` and `toTable(result, width?)` signatures unchanged.
- JSON / CSV behavior unchanged.
- Multi-line content inside table cells is now single-line (positive change; cell-level only).

## Deferred

- Word-wrap across rows.
- `| run(...)` / `| clipboard()` pipe rendering (separate CLI/pipe work).
- Data-side presence semantics are speced in the separate ruki-semantics design; this spec only defines how table cells render values.