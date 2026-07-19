// tests/parser.test.ts
import { describe, it, expect } from 'vitest';
import { Parser } from '../src/parser';

describe('Parser', () => {
  describe('SELECT', () => {
    it('parses select all', () => {
      const ast = new Parser('select').parse();
      expect(ast).toEqual({ type: 'select', fields: ['*'] });
    });

    it('parses select with specific fields', () => {
      const ast = new Parser('select id, title, status').parse();
      expect(ast).toEqual({ type: 'select', fields: ['id', 'title', 'status'] });
    });

    it('parses select with where', () => {
      const ast = new Parser('select where status = "done"').parse();
      expect(ast).toEqual({
        type: 'select',
        fields: ['*'],
        where: { type: 'comparison', field: 'status', fieldPath: 'status', op: '=', value: { type: 'string', value: 'done' } }
      });
    });

    it('parses select with and/or conditions', () => {
      const ast = new Parser('select where status = "done" and assignee = "jane"').parse();
      expect(ast).toEqual({
        type: 'select',
        fields: ['*'],
        where: {
          type: 'and',
          left: { type: 'comparison', field: 'status', fieldPath: 'status', op: '=', value: { type: 'string', value: 'done' } },
          right: { type: 'comparison', field: 'assignee', fieldPath: 'assignee', op: '=', value: { type: 'string', value: 'jane' } }
        }
      });
    });

    it('parses select with order by', () => {
      const ast = new Parser('select order by priority desc').parse();
      expect(ast).toEqual({
        type: 'select',
        fields: ['*'],
        orderBy: [{ field: 'priority', direction: 'desc' }]
      });
    });

    it('parses select with limit', () => {
      const ast = new Parser('select order by priority limit 10').parse();
      expect(ast).toEqual({
        type: 'select',
        fields: ['*'],
        orderBy: [{ field: 'priority', direction: 'asc' }],
        limit: 10
      });
    });

    it('parses select with group by', () => {
      const ast = new Parser('select status, count(*) group by status').parse();
      expect(ast).toEqual({
        type: 'select',
        fields: ['status', { type: 'aggregate', func: 'count', field: '*' }],
        groupBy: ['status']
      });
    });

    it('parses select with count(*)', () => {
      const ast = new Parser('select count(*) where projectId = 1').parse();
      expect(ast).toEqual({
        type: 'select',
        fields: [{ type: 'aggregate', func: 'count', field: '*' }],
        where: { type: 'comparison', field: 'projectId', fieldPath: 'projectId', op: '=', value: { type: 'number', value: 1 } }
      });
    });
  });
});
