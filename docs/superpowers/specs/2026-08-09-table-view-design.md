# Table View Improvement — Design

Date: 2026-08-09
Status: Approved for implementation
Scope: `src/formatter.ts` + `src/cli.ts` + `tests/formatter.test.ts`

## Context

The `table` output today (`Formatter.toTable`, `src/formatter.ts:23`) renders header / separator / data lines joined by `" | "`. Two defects:

1. **Columns are squashed regardless of terminal width.** Pre-shrink widths (`rawWidths`) are each column's natural content length, and `shrink()` distributes the budget *proportionally to that length*. A single outsized cell (`content` holds the whole markdown body; `abspath` holds absolute paths) monopolizes the budget and starves every other column down to the 3-character minimum. Verified: `mdquery --format=table "select *"` renders `id | ti… | th… | … | cont…` with a giant `content` column.
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

**Hand-rolled, no new dependency** — consistent with the repo's lean two-dependency philosophy. The formatter remains self-contained behind the existing stable API (`Formatter.format`, `toTable(result, width?)`). If ANSI/fullwidth robustness ever becomes necessary, the width helper can be swapped for `string-width` (~8 KiB, zero parsing deps) in one place without a redesign.

Fallback if a maintained renderer is later preferred: **`cli-table3`** (single dependency) over `table` (adds `ajv`). Both still require the allocation algorithm below.

## Goals

1. Every table fits the given terminal width (same guarantee the current tests assert).
2. No single column starves its neighbors; every column keeps a readable floor.
3. Multi-line cell values render as the first line, ellipsized with `…` when it exceeds the column width.
4. Absent fields render as empty cells, aligning with mdquery presence semantics.
5. JSON/CSV outputs unchanged.
6. New `--card` flag for expanded view with full content display.

## Non-goals

- Word-wrapping cells across multiple physical rows (compact mode).
- Coloring / style, ANSI support.
- Changing the executor's data projection (formatter-only change).
- Changing JSON/CSV output.

## Two output modes

### Compact mode (default)

All fields in a grid. Content column capped at 20 chars (first line + `…`). `abspath` capped at 24 chars (tail display). Other fields auto-size with fallback cap at `budget / n * 1.5`. Good for piping, scripts, and quick browsing.

### Card mode (`--card` flag)

For each file, output a "card" with metadata on top and content below. Long fields (`abspath`) move to their own line when they exceed `budget / 2`. Content gets full terminal width with multiline preservation. Good for reading full content.

## Cell rendering (compact mode)

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

## Width allocation — Compact mode

### Semantic caps

Known fields with predictable content get fixed caps:

| Field | Cap | Display |
|---|---|---|
| `content` | 20 | First line + `…` |
| `abspath` | 24 | Tail: `.../task-001.md` |

### Allocation algorithm

Phase A — compute natural widths:
```
displayWidth(s) = [...s].length          // codepoints; no ANSI in data
natural[i]      = max(displayWidth(header[i]), max over rows displayWidth(cell[i]))
```

Phase B — apply semantic caps:
```
capped[i] = min(natural[i], SEMANTIC_CAPS[header[i]] ?? Infinity)
```

Phase C — if `sum(capped) + separators <= usable`: use capped widths (no shrink).

Phase D — else shrink to a guaranteed fit:
```
separators = (n - 1) * 3                  // the " | " joins
usable     = width - separators

fallbackCap = floor(usable / n * 1.5)     // no column can eat more than 1.5x its share

floors:    if sum(headerWidths) <= usable → floors = headerWidths
                                                  // headers kept readable
           else if 3 * n <= usable          → floors = MIN_COLUMN_WIDTH (3)
           else                             → floors = max(1, floor(usable / n))
                                                  // degenerate tiny-width fallback

remaining  = usable - sum(floors)

weights[i] = max(min(capped[i], fallbackCap) - floors[i], 0)
                                                    // capped by fallbackCap
totalW     = sum(weights)
widths[i]  = floors[i] + (totalW ? floor(remaining * weights[i] / totalW) : 0)
```

Guarantees:

- `sum(widths) + separators <= width` always. The degenerate case where even 3-char floors overflow the budget (very narrow terminal or very many columns) falls back to `max(1, floor(usable / n))` floors, so the fit guarantee holds in every input.
- A single huge cell (`content`, `abspath`) is capped by semantic caps (20 and 24 respectively), so it can no longer push peers below their floor.
- Uncapped fields are further capped by `fallbackCap = usable / n * 1.5`, preventing any single uncapped field from monopolizing the budget.
- When every column is already small (weights all 0), floors alone give the widest readable layout.
- Remaining slack after rounding simply stays unused (trailing space — harmless).

