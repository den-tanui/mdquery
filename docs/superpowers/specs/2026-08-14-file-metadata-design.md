# File Metadata Design (file() builtin)

Date: 2026-08-14
Status: Design approved (separate plan — own implementation cycle)

## Overview

Expose file metadata as a queryable map via a `file()` builtin. This is a **separate plan** from the relational-output redesign (see [2026-08-14-relational-output-design.md](./2026-08-14-relational-output-design.md) §7). It fixes bug #8 (`order by mtime` silently no-ops).

## file() return shape

`file()` returns a **single map object** — the metadata of the current file (the row being evaluated), same shape as `fields()` (`{field: value}`), NOT an array, NOT `{metadata: value}`:

```sql
file()   -- {abspath: "/abs/path.md", mtime: <Date>, atime: <Date>, ctime: <Date>,
         --  owner: "demigod", group: "demigod", size: 1234, mode: "rw-r--r--", ...}
```

| Builtin | Returns | Shape |
|---|---|---|
| `fields()` | single map | `{title: "x", status: "todo", ...}` (frontmatter) |
| `file()` | single map | `{abspath: "...", mtime: <Date>, owner: "...", ...}` (metadata) |
| `section("name")` | single map | `{title, level, position, hierarchy, content}` |
| `sections()` | **array** of maps | `[{title, ...}, ...]` |

## Access syntax

Property access only — **respect data types**:

```sql
file().mtime      -- Date scalar
file().abspath    -- string scalar
file().owner      -- string scalar
file().size       -- number scalar
```

**`file().mtime()` is NOT valid** — a map is not callable. Data types are respected: property access via `.property`, never `()` on a map.

## Field types

| Field | Type | Notes |
|---|---|---|
| `abspath` | string | absolute path |
| `mtime` | Date | modification time |
| `atime` | Date | access time |
| `ctime` | Date | change time |
| `owner` | string | file owner |
| `group` | string | file group |
| `size` | number | bytes |
| `mode` | string | permissions (e.g. `rw-r--r--`) |

## Transformations

- Date fields are **real Date objects in memory** so `ORDER BY file().mtime`, `WHERE file().mtime > ...`, and comparisons work via the TypeSystem.
- They serialize to **ISO strings** in JSON output (via `JSON.stringify`).
- `updatedAt`/`createdAt` are **NOT aliases** — they are explicit frontmatter fields (immutable via `update`), unrelated to file metadata. No aliasing.

## Interaction with flat identity fields

Existing flat identity fields (`filename`, `path`, `abspath`) remain row columns; `file()` is the metadata accessor. `file().abspath` duplicates the flat `abspath` column for convenience.

## Scalar enforcement interaction

- `file().mtime` (property access) → scalar Date → OK in table/CSV.
- `file()` alone → map → JSON-only; table/CSV throw an early error suggesting `file().mtime`, `file().abspath`, etc. (shape-aware message per the relational-output spec §2).

## Bug fixed

Bug #8: `order by mtime` silently no-ops (evaluateField has no metadata handling) → `order by file().mtime` works.

## Implementation notes

- `file()` is a per-row builtin like `fields()` / `section("name")` — evaluated in the executor with access to the current file's `stat` data.
- Metadata is read once per file (during read phase) and stored on the row; `file()` returns the stored map.
- `ctime` may be unavailable on some filesystems → `null`.
- Tests: `file().mtime` sortable via ORDER BY; `file()` alone throws in table/CSV with shape-aware suggestion; `file().mtime()` rejected by parser/executor; ISO serialization in JSON.
- Validation: `bun run test` + `bun run build:lib` + `bun run build:cli`.

## Out of scope

- `relpath` / other path helpers — flat `path` column already exists; not adding new path functions in this plan.
- Frontmatter `updatedAt`/`createdAt` semantics — unchanged (explicit fields, immutable via `update`).