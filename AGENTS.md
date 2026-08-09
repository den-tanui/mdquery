# AGENTS.md

mdquery (`@projext/mdquery`): a SQL-like query language over the YAML frontmatter of markdown files. TypeScript, ESM, built with **Bun** (not npm). Grammar lives in `docs/syntax.md`; CLI flags are duplicated in the README and the in-binary manual in `src/cli.ts`.

## Commands (Bun required)

```sh
bun install         # uses bun.lock — do not commit package-lock.json
bun run test        # vitest run (unit + integration)
bun run test:watch
bun run test:coverage
bun run build       # build:lib (dist/) + build:cli (standalone ./mdquery binary)
```

- There is **no lint or typecheck script**. Validation is `bun run test` plus optionally `bun run build`. `tsconfig.json` is strict but unused by the build — `bun build` compiles everything.
- `tests/cli.test.ts` runs the compiled `./mdquery` binary and auto-rebuilds it with `bun run build:cli` when the binary is stale vs `src/cli.ts`. The binary is gitignored but required by tests.
- `dist/` is gitignored yet `dist/index.js` and `dist/cli.js` are **tracked in git**. Rebuilding dirties the working tree; don't commit dist churn unless asked.

## Architecture

Pipeline: `cli.ts` → `lexer.ts` (tokens) → `parser.ts` (AST) → `executor.ts` → `formatter.ts` (json/table/csv). Supporting modules:

- `files.ts` — `FileOps.readFiles` discovers `.md` files (depth, hidden, `.gitignore` via `ignore`), parses frontmatter with `gray-matter`
- `builtins.ts` — scalar functions (`now()`, `upper()`, `next_date()`, ...) callable in `set` clauses and values
- `types.ts` — `TokenType`, AST node types, `QueryOptions`; `QueryResult` is declared in both `executor.ts` and `types.ts` (executor's is canonical)
- `index.ts` — library entrypoint (exports Lexer, Parser, Executor, FileOps, Builtins, Formatter, types)

Library consumers use `new Executor(dir, context?, triggerContext?, readOptions?)` then `await executor.execute(query)`.

## Gotchas

- Every row exposes identity fields `filename` (basename minus `.md`), `path` (relative to search dir), `abspath`. `id` is a plain frontmatter field — only present when the file declares it.
- `update`/`delete` without a `where` are destructive; the CLI confirms unless `-y`.
- Version lives in **two places**: `package.json` and `src/version.ts` — bump both.
- Tests create/cleanup fixtures in `beforeAll`/`afterAll`: either in `os.tmpdir()` with `randomUUID` or in `tests/fixtures/*`. Don't add persistent fixtures under `tests/fixtures` that other tests assume are writable.