## Width allocation — Card mode

### Layout structure

For each file, output:

```
--- {filename} ---
key1: value1 | key2: value2 | key3: value3
key4: value4 | key5: value5

{content block, full width, multiline}
```

### Field overflow rule

Any field whose `key: value` exceeds `budget / 2` gets its own line below the metadata line. Example:

```
--- task-001.md ---
id: 1 | title: Test Task | status: todo | priority: 3 | tags: [backend, auth]
abspath: /home/projects/mdquery-repo/tests/fixtures/advanced/task-001.md

This is the content body.
```

Here `abspath: /home/.../task-001.md` exceeds 40 chars on an 80-col terminal, so it moves below the metadata line.

### Content row logic

| Query | File has body | File is empty |
|---|---|---|
| `select *` / `select` | Show content block | Skip content block |
| `select content` | Show content block | Show empty line |
| `select title, content` | Show content block | Show empty line |
| `select title, status` | No content block | No content block |

### Empty content behavior

- If content is empty and not explicitly selected → skip the content block entirely
- If content is empty and explicitly selected via `select content` → show empty line
- If content has content → show full body, multiline preserved

## Content behavior matrix

### Compact mode

| Query | Content column |
|---|---|
| `select` (bare) | Capped at 20, first-line truncated |
| `select *` | Capped at 20, first-line truncated |
| `select content` | Capped at 20, first-line truncated |
| `select title, status` | Not shown |
| `select title, content` | Capped at 20, first-line truncated |

### Card mode

| Query | Content block |
|---|---|
| `select` (bare) | Full width, show for files with content, skip empty |
| `select *` | Full width, show for files with content, skip empty |
| `select content` | Full width, show even if empty |
| `select title, status` | No content block |
| `select title, content` | Full width, show even if empty |

## Terminal width detection

Keep `detectColumns()` (TTY → `COLUMNS` env → `tput cols`) and the optional `terminalWidth` argument on `toTable()` for deterministic unit tests. No changes.

## Examples

### Compact mode (default)

For a 80-col terminal and `select filename, title, content` on files with long bodies:

```
filename  | title            | content
--------- | ---------------- | ---------------------------------
task-001  | Fix the login bug| This is the first line of the body
task-002  | Triage data loss | Derive from the first line with ellipsis…
```

`content` shows only its first line, bounded by its allocation (20 chars); other columns keep their natural width.

### Card mode (`--card`)

For a 80-col terminal and `--card select *` on files with long bodies:

```
--- task-001.md ---
id: 1 | title: Test Task | status: todo | priority: 3 | tags: [backend, auth]
abspath: /home/projects/mdquery-repo/tests/fixtures/advanced/task-001.md

This is a test task.
This is the markdown body content.
It can span multiple lines.

--- task-002.md ---
id: 2 | title: Another Task | status: done | priority: 5 | tags: [frontend]
abspath: /home/projects/mdquery-repo/tests/fixtures/advanced/task-002.md

This is another test task.
```

`abspath` exceeds `budget / 2` (40 chars) so it moves below the metadata line. Content gets full width with multiline preservation.

## Testing

Extend `tests/formatter.test.ts`:

### Compact mode tests
- Semantic caps applied: content column capped at 20, abspath at 24.
- Fallback cap prevents squashing: many columns, no single column exceeds `budget / n * 1.5`.
- Multi-line cell value → output contains only the first line, plus `…` when truncated.
- One outsized `content`-style column (e.g. 1,000 chars) alongside short columns → the short columns keep readable widths (regression guard for the squashing bug).
- Absent field → empty cell; array field renders `[a, b]`.
- Property-style loop: for random small column counts and long values, every output line ≤ `width`.
- Existing tests remain green (no change when data fits).

### Card mode tests
- Basic layout: header, metadata lines, content block.
- Empty content skipped (unless explicit `select content`).
- Field overflow: field exceeding `budget / 2` moves to own line.
- `--card` flag triggers card output.
- Content with multiple lines renders in full.

## Compatibility

- `Formatter.format` and `toTable(result, width?)` signatures unchanged.
- New `toCard(result, width?)` method added.
- JSON / CSV behavior unchanged.
- Multi-line content inside table cells is now single-line (compact mode, positive change; cell-level only).
- Card mode preserves multiline content (positive change).

## Deferred

- Word-wrap across rows (compact mode).
- `| run(...)` / `| clipboard()` pipe rendering (separate CLI/pipe work).
- Data-side presence semantics are speced in the separate mdquery-semantics design; this spec only defines how table cells render values.
