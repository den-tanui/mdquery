# Benchmark Specification

## Purpose

Establish performance baselines for the current implementation and create a framework for measuring the planned AST-based implementation. Enables data-driven decisions about whether the rewrite delivers measurable improvements.

## Current Implementation (Baseline)

- **Lexer**: `src/lexer.ts` — tokenization with `matchAny()` scanning
- **Parser**: `src/parser.ts` — recursive descent with `parsePrimary()` for builtins
- **Executor**: `src/executor.ts` — `evaluate()` with `evaluateBuiltin()` dispatching
- **File I/O**: `src/files.ts` — `FileOps.readFiles()` with parallel read + parse
- **Builtins**: `src/builtins.ts` — regex-based body extraction in `toc()`, `section()`

## Planned Implementation (Target)

- **Lexer**: Character-by-character, no regex
- **Parser**: Pratt parser with binding power table
- **Executor**: Expression tree evaluation
- **File I/O**: fdir (list) + grepts (pre-filter) + lazy parse
- **Builtins**: AST-based extraction via remark + unist utilities

## Metrics

### 1. Speed (ms)

| Metric | Description |
|--------|-------------|
| `parseTime` | Time to tokenize + parse query string |
| `readTime` | Time to read files from disk |
| `executeTime` | Time to evaluate query against files |
| `totalTime` | End-to-end query execution |
| `throughput` | Files processed per second |

### 2. Memory (MB)

| Metric | Description |
|--------|-------------|
| `heapUsed` | V8 heap usage after execution |
| `heapTotal` | V8 total heap allocation |
| `external` | External memory (C++ objects) |
| `rss` | Resident Set Size |

### 3. CPU (ms)

| Metric | Description |
|--------|-------------|
| `userTime` | CPU time in user mode |
| `systemTime` | CPU time in kernel mode |
| `gcTime` | Time spent in garbage collection |

## Test Tiers

### Tier 1: Scale Tests

| Scale | Files | Avg Lines | Avg Size | Description |
|-------|-------|-----------|----------|-------------|
| Small | 10 | 50 | 2 KB | Quick iteration |
| Medium | 100 | 100 | 5 KB | Real-world project |
| Large | 1,000 | 200 | 10 KB | Large codebase |
| XL | 10,000 | 500 | 25 KB | Stress test |

### Tier 2: Complexity Tests

| Test | Description |
|------|-------------|
| Simple query | `SELECT title WHERE status = "todo"` |
| Nested builtin | `SELECT title WHERE len(trim(title)) > 10` |
| Body extraction | `SELECT title, toc()` |
| Complex body | `SELECT title, links('url') WHERE section("Setup")` |
| Write query | `UPDATE SET status = "done" WHERE title = "Fix bug"` |

### Tier 3: Content Tests

| Test | Description |
|------|-------------|
| Frontmatter only | Files with 20 frontmatter fields |
| Body with sections | Files with 10 sections, 100 lines each |
| Many links | Files with 50+ links |
| Many code blocks | Files with 20+ code blocks |
| Mixed content | Real-world markdown files |

## Test Files

Generate test files programmatically in `tests/fixtures/benchmark/`:

```typescript
function generateTask(id: number, options: {
  fields?: number;
  sections?: number;
  links?: number;
  codeblocks?: number;
}): string
```

## Benchmark Runner

Use vitest with custom benchmark configuration:

```typescript
describe('Benchmark: Parse Speed', () => {
  it('parses simple query', () => {
    const start = performance.now();
    // parse query
    const end = performance.now();
    expect(end - start).toBeLessThan(TARGET);
  });
});
```

## O-Notation Extrapolation

Measure at multiple scales, fit complexity model:

| Operation | Expected | Target |
|-----------|----------|--------|
| Parse | O(n) | Linear scaling |
| Body extraction (regex) | O(n*m) | Quadratic |
| Body extraction (AST) | O(n) | Linear |
| Link extraction (regex) | O(n*m) | Quadratic |
| Link extraction (AST) | O(n) | Linear |

Where:
- n = number of files
- m = average file size (lines)

## Pass Criteria

| Metric | Current Baseline | Target |
|--------|------------------|--------|
| Small (10 files) | Measure | < 50ms |
| Medium (100 files) | Measure | < 500ms |
| Large (1,000 files) | Measure | < 5s |
| Memory (100 files) | Measure | < 50MB |
| Memory (1,000 files) | Measure | < 200MB |

## Implementation Plan

1. Create test file generator
2. Write benchmark tests for current implementation
3. Run benchmarks, record baselines
4. Implement AST-based extraction
5. Run benchmarks again, compare
6. Update pass criteria based on results

## Files

- `tests/benchmark-scale.test.ts` — Scale tests (10, 100, 1000, 10000 files)
- `tests/benchmark-complexity.test.ts` — Query complexity tests
- `tests/benchmark-content.test.ts` — Content type tests
- `tests/fixtures/benchmark/` — Generated test files
