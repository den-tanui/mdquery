// src/formatter.ts
import { QueryResult } from './executor';

export type OutputFormat = 'json' | 'table' | 'csv';

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

  private static toTable(result: QueryResult): string {
    if (!result.data || result.data.length === 0) {
      return 'No results';
    }

    const headers = Object.keys(result.data[0]);
    const rows = result.data.map(row => headers.map(h => String((row as any)[h] || '')));
    
    // Calculate column widths
    const widths = headers.map((h, i) => 
      Math.max(h.length, ...rows.map(r => r[i]?.length || 0))
    );
    
    // Build table
    const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join(' | ');
    const separator = widths.map(w => '-'.repeat(w)).join(' | ');
    const dataLines = rows.map(row => row.map((cell, i) => cell.padEnd(widths[i])).join(' | '));
    
    return [headerLine, separator, ...dataLines].join('\n');
  }

  private static toCSV(result: QueryResult): string {
    if (!result.data || result.data.length === 0) {
      return '';
    }

    const headers = Object.keys(result.data[0]);
    const rows = result.data.map(row => 
      headers.map(h => {
        const val = String((row as any)[h] || '');
        return val.includes(',') ? `"${val}"` : val;
      }).join(',')
    );
    
    return [headers.join(','), ...rows].join('\n');
  }
}
