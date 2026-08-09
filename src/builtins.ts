// src/builtins.ts
import { formatTocIndented, Section } from './files';

export class Builtins {
  static now(): string {
    return new Date().toISOString();
  }

  static today(): string {
    return new Date().toISOString().split('T')[0];
  }

  static len(value: any): number {
    if (typeof value === 'string') return value.length;
    if (Array.isArray(value)) return value.length;
    return 0;
  }

  static upper(value: string): string {
    return value.toUpperCase();
  }

  static lower(value: string): string {
    return value.toLowerCase();
  }

  static trim(value: string): string {
    return value.trim();
  }

  static contains(value: string, substring: string): boolean {
    return value.includes(substring);
  }

  static startsWith(value: string, prefix: string): boolean {
    return value.startsWith(prefix);
  }

  static endsWith(value: string, suffix: string): boolean {
    return value.endsWith(suffix);
  }

  static split(value: string, delimiter: string): string[] {
    return value.split(delimiter);
  }

  static join(array: string[], delimiter: string): string {
    return array.join(delimiter);
  }

  static id(context?: Record<string, any>): string {
    return context?.id || '';
  }

  static user(context?: Record<string, any>): string {
    return context?.user || process.env.USER || process.env.USERNAME || 'unknown';
  }

  static date(dateString: string): string {
    return new Date(dateString).toISOString();
  }

  static nextEnum(fieldValue: string, enumValues: string[]): string {
    const currentIndex = enumValues.indexOf(fieldValue);
    if (currentIndex === -1 || currentIndex === enumValues.length - 1) {
      return enumValues[0];
    }
    return enumValues[currentIndex + 1];
  }

  static prevEnum(fieldValue: string, enumValues: string[]): string {
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
        if (!isNaN(days)) {
          now.setDate(now.getDate() + days);
        }
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
    
    // Return flat list with indentation
    return formatTocIndented(sections).split('\n');
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
