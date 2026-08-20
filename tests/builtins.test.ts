// tests/builtins.test.ts
import { describe, expect, it } from 'vitest';
import { Builtins } from '../src/builtins';

describe('Builtins', () => {
  describe('now()', () => {
    it('returns current datetime', () => {
      const result = Builtins.now();
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(new Date(result).getTime()).not.toBeNaN();
    });
  });

  describe('today()', () => {
    it('returns current date', () => {
      const result = Builtins.today();
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(new Date(result).getTime()).not.toBeNaN();
    });
  });

  describe('len()', () => {
    it('returns string length', () => {
      const result = Builtins.len('hello');
      expect(result).toBe(5);
    });

    it('returns array length', () => {
      const result = Builtins.len([1, 2, 3]);
      expect(result).toBe(3);
    });
  });

  describe('upper()', () => {
    it('converts to uppercase', () => {
      const result = Builtins.upper('hello');
      expect(result).toBe('HELLO');
    });
  });

  describe('lower()', () => {
    it('converts to lowercase', () => {
      const result = Builtins.lower('HELLO');
      expect(result).toBe('hello');
    });
  });

  describe('trim()', () => {
    it('trims whitespace', () => {
      const result = Builtins.trim('  hello  ');
      expect(result).toBe('hello');
    });
  });

  describe('contains()', () => {
    it('checks if string contains substring', () => {
      expect(Builtins.contains('hello world', 'world')).toBe(true);
      expect(Builtins.contains('hello world', 'foo')).toBe(false);
    });
  });

  describe('startsWith()', () => {
    it('checks if string starts with prefix', () => {
      expect(Builtins.startsWith('hello world', 'hello')).toBe(true);
      expect(Builtins.startsWith('hello world', 'world')).toBe(false);
    });
  });

  describe('endsWith()', () => {
    it('checks if string ends with suffix', () => {
      expect(Builtins.endsWith('hello world', 'world')).toBe(true);
      expect(Builtins.endsWith('hello world', 'hello')).toBe(false);
    });
  });

  describe('split()', () => {
    it('splits string by delimiter', () => {
      const result = Builtins.split('a,b,c', ',');
      expect(result).toEqual(['a', 'b', 'c']);
    });
  });

  describe('join()', () => {
    it('joins array with delimiter', () => {
      const result = Builtins.join(['a', 'b', 'c'], ',');
      expect(result).toBe('a,b,c');
    });
  });

  describe('trimAll()', () => {
    it('replaces presentation-breaking chars with spaces', () => {
      expect(Builtins.trimAll('a\nb\tc|d')).toBe('a b c d');
      expect(Builtins.trimAll('line1\u2028line2')).toBe('line1 line2');
    });
  });

  describe('replace()', () => {
    it('replaces all occurrences of a substring', () => {
      expect(Builtins.replace('a-b-c', '-', '_')).toBe('a_b_c');
      expect(Builtins.replace('hello world', 'o', '0')).toBe('hell0 w0rld');
    });

    it('requires string args', () => {
      expect(() => Builtins.replace(42 as any, 'a', 'b')).toThrow('replace() requires a string');
    });
  });

  describe('capitalize()', () => {
    it('uppercases the first letter of each word, lowercases the rest', () => {
      expect(Builtins.capitalize('setup guide')).toBe('Setup Guide');
      expect(Builtins.capitalize('SETUP GUIDE')).toBe('Setup Guide');
      expect(Builtins.capitalize('hello')).toBe('Hello');
    });

    it('does not touch separators (title normalization is formatter-side)', () => {
      expect(Builtins.capitalize('some-text')).toBe('Some-text');
      expect(Builtins.capitalize('some_title')).toBe('Some_title');
    });
  });

  describe('camelCase()', () => {
    it('strips separators and camelCases', () => {
      expect(Builtins.camelCase('setup guide')).toBe('setupGuide');
      expect(Builtins.camelCase('setup_guide')).toBe('setupGuide');
      expect(Builtins.camelCase('setup-guide')).toBe('setupGuide');
      expect(Builtins.camelCase('setupGuide')).toBe('setupGuide');
    });
  });

  describe('pascalCase()', () => {
    it('camelCases with the first letter up', () => {
      expect(Builtins.pascalCase('setup guide')).toBe('SetupGuide');
      expect(Builtins.pascalCase('setup_guide')).toBe('SetupGuide');
      expect(Builtins.pascalCase('setup-guide')).toBe('SetupGuide');
    });
  });

  describe('sentence()', () => {
    it('uppercases only the first letter of the first word', () => {
      expect(Builtins.sentence('setup guide')).toBe('Setup guide');
      expect(Builtins.sentence('SETUP GUIDE')).toBe('Setup guide');
    });
  });

  describe('snakeCase()', () => {
    it('lowercases and joins with underscores', () => {
      expect(Builtins.snakeCase('Setup Guide')).toBe('setup_guide');
      expect(Builtins.snakeCase('setup-guide')).toBe('setup_guide');
      expect(Builtins.snakeCase('setupGuide')).toBe('setup_guide');
    });
  });

  describe('kebabCase()', () => {
    it('lowercases and joins with hyphens', () => {
      expect(Builtins.kebabCase('Setup Guide')).toBe('setup-guide');
      expect(Builtins.kebabCase('setup_guide')).toBe('setup-guide');
      expect(Builtins.kebabCase('setupGuide')).toBe('setup-guide');
    });
  });
});
