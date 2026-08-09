// tests/formatters.test.ts
import { describe, it, expect } from 'vitest';
import { Formatter } from '../src/formatter';
import { QueryResult } from '../src/executor';

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
      expect(parsed).toHaveLength(2);
      expect(parsed[0].title).toBe('Test Task');
    });
  });

  describe('Table', () => {
    it('formats as table', () => {
      const output = Formatter.format(mockResult, 'table');
      expect(output).toContain('id');
      expect(output).toContain('title');
      expect(output).toContain('Test Task');
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
      expect(output).toContain('id');
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
      // 10 columns: minimum is 10 chars + 9 separators * 3 = 37
      const output = Formatter.toTable(wideResult, 40);
      const longestLine = Math.max(...output.split('\n').map(l => l.length));
      expect(longestLine).toBeLessThanOrEqual(40);
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
