// tests/formatters.test.ts
import { describe, it, expect } from 'vitest';
import { Formatter, OutputFormat } from '../src/formatter';
import { QueryResult } from '../src/types';

describe('Formatter', () => {
  const mockResult: QueryResult = {
    type: 'select',
    data: [
      { id: '1', title: 'Test Task', status: 'todo', priority: 3, filename: '', path: '', abspath: '', filepath: '', content: '' },
      { id: '2', title: 'Another Task', status: 'done', priority: 5, filename: '', path: '', abspath: '', filepath: '', content: '' }
    ],
    count: 2
  };

  describe('JSON', () => {
    it('formats as JSON', () => {
      const output = Formatter.format(mockResult, 'json');
      const parsed = JSON.parse(output);
      expect(parsed.type).toBe('select');
      expect(parsed.data).toHaveLength(2);
      expect(parsed.data[0].title).toBe('Test Task');
    });

    it('emits the full QueryResult object including meta', () => {
      const result: QueryResult = {
        type: 'select',
        data: [{ title: 'A' }],
        count: 1,
        meta: { filesSearched: 2, filesMatched: 1, timings: { list: 1, read: 2, prefilter: 0, evaluate: 1, total: 4 }, errors: [] }
      };
      const output = Formatter.format(result, 'json');
      const parsed = JSON.parse(output);
      expect(parsed.type).toBe('select');
      expect(parsed.data).toHaveLength(1);
      expect(parsed.count).toBe(1);
      expect(parsed.meta.filesSearched).toBe(2);
    });
  });

  describe('Table', () => {
    it('formats as table', () => {
      const output = Formatter.toTable(mockResult, 120);
      expect(output).toContain('ID');
      expect(output).toContain('TITLE');
      expect(output).toContain('Test Task');
      expect(output).toContain('┌');
      expect(output).toContain('│');
      // Border between items: row separator present
      expect(output).toContain('├');
    });

    it('shrinks wide columns to fit terminal width', () => {
      const wideResult: QueryResult = {
        type: 'select',
        data: [
          { id: '1', description: 'a very long description that keeps going and going', filename: '', path: '', abspath: '', filepath: '', content: '' },
          { id: '2', description: 'another lengthy value exceeding the width limit here too', filename: '', path: '', abspath: '', filepath: '', content: '' }
        ],
        count: 2
      };

      const width = 40;
      const output = Formatter.toTable(wideResult, width);
      const longestLine = Math.max(...output.split('\n').map(l => l.length));
      expect(longestLine).toBeLessThanOrEqual(width);
    });

    it('does not shrink when content fits the width', () => {
      const smallResult: QueryResult = {
        type: 'select',
        data: [{ id: '1', title: 'hi', filename: '', path: '', abspath: '', filepath: '', content: '' }],
        count: 1
      };
      const output = Formatter.toTable(smallResult, 200);
      expect(output).toContain('ID');
      expect(output).toContain('hi');
      expect(output).not.toContain('…');
    });

    it('always fits width even with many columns', () => {
      const wideResult: QueryResult = {
        type: 'select',
        data: [
          {
            id: '1',
            filename: '',
            path: '',
            abspath: '',
            filepath: '',
            content: '',
            one: 'x'.repeat(100),
            two: 'x'.repeat(100),
            three: 'x'.repeat(100),
            four: 'x'.repeat(100)
          }
        ],
        count: 1
      };
      // 10 columns: cli-table3 minimum is 10 chars content + 10*2 padding + 11 borders = 41
      const output = Formatter.toTable(wideResult, 45);
      const longestLine = Math.max(...output.split('\n').map(l => l.length));
      expect(longestLine).toBeLessThanOrEqual(45);
    });

    it('wraps long content instead of truncating', () => {
      const longContentResult: QueryResult = {
        type: 'select',
        data: [
          { id: '1', content: 'This is a very long content that should be truncated to 20 chars', filename: '', path: '', abspath: '', filepath: '' }
        ],
        count: 1
      };
      const output = Formatter.toTable(longContentResult, 200);
      // Full content shown (fits at this width), no ellipsis truncation
      expect(output).toContain('This is a very long content that should be truncated to 20 chars');
      expect(output).not.toContain('…');
    });

    it('wraps long abspath instead of truncating', () => {
      const longAbspathResult: QueryResult = {
        type: 'select',
        data: [
          { id: '1', abspath: '/home/projects/mdquery-repo/tests/fixtures/advanced/task-001.md', filename: '', path: '', filepath: '', content: '' }
        ],
        count: 1
      };
      const output = Formatter.toTable(longAbspathResult, 200);
      // Full path shown (fits at this width), no ellipsis truncation
      expect(output).toContain('/home/projects/mdquery-repo/tests/fixtures/advanced/task-001.md');
      expect(output).not.toContain('…');
    });

    it('wraps long text within the column instead of truncating', () => {
      const result: QueryResult = {
        type: 'select',
        data: [
          { id: '1', description: 'a very long description that keeps going and going and going and going' }
        ],
        count: 1
      };
      const width = 40;
      const output = Formatter.toTable(result, width);
      const longestLine = Math.max(...output.split('\n').map(l => l.length));
      expect(longestLine).toBeLessThanOrEqual(width);
      // Full text present across wrapped lines (borders/padding stripped), no ellipsis
      expect(output).not.toContain('…');
      const stripped = output.replace(/[^a-z]/gi, '');
      expect(stripped).toContain('averylongdescriptionthatkeepsgoingandgoingandgoingandgoing');
    });

    it('hard-breaks long unbroken words (paths) within the column', () => {
      const result: QueryResult = {
        type: 'select',
        data: [
          { id: '1', abspath: '/home/projects/mdquery-repo/tests/fixtures/advanced/task-001.md' }
        ],
        count: 1
      };
      const width = 40;
      const output = Formatter.toTable(result, width);
      const longestLine = Math.max(...output.split('\n').map(l => l.length));
      expect(longestLine).toBeLessThanOrEqual(width);
      // Full path present across wrapped lines, no ellipsis
      expect(output).not.toContain('…');
      const stripped = output.replace(/[^a-z0-9/._-]/gi, '');
      expect(stripped).toContain('/home/projects/mdquery-repo/tests/fixtures/advanced/task-001.md');
    });

    it('prevents column squashing with fallback cap', () => {
      const squashingResult: QueryResult = {
        type: 'select',
        data: [
          { id: '1', title: 'Short', filename: '', path: '', abspath: '', filepath: '', content: 'x'.repeat(500) }
        ],
        count: 1
      };
      const output = Formatter.toTable(squashingResult, 100);
      // Title should not be squashed to 3 chars
      const lines = output.split('\n');
      const dataLine = lines[3]; // First data line (after top border, header, separator)
      expect(dataLine).toContain('Short');
    });

    it('colorize false produces clean output', () => {
      const output = Formatter.toTable(mockResult, 120, { colorize: false });
      expect(output).not.toMatch(/\x1b\[/);
    });

    it('colorize true wraps titles and border in SGR codes', () => {
      const output = Formatter.toTable(mockResult, 120, { colorize: true });
      expect(output).toMatch(/\x1b\[01;34m/);  // title color
      expect(output).toMatch(/\x1b\[90m/);     // border color
    });

    it('uses custom colors from the colors map', () => {
      const colors = new Map<string, string>([['title', '31'], ['border', '32']]);
      const output = Formatter.toTable(mockResult, 120, { colorize: true, colors });
      expect(output).toMatch(/\x1b\[31m/);  // title red
      expect(output).toMatch(/\x1b\[32m/);  // border green
      expect(output).not.toMatch(/\x1b\[01;34m/);  // default title not used
    });

    it('compact mode drops row separators and tightens padding', () => {
      const output = Formatter.toTable(mockResult, 120, { compact: true });
      // No row separators between data rows
      expect(output).not.toContain('├');
      expect(output).not.toContain('┼');
      // Header directly above first data row (no separator line)
      expect(output).toContain('│TITLE');
      // Data still present
      expect(output).toContain('Test Task');
      expect(output).toContain('Another Task');
    });

    it('maxLinesPerRecord caps each record at one line', () => {
      const result: QueryResult = {
        type: 'select',
        data: [{ id: '1', title: 'x'.repeat(300) }],
        count: 1
      };
      const output = Formatter.toTable(result, 120, { maxLinesPerRecord: 1 });
      // data row is a single line (no wrapped continuation lines)
      const dataLines = output.split('\n').filter(l => l.includes('x'));
      expect(dataLines).toHaveLength(1);
      expect(output).toContain('…');
    });

    it('maxLinesPerRecord 2 keeps two lines with ellipsis', () => {
      const result: QueryResult = {
        type: 'select',
        data: [{ id: '1', title: 'x'.repeat(300) }],
        count: 1
      };
      const output = Formatter.toTable(result, 120, { maxLinesPerRecord: 2 });
      const dataLines = output.split('\n').filter(l => l.includes('x'));
      expect(dataLines).toHaveLength(2);
      expect(output).toContain('…');
    });

    it('columnWidths honors fixed char widths and auto-fills the rest', () => {
      const result: QueryResult = {
        type: 'select',
        data: [
          { id: '1', title: 'Alpha', description: 'short' },
          { id: '2', title: 'Beta', description: 'a much longer description here' }
        ],
        count: 2
      };
      const output = Formatter.toTable(result, 80, {
        columnWidths: [{ kind: 'chars', value: 20 }, { kind: 'auto' }, { kind: 'chars', value: 10 }]
      });
      // Fixed widths honored: title column is 20 chars wide
      const headerLine = output.split('\n')[1];
      expect(headerLine).toContain('TITLE');
      // Auto column gets the remaining space; full text present (wrapped)
      const stripped = output.replace(/[^a-z]/gi, '');
      expect(stripped).toContain('amuchlongerdescriptionhere');
    });

    it('columnWidths resolves percentages against the usable width', () => {
      const result: QueryResult = {
        type: 'select',
        data: [
          { id: '1', title: 'Alpha', description: 'short' }
        ],
        count: 1
      };
      const output = Formatter.toTable(result, 100, {
        columnWidths: [{ kind: 'pct', value: 25 }, { kind: 'pct', value: 75 }]
      });
      // 25% of usable (100 - 7 = 93) = 23 chars for title
      const headerLine = output.split('\n')[1];
      expect(headerLine).toContain('TITLE');
      expect(headerLine.length).toBeLessThanOrEqual(100);
    });
  });

  describe('CSV', () => {
    it('formats as CSV', () => {
      const output = Formatter.format(mockResult, 'csv');
      const lines = output.split('\n');
      expect(lines[0]).toContain('id');
      expect(lines[1]).toContain('1');
      expect(lines[1]).toContain('Test Task');
    });

    it('quotes fields containing commas, quotes, and newlines (RFC 4180)', () => {
      const result: QueryResult = {
        type: 'select',
        data: [
          { title: 'a,b', note: 'line1\nline2' },
          { title: 'plain', note: 'has "quotes"' }
        ],
        count: 2
      };
      const output = Formatter.format(result, 'csv');
      expect(output).toContain('"a,b"');
      expect(output).toContain('"line1\nline2"');
      expect(output).toContain('"has ""quotes"""');
    });

    it('escapes formula injection', () => {
      const result: QueryResult = {
        type: 'select',
        data: [{ title: '=SUM(A1:A2)' }],
        count: 1
      };
      const output = Formatter.format(result, 'csv');
      expect(output).toContain("'=SUM(A1:A2)");
    });
  });

  describe('Card removed', () => {
    it('rejects card as an OutputFormat at type level (compile-time) and throws at runtime', () => {
      // @ts-expect-error card is no longer a valid OutputFormat
      const bad: OutputFormat = 'card';
      expect(() => Formatter.format(mockResult, bad)).toThrow(/Unknown format/);
    });
  });

  describe('UPDATE result', () => {
    it('formats update result', () => {
      const result: QueryResult = { type: 'update', updated: 3 };
      const output = Formatter.format(result, 'json');
      expect(output).toContain('3');
    });
  });

  describe('CREATE result', () => {
    it('formats create result', () => {
      const result: QueryResult = { type: 'create', created: 1 };
      const output = Formatter.format(result, 'json');
      expect(output).toContain('1');
    });
  });

  describe('DELETE result', () => {
    it('formats delete result', () => {
      const result: QueryResult = { type: 'delete', deleted: 2 };
      const output = Formatter.format(result, 'json');
      expect(output).toContain('2');
    });
  });
});
