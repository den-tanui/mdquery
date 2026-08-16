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

    it('applies semantic cap to content column', () => {
      const longContentResult: QueryResult = {
        type: 'select',
        data: [
          { id: '1', content: 'This is a very long content that should be truncated to 20 chars', filename: '', path: '', abspath: '', filepath: '' }
        ],
        count: 1
      };
      const output = Formatter.toTable(longContentResult, 200);
      // Content should be capped at 20 chars
      expect(output).toContain('This is a very long…');
    });

    it('applies semantic cap to abspath column', () => {
      const longAbspathResult: QueryResult = {
        type: 'select',
        data: [
          { id: '1', abspath: '/home/projects/mdquery-repo/tests/fixtures/advanced/task-001.md', filename: '', path: '', filepath: '', content: '' }
        ],
        count: 1
      };
      const output = Formatter.toTable(longAbspathResult, 200);
      // Abspath should be capped at 24 chars with tail display
      expect(output).toContain('…es/advanced/task-001.md');
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
      const output = Formatter.toTable(mockResult, 120, false);
      expect(output).not.toMatch(/\x1b\[/);
    });

    it('colorize true wraps titles and border in SGR codes', () => {
      const output = Formatter.toTable(mockResult, 120, true);
      expect(output).toMatch(/\x1b\[01;34m/);  // title color
      expect(output).toMatch(/\x1b\[90m/);     // border color
    });

    it('uses custom colors from the colors map', () => {
      const colors = new Map<string, string>([['title', '31'], ['border', '32']]);
      const output = Formatter.toTable(mockResult, 120, true, colors);
      expect(output).toMatch(/\x1b\[31m/);  // title red
      expect(output).toMatch(/\x1b\[32m/);  // border green
      expect(output).not.toMatch(/\x1b\[01;34m/);  // default title not used
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
