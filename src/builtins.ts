// src/builtins.ts
import { formatTocIndented, Section } from './files';

function requireString(value: any, fn: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${fn}() requires a string, got ${typeof value}`);
  }
  return value;
}

function requireStringOrArray(value: any, fn: string): string | any[] {
  if (typeof value !== 'string' && !Array.isArray(value)) {
    throw new TypeError(`${fn}() requires a string or array, got ${typeof value}`);
  }
  return value;
}

// Split a string into lowercase words on whitespace, underscores, hyphens, and
// camelCase boundaries: "Setup Guide" / "setup_guide" / "setup-guide" /
// "setupGuide" all → ["setup", "guide"]
function splitWords(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean);
}

export class Builtins {
  static now(): string {
    return new Date().toISOString();
  }

  static today(): string {
    return new Date().toISOString().split('T')[0];
  }

  static len(value: any): number {
    requireStringOrArray(value, 'len');
    if (typeof value === 'string') return value.length;
    return value.length;
  }

  static upper(value: string): string {
    requireString(value, 'upper');
    return value.toUpperCase();
  }

  static lower(value: string): string {
    requireString(value, 'lower');
    return value.toLowerCase();
  }

  static trim(value: string): string {
    requireString(value, 'trim');
    return value.trim();
  }

  static trimAll(value: string): string {
    requireString(value, 'trimAll');
    return value.replace(/[\u0000-\u001f\u2028\u2029\u0085|]/g, ' ');
  }

  // Case-formatting builtins. These are the single source of truth for string
  // case conversion: queries can call them directly and the table formatter
  // uses the same functions for header title-formatting.

  // First letter of each word up, rest down: "setup guide" → "Setup Guide"
  static capitalize(value: string): string {
    requireString(value, 'capitalize');
    return value.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  }

  // Strip separators, camelCase: "setup guide" → "setupGuide"
  static camelCase(value: string): string {
    requireString(value, 'camel_case');
    return splitWords(value)
      .map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .join('');
  }

  // camelCase with the first letter up: "setup guide" → "SetupGuide"
  static pascalCase(value: string): string {
    requireString(value, 'pascal_case');
    return splitWords(value)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join('');
  }

  // First letter of the first word up, rest down: "setup guide" → "Setup guide"
  static sentence(value: string): string {
    requireString(value, 'sentence');
    const s = value.toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // Lowercase, underscore-separated: "Setup Guide" → "setup_guide"
  static snakeCase(value: string): string {
    requireString(value, 'snake_case');
    return splitWords(value).join('_');
  }

  // Lowercase, hyphen-separated: "Setup Guide" → "setup-guide"
  static kebabCase(value: string): string {
    requireString(value, 'kebab_case');
    return splitWords(value).join('-');
  }

  static contains(value: string, substring: string): boolean {
    requireString(value, 'contains');
    return value.includes(substring);
  }

  static startsWith(value: string, prefix: string): boolean {
    requireString(value, 'starts_with');
    return value.startsWith(prefix);
  }

  static endsWith(value: string, suffix: string): boolean {
    requireString(value, 'ends_with');
    return value.endsWith(suffix);
  }

  static split(value: string, delimiter: string): string[] {
    requireString(value, 'split');
    return value.split(delimiter);
  }

  static join(array: string[], delimiter: string): string {
    if (!Array.isArray(array)) {
      throw new TypeError(`join() requires an array, got ${typeof array}`);
    }
    return array.join(delimiter);
  }

  // Replace all occurrences of a substring (String.replaceAll semantics)
  static replace(value: string, search: string, replacement: string): string {
    requireString(value, 'replace');
    requireString(search, 'replace');
    requireString(replacement, 'replace');
    return value.replaceAll(search, replacement);
  }

  static id(context?: Record<string, any>): string {
    return context?.id || '';
  }

  static user(context?: Record<string, any>): string {
    return context?.user || process.env.USER || process.env.USERNAME || 'unknown';
  }

  static date(dateString: string): string {
    requireString(dateString, 'date');
    return new Date(dateString).toISOString();
  }

  static nextEnum(fieldValue: string, enumValues: string[]): string {
    requireString(fieldValue, 'next_enum');
    if (!Array.isArray(enumValues)) {
      throw new TypeError(`next_enum() requires an array of enum values, got ${typeof enumValues}`);
    }
    const currentIndex = enumValues.indexOf(fieldValue);
    if (currentIndex === -1 || currentIndex === enumValues.length - 1) {
      return enumValues[0];
    }
    return enumValues[currentIndex + 1];
  }

  static prevEnum(fieldValue: string, enumValues: string[]): string {
    requireString(fieldValue, 'prev_enum');
    if (!Array.isArray(enumValues)) {
      throw new TypeError(`prev_enum() requires an array of enum values, got ${typeof enumValues}`);
    }
    const currentIndex = enumValues.indexOf(fieldValue);
    if (currentIndex === -1 || currentIndex === 0) {
      return enumValues[enumValues.length - 1];
    }
    return enumValues[currentIndex - 1];
  }

  static clipboard(value: string): string {
    // Clipboard copy is handled by the executor pipe handler
    // This builtin just passes the value through
    return value;
  }

  static nextDate(recurrence: string): string {
    requireString(recurrence, 'next_date');
    // Parse recurrence string and return next date
    // Simple implementation: assumes recurrence is in format "daily", "weekly", "monthly"
    const now = new Date();

    switch (recurrence.toLowerCase()) {
      case 'daily':
        now.setDate(now.getDate() + 1);
        break;
      case 'weekly':
        now.setDate(now.getDate() + 7);
        break;
      case 'monthly':
        now.setMonth(now.getMonth() + 1);
        break;
      case 'yearly':
        now.setFullYear(now.getFullYear() + 1);
        break;
      default: {
        // Try to parse as days
        const days = parseInt(recurrence);
        if (isNaN(days)) {
          throw new TypeError(
            `next_date() requires a valid recurrence string (daily, weekly, monthly, yearly, or N days), got "${recurrence}"`,
          );
        }
        now.setDate(now.getDate() + days);
      }
    }

    return now.toISOString().split('T')[0];
  }

  static fields(
    context?: Record<string, any>,
    includeValues?: boolean,
    pattern?: string,
  ): string[] | Record<string, any> {
    if (!context) return includeValues ? {} : [];

    // Filter out internal fields
    const internalFields = ['filename', 'path', 'abspath', 'filepath', 'content', 'sections'];
    let fields = Object.keys(context).filter((key) => !internalFields.includes(key));

    // Wildcard pattern: fields("*or*") → keys containing "or"
    if (pattern) {
      const matches = Builtins.wildcardMatch(pattern);
      fields = fields.filter((k) => matches(k));
    }

    if (includeValues) {
      const result: Record<string, any> = {};
      for (const key of fields) {
        result[key] = context[key];
      }
      return result;
    }

    return fields;
  }

  // Wildcard matcher: no wildcards → exact; leading * → contains;
  // trailing * → starts_with; both * → contains.
  private static wildcardMatch(pattern: string): (value: string) => boolean {
    if (pattern === '*') return () => true;
    const leading = pattern.startsWith('*');
    const trailing = pattern.endsWith('*');
    if (leading && trailing) {
      const mid = pattern.slice(1, -1);
      return (v) => v.includes(mid);
    }
    if (trailing) {
      const prefix = pattern.slice(0, -1);
      return (v) => v.startsWith(prefix);
    }
    if (leading) {
      const suffix = pattern.slice(1);
      return (v) => v.endsWith(suffix);
    }
    return (v) => v === pattern;
  }

  static toc(context?: Record<string, any>, ...levels: any[]): { level: number; title: string }[] {
    if (!context?.sections) return [];

    const sections: Section[] = Array.from(context.sections.values());

    // Normalize levels to array
    const levelArray = levels.flat().filter((l): l is number => typeof l === 'number');

    // Filter by levels if specified
    const filtered =
      levelArray.length > 0 ? sections.filter((s) => levelArray.includes(s.level)) : sections;

    // Structured entries: {level, title}
    return filtered.map((s) => ({ level: s.level, title: s.title }));
  }

  // outline(depth?) — box-drawing heading tree as a scalar string.
  static outline(context?: Record<string, any>, maxDepth: number = 6): string {
    if (!context?.sections) return '';

    const sections: Section[] = Array.from(
      (context.sections as Map<string, Section>).values(),
    ).filter((s) => s.level <= maxDepth);

    if (sections.length === 0) return '';

    const lines: string[] = [];
    const bars: boolean[] = [];

    sections.forEach((section, i) => {
      const depth = section.level;

      // Whether a following sibling exists at the same level before any
      // lower-level heading.
      let hasNext = false;
      for (let j = i + 1; j < sections.length; j++) {
        if (sections[j].level === depth) {
          hasNext = true;
          break;
        }
        if (sections[j].level < depth) break;
      }

      let prefix = '';
      for (let d = 1; d < depth; d++) {
        prefix += bars[d - 1] ? '│   ' : '    ';
      }
      lines.push(prefix + (hasNext ? '├── ' : '└── ') + section.title);

      bars[depth - 1] = hasNext;
      while (bars.length > depth) bars.pop();
    });

    return lines.join('\n');
  }

  static section(
    context?: Record<string, any>,
    name?: string,
  ): string | Record<string, string> | null {
    if (!context?.sections) return null;

    // If no name provided, return all sections as a map
    if (!name) {
      const result: Record<string, string> = {};
      for (const [key, section] of context.sections) {
        result[key] = section.content;
      }
      return result;
    }

    // Return specific section content
    return context.sections.get(name)?.content || null;
  }

  // Type conversion builtins
  static typeof(value: any): string {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) return 'array';
    if (value instanceof Date) return 'date';
    return typeof value;
  }

  static str(value: any): string {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return JSON.stringify(value);
    return String(value);
  }

  static int(value: any): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return Math.floor(value);
    const n = parseInt(String(value), 10);
    return isNaN(n) ? 0 : n;
  }

  static float(value: any): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return value;
    const n = parseFloat(String(value));
    return isNaN(n) ? 0 : n;
  }

  static bool(value: any): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      return lower === 'true' || lower === '1' || lower === 'yes';
    }
    return Boolean(value);
  }

  static array(value: any): any[] {
    if (Array.isArray(value)) return value;
    if (value === null || value === undefined) return [];
    return [value];
  }

  // Date comparison builtins
  static isBefore(date1: any, date2: any): boolean {
    const d1 = date1 instanceof Date ? date1 : new Date(date1);
    const d2 = date2 instanceof Date ? date2 : new Date(date2);
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return false;
    return d1 < d2;
  }

  static isAfter(date1: any, date2: any): boolean {
    const d1 = date1 instanceof Date ? date1 : new Date(date1);
    const d2 = date2 instanceof Date ? date2 : new Date(date2);
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return false;
    return d1 > d2;
  }

  static daysUntil(date1: any, date2: any): number {
    const d1 = date1 instanceof Date ? date1 : new Date(date1);
    const d2 = date2 instanceof Date ? date2 : new Date(date2);
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 0;
    const diff = d2.getTime() - d1.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  static daysSince(date: any): number {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return 0;
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  // Date formatting builtins
  static dateFormat(date: any, format: string): string {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');

    return format
      .replace('YYYY', String(year))
      .replace('MM', month)
      .replace('DD', day)
      .replace('HH', hours)
      .replace('mm', minutes)
      .replace('ss', seconds);
  }

  static dateAdd(date: any, days: number): Date {
    const d = date instanceof Date ? new Date(date) : new Date(date);
    if (isNaN(d.getTime())) return new Date();
    d.setDate(d.getDate() + days);
    return d;
  }

  static dateSub(date: any, days: number): Date {
    const d = date instanceof Date ? new Date(date) : new Date(date);
    if (isNaN(d.getTime())) return new Date();
    d.setDate(d.getDate() - days);
    return d;
  }

  static call(
    name: string,
    args: any[],
    context?: Record<string, any>,
    enumValues?: string[],
    hooks?: { onBuiltinCall?: (name: string, args: any[], context?: Record<string, any>) => any },
  ): any {
    // Try camelCase version first, then snake_case
    let builtin = (Builtins as any)[name];
    let normalizedName = name;

    if (!builtin && name.includes('_')) {
      // Convert snake_case to camelCase
      normalizedName = name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      builtin = (Builtins as any)[normalizedName];
    }

    // Try built-in methods first
    if (builtin) {
      if (normalizedName === 'id' || normalizedName === 'user') {
        return builtin(context);
      }

      if (normalizedName === 'nextEnum' || normalizedName === 'prevEnum') {
        return builtin(args[0], enumValues || args[1] || []);
      }

      if (normalizedName === 'nextDate') {
        return builtin(args[0]);
      }

      if (normalizedName === 'fields') {
        return builtin(context, args[0], args[1]);
      }

      if (normalizedName === 'section') {
        return builtin(context, args[0]);
      }

      if (normalizedName === 'toc') {
        return builtin(context, ...args);
      }

      if (normalizedName === 'outline') {
        return builtin(context, args[0]);
      }

      return builtin(...args);
    }

    // Try hook for custom builtins (e.g., project(), sprint() in projext)
    if (hooks?.onBuiltinCall) {
      return hooks.onBuiltinCall(name, args, context);
    }

    throw new Error(`Unknown builtin: ${name}`);
  }
}
