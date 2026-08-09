// src/formatter.ts
import { QueryResult } from './executor';

export type OutputFormat = 'json' | 'table' | 'csv';

const MIN_COLUMN_WIDTH = 3;
const DEFAULT_TERMINAL_WIDTH = 80;

export class Formatter {
  static format(result: QueryResult, format: OutputFormat): string {
    switch (format) {
      case 'json':
        return this.toJSON(result);
      case 'table':
        return this.toTable(result);
      case 'csv':
        return this.toCSV(result);
      default:
        return this.toJSON(result);
    }
  }

  static toTable(result: QueryResult, terminalWidth: number = 0): string {
    if (!result.data || result.data.length === 0) {
      return 'No results';
    }

    const width = terminalWidth > 0 ? terminalWidth : defaultWidth();

    const headers = Object.keys(result.data[0]);
    const rows = result.data.map(row => headers.map(h => String((row as any)[h] ?? '')));

    // Natural column widths
    const rawWidths = headers.map((h, i) =>
      Math.max(h.length, ...rows.map(r => r[i]?.length || 0))
    );

    // " | " separator costs 3 chars between columns
    const separators = headers.length > 0 ? (headers.length - 1) * 3 : 0;
    const totalRaw = rawWidths.reduce((a, b) => a + b, 0) + separators;

    let widths: number[];
    if (totalRaw <= width) {
      widths = rawWidths;
    } else {
      widths = this.shrink(rawWidths, width - separators);
    }

    const headerLine = headers.map((h, i) => pad(h, widths[i])).join(' | ');
    const separatorLine = widths.map(w => '-'.repeat(w)).join(' | ');
    const dataLines = rows.map(row =>
      row.map((cell, i) => pad(cell, widths[i])).join(' | ')
    );

    return [headerLine, separatorLine, ...dataLines].join('\n');
  }

  private static shrink(rawWidths: number[], budget: number): number[] {
    const n = rawWidths.length;
    if (n === 0) return [];
    const rawTotal = rawWidths.reduce((a, b) => a + b, 0);

    const scaled = rawWidths.map(w =>
      w <= MIN_COLUMN_WIDTH ? w : Math.max(MIN_COLUMN_WIDTH, Math.floor((w / rawTotal) * budget))
    );

    if (sum(scaled) <= budget) return scaled;

    // Reduce below the minimum (down to 1) until we fit the budget.
    let over = sum(scaled) - budget;
    while (over > 0) {
      let candidate = -1;
      for (let i = 0; i < n; i++) {
        if (scaled[i] > 1 && (candidate === -1 || scaled[i] > scaled[candidate])) {
          candidate = i;
        }
      }
      if (candidate === -1) break;
      scaled[candidate]--;
      over--;
    }

    return scaled;
  }

  private static toJSON(result: QueryResult): string {
    if (result.data) {
      return JSON.stringify(result.data, null, 2);
    }

    const summary: any = {};
    if (result.updated !== undefined) summary.updated = result.updated;
    if (result.created !== undefined) summary.created = result.created;
    if (result.deleted !== undefined) summary.deleted = result.deleted;
    if (result.count !== undefined) summary.count = result.count;

    return JSON.stringify(summary, null, 2);
  }

  private static toCSV(result: QueryResult): string {
    if (!result.data || result.data.length === 0) {
      return '';
    }

    const headers = Object.keys(result.data[0]);
    const rows = result.data.map(row =>
      headers.map(h => {
        const val = String((row as any)[h] ?? '');
        return val.includes(',') ? `"${val}"` : val;
      }).join(',')
    );

    return [headers.join(','), ...rows].join('\n');
  }
}

function pad(value: string, width: number): string {
  return value.length > width ? ellipsize(value, width) : value.padEnd(width);
}

function ellipsize(value: string, width: number): string {
  if (width <= 1) return value.slice(0, width);
  return value.slice(0, width - 1) + '…';
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