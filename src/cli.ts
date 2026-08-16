#!/usr/bin/env node
// src/cli.ts
import { Executor } from './executor';
import { Formatter, OutputFormat } from './formatter';
import { VERSION } from './version';
import { program } from 'commander';
import chalk from 'chalk';
import { parseColorEnv, resolveColor, sgr } from './colors';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { dirname, extname, resolve } from 'path';
import { existsSync } from 'fs';
import { homedir } from 'os';

/**
 * Expand a directory argument into an absolute path.
 * Supports: `.` (cwd), `..`, `~` / `~/...` (current user's home),
 * `$VAR` / `$VAR/suffix` (environment variable with optional suffix;
 * shell-like: when the var is set the suffix is appended, when unset the
 * suffix is used as a fallback).
 */
export function resolveDir(input: string): string {
  if (input === '.') return process.cwd();
  if (input === '..') return resolve('..');
  if (input.startsWith('~')) {
    if (input === '~') return homedir();
    if (input.startsWith('~/')) return homedir() + input.slice(1);
    throw new Error(`Only ~ (current user) is supported, got: ${input}`);
  }
  if (input.startsWith('$')) {
    const slashIdx = input.indexOf('/');
    const varName = slashIdx > 0 ? input.slice(1, slashIdx) : input.slice(1);
    const suffix = slashIdx > 0 ? input.slice(slashIdx + 1) : undefined;
    const val = process.env[varName];
    if (val === undefined) {
      if (suffix !== undefined) return resolve(suffix);
      throw new Error(`Environment variable $${varName} is not set`);
    }
    return suffix !== undefined ? resolve(val, suffix) : resolve(val);
  }
  return resolve(input);
}

