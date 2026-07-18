// tests/builtins-extended.test.ts
import { describe, it, expect } from 'vitest';
import { Builtins } from '../src/builtins';

describe('Builtins - Extended', () => {
  describe('id()', () => {
    it('returns id from context', () => {
      const result = Builtins.id({ id: 'TASK-000001' });
      expect(result).toBe('TASK-000001');
    });

    it('returns empty string when no context', () => {
      const result = Builtins.id();
      expect(result).toBe('');
    });
  });

  describe('user()', () => {
    it('returns user from context', () => {
      const result = Builtins.user({ user: 'jane_doe' });
      expect(result).toBe('jane_doe');
    });

    it('falls back to environment variable', () => {
      const result = Builtins.user();
      expect(typeof result).toBe('string');
    });
  });

  describe('date()', () => {
    it('parses date string', () => {
      const result = Builtins.date('2026-12-31');
      expect(result).toBe('2026-12-31T00:00:00.000Z');
    });

    it('parses datetime string', () => {
      const result = Builtins.date('2026-07-18T10:30:00Z');
      expect(result).toBe('2026-07-18T10:30:00.000Z');
    });
  });

  describe('nextEnum()', () => {
    it('returns next enum value', () => {
      const enumValues = ['backlog', 'ready', 'inProgress', 'done'];
      expect(Builtins.nextEnum('backlog', enumValues)).toBe('ready');
      expect(Builtins.nextEnum('ready', enumValues)).toBe('inProgress');
      expect(Builtins.nextEnum('done', enumValues)).toBe('backlog');
    });

    it('handles unknown value', () => {
      const enumValues = ['backlog', 'ready', 'inProgress', 'done'];
      expect(Builtins.nextEnum('unknown', enumValues)).toBe('backlog');
    });
  });

  describe('prevEnum()', () => {
    it('returns previous enum value', () => {
      const enumValues = ['backlog', 'ready', 'inProgress', 'done'];
      expect(Builtins.prevEnum('done', enumValues)).toBe('inProgress');
      expect(Builtins.prevEnum('inProgress', enumValues)).toBe('ready');
      expect(Builtins.prevEnum('backlog', enumValues)).toBe('done');
    });

    it('handles unknown value', () => {
      const enumValues = ['backlog', 'ready', 'inProgress', 'done'];
      expect(Builtins.prevEnum('unknown', enumValues)).toBe('done');
    });
  });

  describe('clipboard()', () => {
    it('returns value', () => {
      const result = Builtins.clipboard('hello');
      expect(result).toBe('hello');
    });
  });
});
