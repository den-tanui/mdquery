// src/formatter.ts
import { QueryResult } from './types';
import { formatTocAsTree, Section } from './files';
import { stringify } from 'csv-stringify/sync';
import Table from 'cli-table3';
import { DEFAULT_COLORS, sgr as sgrRaw } from './colors';

export type OutputFormat = 'json' | 'table' | 'csv';

// Column width specification for --columns: fixed chars, percentage of the
// usable width, or 'auto' (natural allocation of the remaining space)
export type ColumnWidthSpec =
  | { kind: 'chars'; value: number }
  | { kind: 'pct'; value: number }
  | { kind: 'auto' };

export interface TableOptions {
  colorize?: boolean;
  colors?: Map<string, string>;
  compact?: boolean;
  maxRows?: number;
  columnWidths?: ColumnWidthSpec[];
}

const MIN_COLUMN_WIDTH = 3;
const DEFAULT_TERMINAL_WIDTH = 80;

export class Formatter {
  static format(result: QueryResult, format: OutputFormat, options?: TableOptions): string {
    switch (format) {
      case 'json':
        return this.toJSON(result);
      case 'table':
        return this.toTable(result, 0, options);
      case 'csv':
        return this.toCSV(result);
      default:
        throw new Error(`Unknown format: ${format}`);
    }
  }

  static toTable(result: QueryResult, terminalWidth: number = 0, options?: TableOptions): string {
    if (!result.data || result.data.length === 0) {
      return 'No results';
    }

    const width = terminalWidth > 0 ? terminalWidth : defaultWidth();
    const { colorize = false, colors, compact = false, maxRows, columnWidths } = options ?? {};

    // Limit displayed rows (table view feature)
    const data = maxRows !== undefined && maxRows > 0 ? result.data.slice(0, maxRows) : result.data;

    const headers = Object.keys(data[0]);
    const rows = data.map(row => headers.map(h => {
      const value = (row as any)[h];
      // Format toc and section fields specially
      if (h === 'toc' || h === 'toc()' || h.startsWith('toc(') || h === 'section' || h === 'section()' || h.startsWith('section(') || h.startsWith('section.')) {
        return formatTocForTable(value);
      }
      return String(value ?? '');
    }));

    // Natural column widths: max line length per cell (multi-line cells don't
    // inflate the width of their column)
    const naturalWidths = headers.map((h, i) =>
      Math.max(h.length, ...rows.map(r => maxLineLength(r[i])))
    );

    // cli-table3 uses 1 char per vertical border (left, right, and mid between columns)
    // plus padding per column (2 by default, 1 in compact mode).
    // The total non-content width = 1 (left) + 1 (right) + (headers.length - 1) (mids) = headers.length + 1
    // Total padding = headers.length * paddingPerCol
    const paddingPerCol = compact ? 1 : 2;
    const nonContentCost = headers.length > 0 ? headers.length + 1 + headers.length * paddingPerCol : 0;
    const usable = width - nonContentCost;

    let innerWidths: number[];
    if (columnWidths && columnWidths.length > 0) {
      innerWidths = this.resolveColumnWidths(columnWidths, naturalWidths, usable);
    } else if (sum(naturalWidths) <= usable) {
      innerWidths = naturalWidths;
    } else {
      innerWidths = this.allocateWidths(naturalWidths, usable);
    }

    // Wrap long text to its column width (breaking long unbroken words) instead
    // of truncating with an ellipsis
    const wrappedRows = rows.map(row =>
      row.map((cell, i) => wrapText(cell, innerWidths[i]))
    );

    // cli-table3 colWidths include padding
    const colWidths = innerWidths.map(w => w + paddingPerCol);

    // Colorize-gated wrapper around the canonical sgr from colors.ts
    const sgr = (text: string, code: string) => colorize ? sgrRaw(text, code) : text;

    const titleColor = colors?.get('title') ?? DEFAULT_COLORS.title;
    const borderColor = colors?.get('border') ?? DEFAULT_COLORS.border;

    // Header formatting: uppercase for distinction in both modes, SGR when colorized
    const styledHeaders = headers.map(h => sgr(h.toUpperCase(), titleColor));

    const borderChars = {
      'top': sgr('─', borderColor),
      'top-mid': sgr('┬', borderColor),
      'top-left': sgr('┌', borderColor),
      'top-right': sgr('┐', borderColor),
      'bottom': sgr('─', borderColor),
      'bottom-mid': sgr('┴', borderColor),
      'bottom-left': sgr('└', borderColor),
      'bottom-right': sgr('┘', borderColor),
      'left': sgr('│', borderColor),
      'right': sgr('│', borderColor),
      'middle': sgr('│', borderColor),
      // Compact mode drops the row separators
      'mid': compact ? '' : sgr('─', borderColor),
      'left-mid': compact ? '' : sgr('├', borderColor),
      'mid-mid': compact ? '' : sgr('┼', borderColor),
      'right-mid': compact ? '' : sgr('┤', borderColor)
    };

    const table = new Table({
      head: styledHeaders,
      style: {
        head: [],
        border: [],
        'padding-left': compact ? 0 : 1,
        'padding-right': 1,
      },
      // Cells are pre-wrapped to their column width; wordWrap stays off so
      // cli-table3 renders them verbatim (its own wordWrap truncates long
      // unbroken words, which we handle ourselves)
      wordWrap: false,
      chars: borderChars,
      colWidths: colWidths,
    });

    table.push(...wrappedRows);

    return table.toString();
  }

