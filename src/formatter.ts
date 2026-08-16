// src/formatter.ts
import { QueryResult } from './types';
import { formatTocAsTree, Section } from './files';
import { stringify } from 'csv-stringify/sync';
import Table from 'cli-table3';

export type OutputFormat = 'json' | 'table' | 'csv';

const MIN_COLUMN_WIDTH = 3;
const DEFAULT_TERMINAL_WIDTH = 80;

// Semantic caps for known fields — fixed widths for predictable display
const SEMANTIC_CAPS: Record<string, number> = {
  content: 20,   // First line + ellipsis
  abspath: 24,   // Tail: .../filename.md
};

export class Formatter {
  static format(result: QueryResult, format: OutputFormat, options?: { colorize?: boolean }): string {
    switch (format) {
      case 'json':
        return this.toJSON(result);
      case 'table':
        return this.toTable(result, 0, options?.colorize ?? false);
      case 'csv':
        return this.toCSV(result);
      default:
        throw new Error(`Unknown format: ${format}`);
    }
  }

  static toTable(result: QueryResult, terminalWidth: number = 0, colorize: boolean = false): string {
    if (!result.data || result.data.length === 0) {
      return 'No results';
    }

    const width = terminalWidth > 0 ? terminalWidth : defaultWidth();

    const headers = Object.keys(result.data[0]);
    const rows = result.data.map(row => headers.map(h => {
      const value = (row as any)[h];
      // Format toc and section fields specially
      if (h === 'toc' || h === 'toc()' || h.startsWith('toc(') || h === 'section' || h === 'section()' || h.startsWith('section(') || h.startsWith('section.')) {
        return formatTocForTable(value);
      }
      return String(value ?? '');
    }));

    // Apply semantic caps to cell values (first-line extraction + truncation)
    const cappedRows = rows.map(row =>
      row.map((cell, i) => {
        const header = headers[i];
        const cap = SEMANTIC_CAPS[header];
        if (cap !== undefined) {
          const firstLine = cell.split('\n')[0];
          if (firstLine.length > cap) {
            // Special handling for abspath: show tail
            if (header === 'abspath') {
              return tailDisplay(firstLine, cap);
            }
            return ellipsize(firstLine, cap);
          }
          return firstLine;
        }
        return cell;
      })
    );

    // Natural column widths after cap application
    const naturalWidths = headers.map((h, i) =>
      Math.max(h.length, ...cappedRows.map(r => r[i]?.length || 0))
    );

    // cli-table3 uses 1 char per vertical border (left, right, and mid between columns)
    // plus 2 chars of padding per column by default (padding-left: 1, padding-right: 1).
    // The total non-content width = 1 (left) + 1 (right) + (headers.length - 1) (mids) = headers.length + 1
    // Total padding = headers.length * 2
    const nonContentCost = headers.length > 0 ? headers.length + 1 + headers.length * 2 : 0;
    const usable = width - nonContentCost;

    // Apply semantic caps to natural widths
    const cappedWidths = naturalWidths.map((w, i) => {
      const cap = SEMANTIC_CAPS[headers[i]];
      return cap !== undefined ? Math.min(w, cap) : w;
    });

    let innerWidths: number[];
    if (sum(cappedWidths) <= usable) {
      innerWidths = cappedWidths;
    } else {
      innerWidths = this.allocateWidths(cappedWidths, usable);
    }

    // cli-table3 colWidths include padding (default 2 per column)
    const colWidths = innerWidths.map(w => w + 2);

    const sgr = (text: string, code: string) => colorize ? `\x1b[${code}m${text}\x1b[0m` : text;

    const styledHeaders = headers.map(h => sgr(h, '01;34'));

    const table = new Table({
      head: styledHeaders,
      style: { head: [], border: [] },
      chars: {
        'mid': '', 'left-mid': '', 'mid-mid': '', 'right-mid': '',
        'top': sgr('─', '90'),
        'top-mid': sgr('┬', '90'),
        'top-left': sgr('┌', '90'),
        'top-right': sgr('┐', '90'),
        'bottom': sgr('─', '90'),
        'bottom-mid': sgr('┴', '90'),
        'bottom-left': sgr('└', '90'),
        'bottom-right': sgr('┘', '90'),
        'left': sgr('│', '90'),
        'right': sgr('│', '90'),
        'middle': sgr('│', '90')
      },
      colWidths: colWidths,
    });

    table.push(...cappedRows);

    return table.toString();
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

function ellipsize(value: string, width: number): string {
  if (width <= 1) return value.slice(0, width);
  return value.slice(0, width - 1) + '…';
}

function tailDisplay(value: string, width: number): string {
  if (width <= 3) return ellipsize(value, width);
  // Show last (width - 3) chars with leading ellipsis
  return '…' + value.slice(-(width - 1));
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