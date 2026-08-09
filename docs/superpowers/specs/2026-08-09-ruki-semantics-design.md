# Ruki-Inspired Semantics & Expressions — Design

Date: 2026-08-09
Status: Approved for implementation
Scope: `src/types.ts`, `src/lexer.ts`, `src/parser.ts`, `src/executor.ts`, `src/files.ts`, `src/cli.ts` + tests

## Context

mdquery models markdown frontmatter as rows of a "table" but has no notion of an absent field. This produces silently wrong results (R1) and blocks useful idioms:

- `is empty` is implemented as `!value || value === ''` (`executor.ts:418`), so absent, `0`, `false`, `""`, and `[]` are indistinguishable, and there is no `has()` predicate to tell "never set" from "set to zero".
- `exists(select ...)` is parsed (`parser.ts:322`) but `evaluateWhere` has no `exists` case (`executor.ts:281-298`), so it silently returns `false`.
- Lists cannot be written: `parseValue` cannot parse `[...]`, the `+`/`-` tokens exist in the lexer but no expression grammar uses them, and `set x = null` writes the literal YAML key `x: null` instead of clearing it.
- `delete` without a `where` deletes every file in the directory.
- Identity fields are silently dropped on write (`files.ts:160` filter) rather than rejected.

This design ports the presence-aware, expression-capable semantics of the `ruki` language (tiki docs) into mdquery (which stays schema-agnostic — every frontmatter key is a field).

## Scope

- **Phase 1 — semantics core:** presence (`has`, absent-field comparison rules), `empty` literal semantics, `not in`, `in` substring mode, fix `exists(select ...)`, add `count(select ...)` with `outer.` correlation.
- **Phase 2 — lists & expressions:** array literals, `+`/`-` binary expressions (string concat, list union/removal, int +,-), `set x = empty` key removal, immutability errors, `delete` requires `where`.

Deferred (separate designs): the trigger execution engine (currently only parsed), time triggers, pipes (`| run()`, `| clipboard()`), top-level scalar statements, table-formatter rendering / library choice.

## Goals

1. Every comparison is presence-aware: `has(x)` is the only predicate that distinguishes absent from `0`/`false`/`''`.
2. `empty` as the canonical "clear/unset": `set x = empty` removes the frontmatter key; list arithmetic keeps the key but writes `[]`.
3. No silently-wrong results: `exists(select ...)` and `count(select ...)` actually execute; subquery predicates support `outer.field` correlation.
4. Lists become first-class values in `create`/`set`/`where`.
5. Destructive/safety rules match ruki-spec: `delete` requires `where`.

## Behavioral contracts (presence)

For an absent field `x`, define `present(f, x) = hasOwnProperty(f, x)`:

| Form | Absent result |
|---|---|
| `x = v` | false |
| `x != v` | true |
| `x is empty` / `x = empty` | true |
| `x is not empty` / `x != empty` | false |
| `x in [...]` | false |
| `x not in [...]` | true |
| `x any c` | false (vacuous for `all`) |
| `x all c` | true (vacuous for `all`) |
| `< > <= >=` | **no-match** (row filtered out; not an error) |

Decisions:

- Ordering comparisons against an absent field are **safe no-match** (no error). This keeps sparse frontmatter queryable and mirrors how `order by` already handles missing keys (`|| ''`). If a stricter behavior (error like ruki) is later wanted it is isolated in `evaluateComparison`.
- `is empty` keeps accepting present-but-zero values (`0`, `false`, `''`, `[]`) as empty — it is the "zero-ish" check. `has(x)` is what you use to ask "declared at all".
- `= empty`: treat absent as empty, and also match present empty/zero values (consistent with `is empty`).

## Expression & value semantics

### Literals

- `empty` literal → `ValueNode { type: 'empty' }`. In comparisons it compares as the empty value; in `create`/`update set` RHS it means `REMOVE_FIELD` (delete the key).
- Array literal `[...]`: homogeneous primitive list. Parsed in `parseValue` (`[`...`]`). Elements are `parseValue` results (`string | number | boolean | null`); `empty` inside an array is rejected (no zero in a list). Mixed primitive types rejected (list of strings + number errors).
- `true`/`false`/`null` token handling: existing.

### Binary `+` / `-`

Left-associative, added in `parseValue` after a primary value (only one precedence level, matching ruki):

- number `+`/`-` number → number
- string + string → string (concat)
- list + list → set union (dedupe)
- list - list → set difference
- list + scalar, list - scalar → add / remove element
- scalar + list (string) → list prepend (dedupe)
- absent list operand (LHS) is treated as `[]`, so `set tags = tags + ["x"]` is the canonical "first write" idiom and always writes the key (key written even when the result is `[]`).

Any other operand combination → parser/executor error (e.g. `1 + "a"`).

## Module changes

### `src/types.ts`

- `ValueNode`: add `Empty` variant (`{ type: 'empty' }`) and `BinaryExpr` variant (`{ type: 'binary', op: '+'|'-', left, right }`); array `ValueNode` already exists for the `in (…)` form.
- `WhereNode`: add:
  - `'comparison'` op `'has'` (created by `has(x)` / qualified `has(new.x)` / `has(outer.x)`).
  - `'subquery'` form for aggregate-subquery predicates: `{ type: 'subquery', func: 'count'|'exists', subquery: SelectNode, op?: string, value?: ValueNode }`.
  - existing `exists` node form retained (bug-fix: actually execute it).
- No change to `SelectNode`.

### `src/lexer.ts`