async function main() {
  // Track the output format with last-wins semantics across --format and the
  // --json/--csv/--table shortcut flags (Commander processes options in order).
  // formatExplicit distinguishes "user passed a format flag" from the default,
  // so --out extension inference only applies when no format was given.
  let format: OutputFormat = 'json';
  let formatExplicit = false;

  // Accumulate repeated options into an array (--dir=a --dir=b => ['a', 'b']).
  const collect = (value: string, previous: string[]): string[] =>
    Array.isArray(previous) ? previous.concat(value) : [value];

  program
    .name('mdquery')
    .version(VERSION, '-v, --version')
    .description('Query YAML frontmatter of markdown files with a SQL-like language')
    .argument('[query]', 'SQL-like query string (or pipe from stdin)')
    .option('--dir <dir>', 'Directories to query (default: .); repeatable or comma-separated', collect)
    .option('-f, --file <file>', 'Specific file(s) to query; repeatable or comma-separated. Use -f - to read file paths from stdin', collect)
    .option('-d, --depth <n>', 'Directory depth (0 = recursive)', '0')
    .option('-H, --hidden', 'Include hidden files/dirs')
    .option('--no-ignore', 'Do not respect .gitignore')
    .option('-y, --yes', 'Skip confirmation prompts')
    .option('--format <format>', 'Output format: json | table | csv', (val: string) => {
      format = val as OutputFormat;
      formatExplicit = true;
      return val;
    }, 'json')
    .option('--json', 'Shortcut for --format=json', () => { format = 'json'; formatExplicit = true; return true; })
    .option('--csv', 'Shortcut for --format=csv', () => { format = 'csv'; formatExplicit = true; return true; })
    .option('--table', 'Shortcut for --format=table', () => { format = 'table'; formatExplicit = true; return true; })
    .option('--color', 'Force colored output (default: auto)')
    .option('--no-color', 'Disable colored output')
    .option('-o, --out <file>', 'Write output to file (default: stdout)')
    .configureOutput({
      // Commander formats errors as "error: unknown option '--card'"; keep the
      // legacy "Error: Unknown option: --card" wording.
      outputError: (str, write) => {
        const transformed = str
          .replace(/^error: unknown option '([^']+)'/, 'Error: Unknown option: $1')
          .replace(/^error: /, 'Error: ');
        write(transformed);
      }
    })
    .configureHelp({
      // Commander v15 ships plain style hooks; fill them with chalk so help
      // text is colorized on a terminal (chalk auto-detects TTY, so piped
      // help stays clean).
      styleTitle: (str: string) => chalk.bold(str),
      styleOptionText: (str: string) => chalk.bold(str),
      styleCommandText: (str: string) => chalk.bold(str),
      styleArgumentText: (str: string) => chalk.cyan(str),
      styleDescriptionText: (str: string) => chalk.dim(str),
    })
    .showHelpAfterError('Try "mdquery --help" for more information.')
    .addHelpText('after', `

Examples:
  mdquery "select where status = 'done'"
  mdquery --dir tasks/ "select order by priority"
  mdquery --dir ~/.agents/skills --dir ~/opt/skills "select filename, source_dir"
  mdquery --out results.json "select filename, description"
  mdquery --format=table --no-color "select *"
  fd SKILL.md | mdquery -f - "select name, description"

Query language: docs/syntax.md`);

  // No arguments at all: print help and exit 0 (legacy behavior)
  if (process.argv.slice(2).length === 0) {
    program.outputHelp();
    process.exit(0);
  }

  program.parse();

  const opts = program.opts();
  let query = program.args[0] || '';

  // Build the color environment: MDQUERY_COLORS > LS_COLORS (file-like keys) > defaults
  const mdColors = parseColorEnv(process.env.MDQUERY_COLORS || '');
  const lsColors = parseColorEnv(process.env.LS_COLORS || '');
  const colors = new Map<string, string>();
  for (const key of ['title', 'border', 'error', 'warning']) {
    colors.set(key, resolveColor(key, mdColors, lsColors));
  }
  // --no-color disables all coloring; otherwise error/warning messages are colored
  const colorEnabled = opts.color !== false;
  const err = (msg: string) => colorEnabled ? sgr(msg, colors.get('error') ?? '31') : msg;
  const warn = (msg: string) => colorEnabled ? sgr(msg, colors.get('warning') ?? '33') : msg;

  // Resolve dirs: split comma-separated values, expand each
  const rawDirs: string[] = opts.dir?.length > 0 ? opts.dir : ['.'];
  const dirs: string[] = rawDirs
    .flatMap((d: string) => d.split(','))
    .map((d: string) => d.trim())
    .filter(Boolean)
    .map(resolveDir);

  // Validate dirs exist: single dir fails fast, multi-dir warns + continues
  const missingDirs = dirs.filter(d => !existsSync(d));
  if (missingDirs.length > 0) {
    if (dirs.length === 1) {
      console.error(err(`Error: directory ${missingDirs[0]} does not exist`));
      process.exit(1);
    }
    for (const d of missingDirs) {
      console.error(warn(`warning: directory ${d} does not exist`));
    }
  }
  const validDirs = dirs.filter(d => existsSync(d));

  // Handle file options: split comma-separated values. Commander passes the
  // value of the short `-f=...` form with a leading '='; strip it to match the
  // legacy parser.
  const files: string[] = (opts.file || [])
    .flatMap((f: string) => f.split(','))
    .map((f: string) => f.trim().replace(/^=/, ''))
    .filter(Boolean);

  // Handle stdin: -f - reads file paths (one per line), otherwise the query
  const stdinFiles = files.includes('-');
  if (stdinFiles || (!query && !process.stdin.isTTY)) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const input = Buffer.concat(chunks).toString().trim();

    if (stdinFiles) {
      files.splice(files.indexOf('-'), 1);
      files.push(...input.split('\n').map(line => line.trim()).filter(Boolean));
    } else {
      query = input;
    }
  }

  if (!query) {
    console.error(err('Error: No query provided'));
    console.error('Try "mdquery --help" for more information.');
    process.exit(1);
  }

  if (!['json', 'table', 'csv'].includes(format)) {
    console.error(err(`Error: Invalid format: ${format}`));
    process.exit(1);
  }

  // Resolve format: --format flag wins > extension inference > default json
  let resolvedFormat: OutputFormat = format;
  let outPath = opts.out;
  if (outPath && outPath !== '-') {
    const ext = extname(outPath).toLowerCase();
    if (!formatExplicit && (ext === '.json' || ext === '.csv')) {
      resolvedFormat = ext === '.json' ? 'json' : 'csv';
    }
    // If the filename has no extension, append the resolved format's extension
    if (!ext) {
      outPath = `${outPath}.${resolvedFormat}`;
    }
  }

  // Presentation-layer decision: color only table output, and only when forced
  // (--color) or when writing to a terminal (auto). File output stays clean.
  // Cast: TS narrows resolvedFormat to 'json' | 'csv' after extension inference,
  // but the declared type is OutputFormat — 'table' is reachable via --format/--table.
  const toTerminal = !outPath || outPath === '-';
  const colorize = (resolvedFormat as OutputFormat) === 'table' && (
    opts.color === true ||
    (opts.color !== false && toTerminal && !!process.stdout.isTTY)
  );

  // Commander passes the value of the short `-d=...` form with a leading '='
  const depth = Number(String(opts.depth).replace(/^=/, ''));
  if (!Number.isFinite(depth)) {
    console.error(err(`Error: Invalid depth: ${opts.depth}`));
    process.exit(1);
  }

  // Confirmation for destructive operations
  const op = query.trim().split(/\s+/)[0].toLowerCase();
  if (op === 'delete' && !query.trim().toLowerCase().includes('where')) {
    console.error(err('Error: delete requires a where clause to prevent accidental deletion'));
    process.exit(1);
  }
  if ((op === 'update' || op === 'delete') && !opts.yes) {
    if (!process.stdin.isTTY) {
      console.error(err('Error: confirmation requires a terminal; use -y to skip'));
      process.exit(1);
    }
    const { createInterface } = await import('readline');
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const answer = await new Promise<string>(resolve => {
      rl.question(`${op} (y/N) `, resolve);
    });
    rl.close();
    if (answer.trim().toLowerCase() !== 'y') {
      console.error('Aborted.');
      process.exit(1);
    }
  }

  const executor = new Executor(validDirs, undefined, undefined, {
    depth,
    hidden: opts.hidden,
    ignore: opts.ignore,
    files: files.length > 0 ? files : undefined,
    format: resolvedFormat
  });

  try {
    if (files.length > 0) {
      // Validate each file parses as markdown frontmatter
      const matter = (await import('gray-matter')).default;
      for (const f of files) {
        const content = await readFile(f, 'utf-8');
        matter(content);
      }
    }

    const result = await executor.execute(query);

    if (result.meta?.errors?.length) {
      console.error(warn(`warning: skipped ${result.meta.errors.length} file(s) (see meta.errors)`));
    }

    const output = Formatter.format(result, resolvedFormat, { colorize, colors });

    // --out: write to file or stdout (file output is clean by construction —
    // colorize is false whenever outPath is set)
    if (outPath && outPath !== '-') {
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, output, 'utf-8');
    } else {
      console.log(output);
    }
  } catch (error: any) {
    console.error(err(`Error: ${error.message}`));
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}