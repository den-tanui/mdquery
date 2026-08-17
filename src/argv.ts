// src/argv.ts
// Pre-parse argv normalization for the CLI.

// Options that consume a following value (used to distinguish true
// positionals from option values when scanning argv).
const VALUE_TAKING_OPTS = new Set(['--dir', '-f', '--file', '-d', '--depth', '--format', '-o', '--out', '--rows', '--columns']);

// Collect true positionals: bare words that are not option values.
export function collectPositionals(argv: string[]): string[] {
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('-')) {
      if (VALUE_TAKING_OPTS.has(a)) i++; // skip the option's value
      continue;
    }
    pos.push(a);
  }
  return pos;
}

// The shell splits `--dir a, b` (space after the comma) into two argv
// entries: `--dir a,` + `b`. Merge the continuation back into the dir value
// so comma-separated lists work without quoting, regardless of where --dir
// appears relative to the query or other flags. A bare word is merged when it
// follows a trailing-comma --dir value and is not the sole query candidate:
//   - it looks like a path (contains /, ~, or starts with .), or
//   - another positional exists elsewhere (so this one isn't the only query)
// A trailing comma with no continuation (e.g. `--dir a, --json`) is left
// alone; the comma-split in dir resolution handles it.
export function mergeDirContinuations(argv: string[]): string[] {
  const positionals = collectPositionals(argv);
  const looksLikePath = (s: string) => s.includes('/') || s.includes('~') || s.startsWith('.');
  const shouldMerge = (next: string) => looksLikePath(next) || positionals.length > 1;
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir' && i + 1 < argv.length) {
      const value = argv[i + 1];
      const next = argv[i + 2];
      if (value.endsWith(',') && next !== undefined && !next.startsWith('-') && shouldMerge(next)) {
        out.push('--dir', value + next);
        i += 2;
        continue;
      }
      out.push(a, value);
      i += 1;
      continue;
    }
    if (a.startsWith('--dir=')) {
      const value = a.slice('--dir='.length);
      const next = argv[i + 1];
      if (value.endsWith(',') && next !== undefined && !next.startsWith('-') && shouldMerge(next)) {
        out.push('--dir=' + value + next);
        i += 1;
        continue;
      }
      out.push(a);
      continue;
    }
    out.push(a);
  }
  return out;
}