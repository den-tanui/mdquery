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
    // In a real implementation, this would copy to clipboard
    // For now, just return the value
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

  static projectName(context?: Record<string, any>): string {
    return context?.projectTitle || '';
  }

  static call(name: string, args: any[], context?: Record<string, any>, enumValues?: string[]): any {
    const builtin = (this as any)[name];
    if (!builtin) {
      throw new Error(`Unknown builtin: ${name}`);
    }
    
    if (name === 'project' || name === 'sprint') {
      return builtin(args[0], context || {});
    }
    
    if (name === 'id') {
      return builtin(context);
    }
    
    if (name === 'user') {
      return builtin(context);
    }
    
    if (name === 'nextEnum' || name === 'prevEnum') {
      return builtin(args[0], enumValues || []);
    }
    
    if (name === 'nextDate') {
      return builtin(args[0]);
    }
    
    if (name === 'projectName') {
      return builtin(context);
    }
    
    return builtin(...args);
  }
}
