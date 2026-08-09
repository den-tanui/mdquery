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
      const output = Formatter.toTable(mockResult, 120);
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
      const dataLine = lines[2]; // First data line
      expect(dataLine).toContain('Short');
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

  describe('Card', () => {
    it('formats as card with metadata (no header when filename is empty)', () => {
      const output = Formatter.toCard(mockResult, 120);
      expect(output).not.toContain('---');
      expect(output).toContain('id: 1');
      expect(output).toContain('title: Test Task');
      expect(output).toContain('status: todo');
    });

    it('shows content block when content is present', () => {
      const contentResult: QueryResult = {
        type: 'select',
        data: [
          { id: '1', title: 'Task', content: 'This is the content body', filename: 'task-001', path: '', abspath: '', filepath: '' }
        ],
        count: 1
      };
      const output = Formatter.toCard(contentResult, 120);
      expect(output).toContain('This is the content body');
    });

    it('skips empty content when not explicitly selected', () => {
      const emptyContentResult: QueryResult = {
        type: 'select',
        data: [
          { id: '1', title: 'Task', content: '', filename: 'task-001', path: '', abspath: '', filepath: '' }
        ],
        count: 1
      };
      const output = Formatter.toCard(emptyContentResult, 120);
      // Should not have empty line after metadata
      expect(output).not.toContain('\n\n\n');
    });

    it('shows empty line when content is explicitly selected and empty', () => {
      const explicitContentResult: QueryResult = {
        type: 'select',
        data: [
          { id: '1', title: 'Task', content: '', filename: 'task-001', path: '', abspath: '', filepath: '' }
        ],
        count: 1
      };
      const output = Formatter.toCard(explicitContentResult, 120);
      // Should have empty line for content
      expect(output).toContain('\n\n');
    });

    it('handles multiline content', () => {
      const multilineResult: QueryResult = {
        type: 'select',
        data: [
          { id: '1', title: 'Task', content: 'Line 1\nLine 2\nLine 3', filename: 'task-001', path: '', abspath: '', filepath: '' }
        ],
        count: 1
      };
      const output = Formatter.toCard(multilineResult, 120);
      expect(output).toContain('Line 1');
      expect(output).toContain('Line 2');
      expect(output).toContain('Line 3');
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
