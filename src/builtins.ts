// src/builtins.ts
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

  static project(field: string, context: Record<string, any>): any {
    const key = `project${field.charAt(0).toUpperCase() + field.slice(1)}`;
    return context[key];
  }

  static sprint(field: string, context: Record<string, any>): any {
    const key = `sprint${field.charAt(0).toUpperCase() + field.slice(1)}`;
    return context[key];
  }

  static call(name: string, args: any[], context?: Record<string, any>): any {
    const builtin = (this as any)[name];
    if (!builtin) {
      throw new Error(`Unknown builtin: ${name}`);
    }
    
    if (name === 'project' || name === 'sprint') {
      return builtin(args[0], context || {});
    }
    
    return builtin(...args);
  }
}
