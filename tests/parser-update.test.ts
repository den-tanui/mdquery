// tests/parser-update.test.ts
import { describe, it, expect } from 'vitest';
import { Parser } from '../src/parser';

describe('Parser - UPDATE/CREATE/DELETE', () => {
  describe('UPDATE', () => {
    it('parses update with where and set', () => {
      const ast = new Parser('update where status = "todo" set status = "doing"').parse();
      expect(ast).toEqual({
        type: 'update',
        where: { type: 'comparison', field: 'status', fieldPath: 'status', op: '=', value: { type: 'string', value: 'todo' } },
        set: { status: { value: { type: 'string', value: 'doing' } } }
      });
    });

    it('parses update with multiple set fields', () => {
      const ast = new Parser('update where id = 1 set status = "done" assignee = "jane"').parse();
      expect(ast).toEqual({
        type: 'update',
        where: { type: 'comparison', field: 'id', fieldPath: 'id', op: '=', value: { type: 'number', value: 1 } },
        set: {
          status: { value: { type: 'string', value: 'done' } },
          assignee: { value: { type: 'string', value: 'jane' } }
        }
      });
    });

    it('parses update with numeric value', () => {
      const ast = new Parser('update where id = 1 set priority = 5').parse();
      expect(ast).toEqual({
        type: 'update',
        where: { type: 'comparison', field: 'id', fieldPath: 'id', op: '=', value: { type: 'number', value: 1 } },
        set: { priority: { value: { type: 'number', value: 5 } } }
      });
    });

    it('parses update with boolean value', () => {
      const ast = new Parser('update where id = 1 set completed = true').parse();
      expect(ast).toEqual({
        type: 'update',
        where: { type: 'comparison', field: 'id', fieldPath: 'id', op: '=', value: { type: 'number', value: 1 } },
        set: { completed: { value: { type: 'boolean', value: true } } }
      });
    });

    it('parses update with type annotation', () => {
      const ast = new Parser('update where id = 1 set status:str = "doing"').parse();
      expect(ast).toEqual({
        type: 'update',
        where: { type: 'comparison', field: 'id', fieldPath: 'id', op: '=', value: { type: 'number', value: 1 } },
        set: { status: { value: { type: 'string', value: 'doing' }, type: 'str' } }
      });
    });
  });

  describe('CREATE', () => {
    it('parses create with fields', () => {
      const ast = new Parser('create title = "My Task" status = "todo"').parse();
      expect(ast).toEqual({
        type: 'create',
        fields: {
          title: { value: { type: 'string', value: 'My Task' } },
          status: { value: { type: 'string', value: 'todo' } }
        }
      });
    });

    it('parses create with mixed field types', () => {
      const ast = new Parser('create title = "Task" priority = 3 completed = false').parse();
      expect(ast).toEqual({
        type: 'create',
        fields: {
          title: { value: { type: 'string', value: 'Task' } },
          priority: { value: { type: 'number', value: 3 } },
          completed: { value: { type: 'boolean', value: false } }
        }
      });
    });

    it('parses create with type annotations', () => {
      const ast = new Parser('create title:str = "Task" priority:int = 5 status:str = "todo"').parse();
      expect(ast).toEqual({
        type: 'create',
        fields: {
          title: { value: { type: 'string', value: 'Task' }, type: 'str' },
          priority: { value: { type: 'number', value: 5 }, type: 'int' },
          status: { value: { type: 'string', value: 'todo' }, type: 'str' }
        }
      });
    });
  });

  describe('DELETE', () => {
    it('parses delete with where', () => {
      const ast = new Parser('delete where status = "done"').parse();
      expect(ast).toEqual({
        type: 'delete',
        where: { type: 'comparison', field: 'status', fieldPath: 'status', op: '=', value: { type: 'string', value: 'done' } }
      });
    });

    it('parses delete with complex where', () => {
      const ast = new Parser('delete where projectId = 1 and status = "done"').parse();
      expect(ast).toEqual({
        type: 'delete',
        where: {
          type: 'and',
          left: { type: 'comparison', field: 'projectId', fieldPath: 'projectId', op: '=', value: { type: 'number', value: 1 } },
          right: { type: 'comparison', field: 'status', fieldPath: 'status', op: '=', value: { type: 'string', value: 'done' } }
        }
      });
    });
  });
});
