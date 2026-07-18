// tests/formatters.test.ts
import { describe, it, expect } from 'vitest';
import { Formatter } from '../src/formatter';
import { QueryResult } from '../src/executor';

describe('Formatter', () => {
  const mockResult: QueryResult = {
    type: 'select',
    data: [
      { id: '1', title: 'Test Task', status: 'todo', priority: 3 },
      { id: '2', title: 'Another Task', status: 'done', priority: 5 }
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
