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
      default:
        // Try to parse as days
        const days = parseInt(recurrence);
        if (isNaN(days)) {
          throw new TypeError(`next_date() requires a valid recurrence string (daily, weekly, monthly, yearly, or N days), got "${recurrence}"`);
        }
        now.setDate(now.getDate() + days);
    }
    
    return now.toISOString().split('T')[0];
  }

  static fields(context?: Record<string, any>, includeValues?: boolean): string[] | Record<string, any> {
    if (!context) return includeValues ? {} : [];
    
    // Filter out internal fields
    const internalFields = ['filename', 'path', 'abspath', 'filepath', 'content', 'sections'];
    const fields = Object.keys(context).filter(key => !internalFields.includes(key));
    
    if (includeValues) {
      const result: Record<string, any> = {};
      for (const key of fields) {
        result[key] = context[key];
      }
      return result;
    }
    
    return fields;
  }

  static toc(context?: Record<string, any>, structured?: boolean): string[] | Section[] {
    if (!context?.sections) return [];
    
    const sections: Section[] = Array.from(context.sections.values());
    
    if (structured) {
      return sections;
    }
    
    // Return flat list with heading markers
    return sections.map(s => '#'.repeat(s.level) + ' ' + s.title);
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

  static call(name: string, args: any[], context?: Record<string, any>, enumValues?: string[], hooks?: { onBuiltinCall?: (name: string, args: any[], context?: Record<string, any>) => any }): any {
    // Try camelCase version first, then snake_case
    let builtin = (this as any)[name];
    let normalizedName = name;
    
    if (!builtin && name.includes('_')) {
      // Convert snake_case to camelCase
      normalizedName = name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      builtin = (this as any)[normalizedName];
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
      
      if (normalizedName === 'fields' || normalizedName === 'toc') {
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
