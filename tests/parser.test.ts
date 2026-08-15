// tests/parser.test.ts
import { describe, it, expect } from 'vitest';
import { Parser } from '../src/parser';

describe('Parser', () => {
  describe('SELECT', () => {
    it('parses select all', () => {
      const ast = new Parser('select').parse();
      expect(ast).toEqual({ type: 'select', fields: [{ type: 'wildcard' }] });
    });

    it('parses select with specific fields', () => {
      const ast = new Parser('select id, title, status').parse();
      expect(ast).toEqual({
        type: 'select',
        fields: [{ type: 'field', name: 'id' }, { type: 'field', name: 'title' }, { type: 'field', name: 'status' }]
      });
    });

    it('parses select with where', () => {
      const ast = new Parser('select where status = "done"').parse();
      expect(ast).toEqual({
        type: 'select',
        fields: [{ type: 'wildcard' }],
        where: {
          type: 'binary_op',
          left: { type: 'field', name: 'status' },
          op: '=',
          right: { type: 'string', value: 'done' }
        }
      });
    });

    it('parses select with and/or conditions', () => {
      const ast = new Parser('select where status = "done" and assignee = "jane"').parse();
      expect(ast).toEqual({
        type: 'select',
        fields: [{ type: 'wildcard' }],
        where: {
          type: 'binary_op',
          left: {
            type: 'binary_op',
            left: { type: 'field', name: 'status' },
            op: '=',
            right: { type: 'string', value: 'done' }
          },
          op: 'AND',
          right: {
            type: 'binary_op',
            left: { type: 'field', name: 'assignee' },
            op: '=',
            right: { type: 'string', value: 'jane' }
          }
        }
      });
    });

    it('parses select with order by', () => {
      const ast = new Parser('select order by priority desc').parse();
      expect(ast).toEqual({
        type: 'select',
        fields: [{ type: 'wildcard' }],
        orderBy: [{ field: { type: 'field', name: 'priority' }, direction: 'desc' }]
      });
    });

    it('parses select with limit', () => {
      const ast = new Parser('select order by priority limit 10').parse();
      expect(ast).toEqual({
        type: 'select',
        fields: [{ type: 'wildcard' }],
        orderBy: [{ field: { type: 'field', name: 'priority' }, direction: 'asc' }],
        limit: 10
      });
    });

    it('parses select with group by', () => {
      const ast = new Parser('select status, count(*) group by status').parse();
      expect(ast).toEqual({
        type: 'select',
        fields: [
          { type: 'field', name: 'status' },
          { type: 'function_call', name: 'count', args: [{ type: 'wildcard' }] }
        ],
        groupBy: ['status']
      });
    });

    it('parses select with count(*)', () => {
      const ast = new Parser('select count(*) where projectId = 1').parse();
      expect(ast).toEqual({
        type: 'select',
        fields: [{ type: 'function_call', name: 'count', args: [{ type: 'wildcard' }] }],
        where: {
          type: 'binary_op',
          left: { type: 'field', name: 'projectId' },
          op: '=',
          right: { type: 'number', value: 1 }
        }
      });
    });
  });
});