  // Resolve user-specified column widths against the usable width. Fixed specs
  // (chars/pct) are honored as-is; 'auto' columns share the remaining space via
  // the natural allocation. Missing specs default to 'auto'.
  private static resolveColumnWidths(specs: ColumnWidthSpec[], naturalWidths: number[], usable: number): number[] {
    const n = naturalWidths.length;
    const resolved: (number | 'auto')[] = [];
    let fixedSum = 0;
    let autoCount = 0;
    for (let i = 0; i < n; i++) {
      const spec = specs[i] ?? { kind: 'auto' as const };
      if (spec.kind === 'auto') {
        resolved.push('auto');
        autoCount++;
      } else {
        const w = Math.max(1, spec.kind === 'pct' ? Math.floor(usable * spec.value / 100) : spec.value);
        resolved.push(w);
        fixedSum += w;
      }
    }
    if (autoCount === 0) return resolved as number[];

    const remaining = usable - fixedSum;
    const autoNatural = naturalWidths.filter((_, i) => resolved[i] === 'auto');
    const autoWidths = remaining > 0
      ? this.allocateWidths(autoNatural, remaining)
      : autoNatural.map(() => 1);
    let ai = 0;
    return resolved.map(w => w === 'auto' ? autoWidths[ai++] : w);
  }

  private static allocateWidths(rawWidths: number[], budget: number): number[] {
    const n = rawWidths.length;
    if (n === 0) return [];
    if (budget <= 0) return rawWidths.map(() => 1);

    const fallbackCap = Math.floor(budget / n * 1.5);

    // Compute floors: header widths if they fit, else MIN_COLUMN_WIDTH, else degenerate
    const headerWidths = rawWidths.map(() => MIN_COLUMN_WIDTH);
    let floors: number[];
    if (sum(headerWidths) <= budget) {
      floors = headerWidths;
    } else if (MIN_COLUMN_WIDTH * n <= budget) {
      floors = rawWidths.map(() => MIN_COLUMN_WIDTH);
    } else {
      floors = rawWidths.map(() => Math.max(1, Math.floor(budget / n)));
    }

    const remaining = budget - sum(floors);
    if (remaining <= 0) return floors;

    // Weights: how much each column wants above its floor, capped by fallbackCap
    const weights = rawWidths.map(w => Math.max(Math.min(w, fallbackCap) - MIN_COLUMN_WIDTH, 0));
    const totalW = sum(weights);

    if (totalW === 0) return floors;

    return floors.map((f, i) => f + Math.floor(remaining * weights[i] / totalW));
  }

  private static toJSON(result: QueryResult): string {
    return JSON.stringify(result, null, 2);
  }

  private static toCSV(result: QueryResult): string {
    if (!result.data || result.data.length === 0) {
      return '';
    }
    return stringify(result.data, { header: true, escape_formulas: true });
  }
}

function maxLineLength(value: string): number {
  return Math.max(1, ...value.split('\n').map(l => l.length));
}

// Wrap text to a column width, preserving existing newlines and breaking long
// unbroken words (paths, URLs) so nothing is truncated
function wrapText(text: string, width: number): string {
  if (width <= 0) return text;
  return text.split('\n').map(line => wrapLine(line, width)).join('\n');
}

function wrapLine(line: string, width: number): string {
  if (line.length <= width) return line;
  const words = line.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (word.length > width) {
      // Hard-break words longer than the column
      if (current) {
        lines.push(current);
        current = '';
      }
      for (let i = 0; i < word.length; i += width) {
        lines.push(word.slice(i, i + width));
      }
      continue;
    }
    const candidate = current === '' ? word : current + ' ' + word;
    if (candidate.length <= width) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.join('\n');
}

function formatTocForTable(value: any): string {
  if (value === null || value === undefined) return '';
  
  // Handle section() map output
  if (typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value)
      .map(([key, val]) => `${key}: ${String(val).split('\n')[0]}`)
      .join('\n');
  }
  
  if (!Array.isArray(value)) return String(value);
  
  // Parse "level:title" format and build tree
  const items = value.map((v: any) => {
    if (typeof v === 'string' && v.includes(':')) {
      const [level, ...titleParts] = v.split(':');
      return { level: parseInt(level), title: titleParts.join(':') };
    }
    return { level: 1, title: String(v) };
  });
  
  return formatTocAsTree(items);
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function defaultWidth(): number {
  const columns = detectColumns();
  return columns > 0 ? columns : DEFAULT_TERMINAL_WIDTH;
}

function detectColumns(): number {
  // 1. stdout is a TTY: process.stdout.columns is authoritative
  if (typeof process.stdout.columns === 'number' && process.stdout.columns > 0) {
    return process.stdout.columns;
  }

  // 2. COLUMNS env var (set by many shells/terminals)
  const envColumns = Number(process.env.COLUMNS);
  if (Number.isFinite(envColumns) && envColumns > 0) {
    return envColumns;
  }

  // 3. Query the controlling terminal even when stdout is piped
  try {
    const { execFileSync } = require('node:child_process');
    const out = execFileSync('sh', ['-c', 'tput cols < /dev/tty'], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .toString()
      .trim();
    const n = Number(out);
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    // fall through
  }

  return 0;
}