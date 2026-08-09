#!/usr/bin/env node
// src/cli.ts
import { Executor } from './executor';
import { Formatter, OutputFormat } from './formatter';
import { VERSION } from './version';
import { readFile } from 'fs/promises';
import { createInterface } from 'readline';

const MANUAL = `mdquery ${VERSION}

Query YAML frontmatter of markdown files with a SQL-like language.

Usage:
  mdquery <query> [options]
  mdquery [options] < query.txt
  fd SKILL.md | mdquery -f - "select name, description"

Options:
  -h, --help            Show this manual and exit
  -v, --version         Print the version and exit
  --dir=<directory>     Directory to query (default: .)
  -f, --file=<file>     Query specific markdown file(s); repeatable or comma-separated
                        Use -f - to read file paths from stdin (one per line)
  -d, --depth=<n>       Directory depth: 0 = recursive (default), 1 = top level only, 2+ = limited depth
  -H, --hidden          Include hidden files/dirs (except .git)
  --no-ignore           Do not respect .gitignore
  -y, --yes             Skip confirmation prompts for update/delete
  --format=<format>     Output format: json | table | csv | card (default: json)
  --card                Shortcut for --format=card (expanded view with full content)

Examples:
  mdquery "select where status = 'done'"
  mdquery --dir=tasks/ "select order by priority"
  mdquery -f task.md -f other.md "select title, status"
  mdquery -d 1 "select filename, path"
  mdquery -H --no-ignore "select filename"
  mdquery --format=table "select filename, title"
  echo "select" | mdquery
  fd SKILL.md | mdquery -f - "select name, description"

Query language (compact):
  select [distinct] <fields> [where <cond>] [group by <f>] [having <cond>]
      [order by <f> [asc|desc]] [limit <n>] [offset <n>] [join <dir> on <cond>]
  update [where <cond>] set <field> = <value>, ...
  create set <field> = <value>, ...
  delete [where <cond>]

  where: <field> <op> <value>  combined with and | or, not (<expr>)
  ops: = != < <= > >= contains starts_with ends_with is [not] empty
       in (...), any <op>, all <op>, exists (<select>)
       "value" in toc(), has section("name")
  aggregates: count(*) | sum(f) | avg(f) | min(f) | max(f)
  pipes: <statement> | <fn>(<args>)
  triggers: before|after create|update|delete ... deny|set|run

  Every row exposes: filename (basename minus .md), path (relative), abspath (absolute).
  create targets: set path = 'rel.md' | abspath = '/abs.md' | file = 'name' (in --dir).

Full documentation: docs/syntax.md
`;

function fail(message: string): never {
  console.error(`Error: ${message}`);
  console.error('Try "mdquery --help" for more information.');
  process.exit(1);
}

function parseDepth(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) fail(`Invalid depth: ${value}`);
  return n;
}

function splitFiles(value: string): string[] {
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

async function confirm(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    fail('confirmation requires a terminal; use -y to skip');
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>(resolve => {
    rl.question(`${message} (y/N) `, resolve);
  });
  rl.close();
  return answer.trim().toLowerCase() === 'y';
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    console.log(MANUAL);
    process.exit(0);
  }

  if (args.includes('-v') || args.includes('--version')) {
    console.log(VERSION);
    process.exit(0);
  }

  let query = '';
  let format: OutputFormat = 'json';
  let dir = '.';
  let files: string[] = [];
  let stdinFiles = false;
  let depth = 0;
  let hidden = false;
  let ignore = true;
  let yes = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--format' && args[i + 1]) {
      format = args[i + 1] as OutputFormat;
      i++;
    } else if (arg === '--dir' && args[i + 1]) {
      dir = args[i + 1];
      i++;
    } else if ((arg === '--file' || arg === '-f') && args[i + 1]) {
      const val = args[i + 1];
      if (val === '-') {
        stdinFiles = true;
      } else {
        files.push(...splitFiles(val));
      }
      i++;
    } else if ((arg === '--depth' || arg === '-d') && args[i + 1]) {
      depth = parseDepth(args[i + 1]);
      i++;
    } else if (arg === '-H' || arg === '--hidden') {
      hidden = true;
    } else if (arg === '--no-ignore') {
      ignore = false;
    } else if (arg === '-y' || arg === '--yes') {
      yes = true;
    } else if (arg === '--card') {
      format = 'card';
    } else if (arg.startsWith('--dir=')) {
      dir = arg.split('=')[1];
    } else if (arg.startsWith('--file=')) {
      const val = arg.split('=')[1];
      if (val === '-') {
        stdinFiles = true;
      } else {
        files.push(...splitFiles(val));
      }
    } else if (arg.startsWith('-f=')) {
      const val = arg.slice(3);
      if (val === '-') {
        stdinFiles = true;
      } else {
        files.push(...splitFiles(val));
      }
    } else if (arg.startsWith('--depth=')) {
      depth = parseDepth(arg.split('=')[1]);
    } else if (arg.startsWith('-d=')) {
      depth = parseDepth(arg.split('=')[1]);
    } else if (arg.startsWith('--format=')) {
      format = arg.split('=')[1] as OutputFormat;
    } else if (arg.startsWith('--')) {
      fail(`Unknown option: ${arg}`);
    } else if (!query) {
      query = arg;
    }
  }

  if (!['json', 'table', 'csv', 'card'].includes(format)) {
    fail(`Invalid format: ${format}`);
  }

  // Check for stdin pipe
  if (stdinFiles || (!query && !process.stdin.isTTY)) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const input = Buffer.concat(chunks).toString().trim();
    
    if (stdinFiles) {
      // Read file paths from stdin (one per line)
      files.push(...input.split('\n').map(line => line.trim()).filter(Boolean));
    } else {
      // Read query from stdin
      query = input;
    }
  }

  if (!query) {
    fail('No query provided');
  }

  // Confirmation for destructive operations
  const op = query.trim().split(/\s+/)[0].toLowerCase();
  if (op === 'delete' && !query.trim().toLowerCase().includes('where')) {
    fail('delete requires a where clause to prevent accidental deletion');
  }
  if ((op === 'update' || op === 'delete') && !yes) {
    const ok = await confirm(`are you sure you want to ${op}?`);
    if (!ok) {
      console.error('Aborted.');
      process.exit(1);
    }
  }

  const executor = new Executor(dir, undefined, undefined, {
    depth,
    hidden,
    ignore,
    files: files.length > 0 ? files : undefined
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

    const output = Formatter.format(result, format);
    console.log(output);
  } catch (error: any) {
    fail(error.message);
  }
}

main();