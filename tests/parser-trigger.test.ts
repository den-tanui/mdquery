// tests/parser-trigger.test.ts
import { describe, it, expect } from 'vitest';
import { Parser } from '../src/parser';

describe('Parser - Triggers', () => {
  describe('BEFORE/AFTER triggers', () => {
    it('parses before create trigger with deny', () => {
      const ast = new Parser('before create where status = "done" deny "Cannot create done task"').parse();
      expect(ast).toEqual({
        type: 'trigger',
        event: 'before',
        operation: 'create',
        where: { type: 'comparison', field: 'status', fieldPath: 'status', op: '=', value: { type: 'string', value: 'done' } },
        action: { type: 'deny', message: 'Cannot create done task' }
      });
    });

    it('parses before update trigger with deny', () => {
      const ast = new Parser('before update where projectId != 1 deny "Wrong project"').parse();
      expect(ast).toEqual({
        type: 'trigger',
        event: 'before',
        operation: 'update',
        where: { type: 'comparison', field: 'projectId', fieldPath: 'projectId', op: '!=', value: { type: 'number', value: 1 } },
        action: { type: 'deny', message: 'Wrong project' }
      });
    });

    it('parses after create trigger with update', () => {
      const ast = new Parser('after create set completed = true').parse();
      expect(ast).toEqual({
        type: 'trigger',
        event: 'after',
        operation: 'create',
        action: { type: 'update', set: { completed: { value: { type: 'boolean', value: true } } } }
      });
    });

    it('parses after update trigger with run', () => {
      const ast = new Parser('after update run "echo done"').parse();
      expect(ast).toEqual({
        type: 'trigger',
        event: 'after',
        operation: 'update',
        action: { type: 'run', command: 'echo done' }
      });
    });
  });
});