- `has`, `not` are already keywords/tokens; `outer` lexes as `IDENTIFIER`. No new dedicated tokens needed. Verify `empty` lexes as `EMPTY` (it does) and `not in` tokenizes as `NOT IN` (two tokens — handled in parser).

### `src/parser.ts`

- `parseValue`: handle `EMPTY` → `{ type: 'empty' }`; handle `LBRACKET` → output literal; after a primary value, loop for `+`/`-` to build binary `ValueNode`.
- `parseComparison`:
  - `not in ...` (the `NOT IN` head) and `x in ...` where RHS is `[`/`(` list or an IDENTIFIER field (substring / membership mode). Both `in (…, …)` (compat) and `in [...]` / `in field` supported.
  - `has(`: parse a bare or qualified reference (`status`, `new.assignee`, `outer.title`) → `comparison` node with op `'has'`.
  - `x = empty` / `x != empty` → treated as `is empty` / `is not empty` (with `x`'s prefix preserved).
  - Subquery aggregates: `IDENTIFIER '(' ('select'…) ')'` for `count(select …)` / `exists(select …)`: `exists(...)` stands alone as a predicate, `count(select …)` appears as the left operand of a comparison (`count(select …) >= 2`). Both produce the new `subquery` node with an optional `op` + `value` tail.
  - Qualified refs `outer.x` / `new.x` / `old.x` inside subquery conditions: extend the existing `new.`/`old.` DOT handling (`parser.ts:356`).
- `isKeyword` / field-list stop list: extend to include the new contextual keywords (`has`, `empty`, `join`, `having`, `distinct`, `not`, `in`, `is`, `any`, `all`, `exists`) so `parseFieldList` stops correctly.

### `src/executor.ts`

- `present(f, field)` helper uses `hasOwnProperty`.
- `evaluateWhere`:
  - implement `has` op (with `old.`/`new.`/`outer.` prefix via context map)
  - implement the `exists` node by executing the subquery over fresh `FileOps.readFiles` and returning `rows > 0`
  - implement `subquery` node: evaluate `count(subquery)`/`exists(subquery)` with optional `outer` row bound, compare against `value` with `op`.
- `evaluateComparison`: rewrite around presence. For an absent field apply the contract table; for present fields existing coercion stays (already: numeric/string coercion for `<`,`=`).
- `evaluateValue`: handle `empty` and binary `+`/`-` value nodes (recursive eval, list set semantics above).
- `subqueryExecutor(count/exists)`: evaluate against fresh `FileOps.readFiles`. If the subquery `where` references `outer.` it runs per outer row (correlated); otherwise the uncorrelated result is computed once and cached per statement (hoisted), avoiding redundant scans.
- `executeUpdate` / `executeCreate`: reject assignments to _immutable on update_ fields with a clear error: `filename`, `path`, `abspath`, `filepath`, `createdAt`, `updatedAt`. (In `create`, `path`/`abspath`/`file`/`filename` remain target selectors, and `createdAt`/`updatedAt` are auto-generated — but explicit assignment is allowed.)
- `executeDelete`: if `node.where` is missing → throw `delete requires a where clause (use -y only for explicit confirmation)`.

### `src/files.ts`

- `writeFile`: skip (do not write) keys whose value is the `empty` sentinel (a module-local `EMPTY` symbol exported by `types` or a dedicated constant), i.e. `set x = empty` clears the frontmatter key. Everything else unchanged; identity keys already stripped.

### `src/cli.ts`

- `delete` with no `where` → error before confirmation; reused `-y` still skips confirmation when a `where` is present.

## Compatibility

- Existing tests: `is empty` semantics unchanged for present values; the presence table only affects absent fields. Existing fixture rows declare consistent keys, so contracts stay green except for intentionally changed behaviors listed below.
- Intentional behavior changes:
  1. `delete` without `where` now errors (was: delete-all). Returning to ruki's require-where rule.
  2. `set x = null` no longer writes `x: null`; `set x = empty` is the clearing idiom. `null` literal still parses as a value for odd frontmatter round-trips.
  3. Identity-field writes in `update` now error instead of silently dropping.
  4. `x all c` on an **absent** field returns `true` (vacuous truth, per ruki); today `all` returns `false` for any non-array. Present-but-empty arrays were already `true` via `every()`. `any` on absent stays `false`.
- JSON / CSV / table output of existing queries unchanged for present data.

## Docs

Update `docs/syntax.md` and `docs/examples.md` (operator tables, `empty`, `has`, presence rules, list arithmetic, `delete` requires `where`) as part of the implementation PR.

## Testing

- `tests/presence.test.ts` (new): the absent-field contract matrix; `has` variants with `old.`/`new.`/`outer.`; `= empty` vs `is empty`; `set x = empty` clears key; list first-write idiom (`tags + ["a"]` writes key; `tags - ["only"]` keeps `[]`).
- `tests/subqueries.test.ts` (new): `exists(select …)`, `count(select …) > n`, `outer.` correlation inside CLI-scoped queries.
- `tests/parser-update.test.ts` + new list/expr tests: array literals, binary `+`/`-`, `not in`, substring `in`.
- `tests/discovery.test.ts` / `tests/files.test.ts`: identity write rejection; `delete` (no where) error.
- Existing suites (incl. `string-operators`, `trigger-variables`) stay green.

## Deferred / out of scope

- The trigger engine (registration, validation `before`=deny/`after`=action, cascade depth, time triggers) — separate design.
- `| run(...)`/`| clipboard()` pipes, top-level scalar expressions, CLI flag additions — separate CLI work.
- Table-view rendering (single-line cells, width allocation) — spec'd separately; on this design's present-semantics for how cells render absent values.