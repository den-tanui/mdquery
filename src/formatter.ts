// src/formatter.ts
import { QueryResult } from './executor';
import { formatTocAsTree, Section } from './files';

export type OutputFormat = 'json' | 'table' | 'csv' | 'card';

const MIN_COLUMN_WIDTH = 3;
const DEFAULT_TERMINAL_WIDTH = 80;

// Semantic caps for known fields — fixed widths for predictable display
const SEMANTIC_CAPS: Record<string, number> = {
  content: 20,   // First line + ellipsis
  abspath: 24,   // Tail: .../filename.md
};

export class Formatter {
  static format(result: QueryResult, format: OutputFormat): string {
    switch (format) {
      case 'json':
        return this.toJSON(result);
      case 'table':
        return this.toTable(result);
      case 'card':
        return this.toCard(result);
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
    const rows = result.data.map(row => headers.map(h => {
      const value = (row as any)[h];
      // Format toc and section fields specially
      if (h === 'toc' || h.startsWith('section.')) {
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

    // " | " separator costs 3 chars between columns
    const separators = headers.length > 0 ? (headers.length - 1) * 3 : 0;
    const usable = width - separators;

    // Apply semantic caps to natural widths
    const cappedWidths = naturalWidths.map((w, i) => {
      const cap = SEMANTIC_CAPS[headers[i]];
      return cap !== undefined ? Math.min(w, cap) : w;
    });

    let widths: number[];
    if (sum(cappedWidths) <= usable) {
      widths = cappedWidths;
    } else {
      widths = this.allocateWidths(cappedWidths, usable);
    }

    const headerLine = headers.map((h, i) => pad(h, widths[i])).join(' | ');
    const separatorLine = widths.map(w => '-'.repeat(w)).join(' | ');
    const dataLines = cappedRows.map(row =>
      row.map((cell, i) => pad(cell, widths[i])).join(' | ')
    );

    return [headerLine, separatorLine, ...dataLines].join('\n');
  }

  static toCard(result: QueryResult, terminalWidth: number = 0): string {
    if (!result.data || result.data.length === 0) {
      return 'No results';
    }

    const width = terminalWidth > 0 ? terminalWidth : defaultWidth();
    const halfWidth = Math.floor(width / 2);

    const headers = Object.keys(result.data[0]);
    const cards: string[] = [];

    for (const row of result.data) {
      const filename = String((row as any).filename ?? 'unknown');
      const content = String((row as any).content ?? '');
      const toc = (row as any).toc;
      const hasExplicitContent = headers.includes('content');
      const hasExplicitToc = headers.includes('toc');

      // Header line
      const cardLines: string[] = [`--- ${filename} ---`];

      // Metadata fields (excluding content and toc)
      const metaFields = headers.filter(h => h !== 'content' && h !== 'toc');
      const metaLines: string[] = [];
      let currentLine = '';

      for (const field of metaFields) {
        const value = String((row as any)[field] ?? '');
        const display = formatFieldValue(field, value);
        const entry = `${field}: ${display}`;

        if (currentLine === '') {
          currentLine = entry;
        } else if ((currentLine + ' | ' + entry).length <= width) {
          currentLine += ' | ' + entry;
        } else {
          metaLines.push(currentLine);
          currentLine = entry;
        }
      }

      if (currentLine !== '') {
        metaLines.push(currentLine);
      }

      // Check for field overflow: any field exceeding half width gets its own line
      const expandedLines: string[] = [];
      for (const line of metaLines) {
        if (line.length > halfWidth) {
          // Split into individual fields
          const fields = line.split(' | ');
          for (const field of fields) {
            if (field.length > halfWidth) {
              // This field gets its own line
              expandedLines.push(field);
            } else {
              // Try to pack with next field
              expandedLines.push(field);
            }
          }
        } else {
          expandedLines.push(line);
        }
      }

      cardLines.push(...expandedLines);

      // TOC block
      if (hasExplicitToc && toc) {
        cardLines.push('');  // Empty line before TOC
        cardLines.push('toc:');
        cardLines.push(formatTocForCard(toc));
      }

      // Content block
      if (hasExplicitContent) {
        cardLines.push('');  // Empty line before content
        if (content.trim() === '') {
          cardLines.push('');  // Empty line for empty content when explicitly selected
        } else {
          cardLines.push(content);
        }
      } else if (content.trim() !== '') {
        cardLines.push('');  // Empty line before content
        cardLines.push(content);
      }

      cards.push(cardLines.join('\n'));
    }

    return cards.join('\n\n');
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

function tailDisplay(value: string, width: number): string {
  if (width <= 3) return ellipsize(value, width);
  // Show last (width - 3) chars with leading ellipsis
  return '…' + value.slice(-(width - 1));
}

function formatFieldValue(field: string, value: string): string {
  // Handle arrays
  if (value.startsWith('[') && value.endsWith(']')) {
    return value;
  }
  // Handle objects
  if (value.startsWith('{') && value.endsWith('}')) {
    return value;
  }
  // Handle multiline content
  if (value.includes('\n')) {
    const firstLine = value.split('\n')[0];
    return firstLine.length > 60 ? ellipsize(firstLine, 60) : firstLine;
  }
  return value;
}

function formatTocForTable(value: any): string {
  if (!Array.isArray(value)) return String(value);
  
  // Handle structured TOC (array of Section objects)
  if (value.length > 0 && value[0]?.level !== undefined) {
    return value.map((s: any) => '  '.repeat(s.level - 1) + s.title).join('\n');
  }
  
  // Handle flat TOC (already formatted with indentation)
  return value.join('\n');
}

function formatTocForCard(value: any): string {
  if (!Array.isArray(value)) return String(value);
  
  // Handle structured TOC (array of Section objects)
  if (value.length > 0 && value[0]?.level !== undefined) {
    return formatTocAsTree(value.map((s: any) => ({ level: s.level, title: s.title, content: '' })));
  }
  
  // Handle flat TOC (already formatted with indentation)
  return value.join('\n');
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