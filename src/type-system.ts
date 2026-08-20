// src/type-system.ts

import { FileData } from './files';

// Type parsing and validation utilities
export class TypeSystem {
  // Parse frontmatter values into appropriate types
  static parseValue(value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value !== 'string') {
      return value;
    }

    // Try to parse as date
    const date = TypeSystem.tryParseDate(value);
    if (date) return date;

    // Try to parse as number
    const number = TypeSystem.tryParseNumber(value);
    if (number !== null) return number;

    // Try to parse as boolean
    const bool = TypeSystem.tryParseBoolean(value);
    if (bool !== null) return bool;

    // Return as string
    return value;
  }

  // Try to parse as date
  static tryParseDate(value: string): Date | null {
    // ISO date format
    if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/.test(value)) {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }

    // Other common date formats
    const dateFormats = [
      /^\d{4}-\d{2}-\d{2}$/, // YYYY-MM-DD
      /^\d{2}\/\d{2}\/\d{4}$/, // MM/DD/YYYY
      /^\d{4}\/\d{2}\/\d{2}$/, // YYYY/MM/DD
      /^\d{1,2}-\d{1,2}-\d{4}$/, // M-D-YYYY
    ];

    for (const format of dateFormats) {
      if (format.test(value)) {
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }
    }

    return null;
  }

  // Try to parse as number
  static tryParseNumber(value: string): number | null {
    if (/^-?\d+(\.\d+)?$/.test(value)) {
      const num = parseFloat(value);
      if (!isNaN(num)) {
        return num;
      }
    }
    return null;
  }

  // Try to parse as boolean
  static tryParseBoolean(value: string): boolean | null {
    const lower = value.toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
    return null;
  }

  // Parse all frontmatter values in a file
  static parseFrontmatter(file: FileData): FileData {
    const parsedFrontmatter: Record<string, any> = {};

    for (const [key, value] of Object.entries(file.frontmatter || {})) {
      parsedFrontmatter[key] = TypeSystem.parseValue(value);
    }

    return {
      ...file,
      frontmatter: parsedFrontmatter,
    };
  }

  // Validate type for a value
  static validateType(value: any, expectedType: string): boolean {
    switch (expectedType.toLowerCase()) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number';
      case 'boolean':
        return typeof value === 'boolean';
      case 'date':
        return value instanceof Date;
      case 'array':
        return Array.isArray(value);
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      default:
        return true; // Unknown type, don't validate
    }
  }

  // Convert value to expected type
  static convertType(value: any, targetType: string): any {
    if (value === null || value === undefined) {
      return value;
    }

    switch (targetType.toLowerCase()) {
      case 'string':
        return TypeSystem.convertToString(value);
      case 'number':
        return TypeSystem.convertToNumber(value);
      case 'boolean':
        return TypeSystem.convertToBoolean(value);
      case 'date':
        return TypeSystem.convertToDate(value);
      case 'array':
        return TypeSystem.convertToArray(value);
      default:
        return value;
    }
  }

  // Convert to string
  static convertToString(value: any): string {
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return value.join(',');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  // Convert to number
  static convertToNumber(value: any): number | null {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return TypeSystem.tryParseNumber(value);
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (value instanceof Date) return value.getTime();
    return null;
  }

  // Convert to boolean
  static convertToBoolean(value: any): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      if (lower === 'true') return true;
      if (lower === 'false') return false;
      if (lower === '1' || lower === 'yes' || lower === 'on') return true;
      if (lower === '0' || lower === 'no' || lower === 'off') return false;
    }
    if (typeof value === 'number') return value !== 0;
    if (value instanceof Date) return !isNaN(value.getTime());
    return Boolean(value);
  }

  // Convert to date
  static convertToDate(value: any): Date | null {
    if (value instanceof Date) return value;
    if (typeof value === 'string') return TypeSystem.tryParseDate(value);
    if (typeof value === 'number') return new Date(value);
    return null;
  }

  // Convert to array
  static convertToArray(value: any): any[] {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return value.split(',').map((item) => item.trim());
    if (value === null || value === undefined) return [];
    return [value];
  }

  // Type-specific operator behavior
  static evaluateComparison(op: string, left: any, right: any): boolean {
    // Convert both values to dates if either is a date
    const leftDate = TypeSystem.convertToDate(left);
    const rightDate = TypeSystem.convertToDate(right);

    if (leftDate && rightDate) {
      return TypeSystem.evaluateDateComparison(op, leftDate, rightDate);
    }

    // String comparisons
    if (typeof left === 'string' && typeof right === 'string') {
      return TypeSystem.evaluateStringComparison(op, left, right);
    }

    // Numeric comparisons
    const leftNum = TypeSystem.convertToNumber(left);
    const rightNum = TypeSystem.convertToNumber(right);
    if (leftNum !== null && rightNum !== null) {
      return TypeSystem.evaluateNumericComparison(op, leftNum, rightNum);
    }

    // Boolean comparisons
    const leftBool = TypeSystem.convertToBoolean(left);
    const rightBool = TypeSystem.convertToBoolean(right);
    if (typeof leftBool === 'boolean' && typeof rightBool === 'boolean') {
      return TypeSystem.evaluateBooleanComparison(op, leftBool, rightBool);
    }

    // Mixed type comparisons
    return TypeSystem.evaluateMixedComparison(op, left, right);
  }

  // Date comparison
  static evaluateDateComparison(op: string, left: Date, right: Date): boolean {
    const leftTime = left.getTime();
    const rightTime = right.getTime();

    switch (op) {
      case '=':
        return leftTime === rightTime;
      case '!=':
        return leftTime !== rightTime;
      case '>':
        return leftTime > rightTime;
      case '<':
        return leftTime < rightTime;
      case '>=':
        return leftTime >= rightTime;
      case '<=':
        return leftTime <= rightTime;
      default:
        throw new Error(`Unsupported date comparison operator: ${op}`);
    }
  }

  // String comparison
  static evaluateStringComparison(op: string, left: string, right: string): boolean {
    switch (op) {
      case '=':
        return left === right;
      case '!=':
        return left !== right;
      case 'CONTAINS':
        return left.includes(right);
      case 'STARTS_WITH':
        return left.startsWith(right);
      case 'ENDS_WITH':
        return left.endsWith(right);
      case '>':
        return left > right;
      case '<':
        return left < right;
      case '>=':
        return left >= right;
      case '<=':
        return left <= right;
      default:
        throw new Error(`Unsupported string comparison operator: ${op}`);
    }
  }

  // Numeric comparison
  static evaluateNumericComparison(op: string, left: number, right: number): boolean {
    switch (op) {
      case '=':
        return left === right;
      case '!=':
        return left !== right;
      case '>':
        return left > right;
      case '<':
        return left < right;
      case '>=':
        return left >= right;
      case '<=':
        return left <= right;
      default:
        throw new Error(`Unsupported numeric comparison operator: ${op}`);
    }
  }

  // Boolean comparison
  static evaluateBooleanComparison(op: string, left: boolean, right: boolean): boolean {
    switch (op) {
      case '=':
        return left === right;
      case '!=':
        return left !== right;
      default:
        throw new Error(`Unsupported boolean comparison operator: ${op}`);
    }
  }

  // Mixed type comparison
  static evaluateMixedComparison(op: string, left: any, right: any): boolean {
    // Convert both values to strings for comparison
    const leftStr = TypeSystem.convertToString(left);
    const rightStr = TypeSystem.convertToString(right);

    switch (op) {
      case '=':
        return leftStr === rightStr;
      case '!=':
        return leftStr !== rightStr;
      case 'CONTAINS':
        return leftStr.includes(rightStr);
      case 'STARTS_WITH':
        return leftStr.startsWith(rightStr);
      case 'ENDS_WITH':
        return leftStr.endsWith(rightStr);
      default:
        throw new Error(`Unsupported comparison operator for mixed types: ${op}`);
    }
  }

  // Type-specific arithmetic operations
  static evaluateArithmetic(op: string, left: any, right: any): any {
    // Date arithmetic
    if (left instanceof Date || right instanceof Date) {
      return TypeSystem.evaluateDateArithmetic(op, left, right);
    }
    // Array arithmetic (set semantics)
    if (Array.isArray(left) || Array.isArray(right)) {
      return TypeSystem.evaluateArrayArithmetic(op, left, right);
    }
    // String arithmetic
    if (typeof left === 'string' || typeof right === 'string') {
      return TypeSystem.evaluateStringArithmetic(op, left, right);
    }
    // Numeric arithmetic
    if (typeof left === 'number' && typeof right === 'number') {
      return TypeSystem.evaluateNumericArithmetic(op, left, right);
    }
    // Fallback to string concatenation
    return TypeSystem.convertToString(left) + TypeSystem.convertToString(right);
  }

  // Array arithmetic (set semantics: union, difference, add/remove element)
  static evaluateArrayArithmetic(op: string, left: any, right: any): any {
    // list +/- list → set union/difference
    if (Array.isArray(left) && Array.isArray(right)) {
      if (op === '+') {
        // Union (dedupe)
        return [...new Set([...left, ...right])];
      }
      if (op === '-') {
        // Difference
        return left.filter((item) => !right.includes(item));
      }
      throw new Error(`Cannot apply ${op} to array and array`);
    }
    // list +/- scalar → add/remove element
    if (Array.isArray(left) && !Array.isArray(right)) {
      if (op === '+') {
        return left.includes(right) ? left : [...left, right];
      }
      if (op === '-') {
        return left.filter((item) => item !== right);
      }
      throw new Error(`Cannot apply ${op} to array and ${typeof right}`);
    }
    // scalar + list (string) → list prepend (dedupe)
    if (!Array.isArray(left) && Array.isArray(right) && op === '+' && typeof left === 'string') {
      return right.includes(left) ? right : [left, ...right];
    }
    throw new Error(`Cannot apply ${op} to ${typeof left} and ${typeof right}`);
  }

  // Date arithmetic
  static evaluateDateArithmetic(op: string, left: any, right: any): any {
    const leftDate = TypeSystem.convertToDate(left) || new Date(0);

    if (op === '+') {
      if (typeof right === 'number') {
        // Add milliseconds
        return new Date(leftDate.getTime() + right);
      }
      if (right instanceof Date) {
        // Add two dates (not meaningful, but possible)
        return new Date(leftDate.getTime() + right.getTime());
      }
      if (typeof right === 'string') {
        const rightDate = TypeSystem.convertToDate(right);
        if (rightDate) {
          return new Date(leftDate.getTime() + rightDate.getTime());
        }
      }
    } else if (op === '-') {
      if (typeof right === 'number') {
        // Subtract milliseconds
        return new Date(leftDate.getTime() - right);
      }
      if (right instanceof Date) {
        // Subtract two dates (returns milliseconds difference)
        return leftDate.getTime() - right.getTime();
      }
      if (typeof right === 'string') {
        const rightDate = TypeSystem.convertToDate(right);
        if (rightDate) {
          // Subtract two dates (returns milliseconds difference)
          return leftDate.getTime() - rightDate.getTime();
        }
      }
    }

    throw new Error(`Unsupported date arithmetic operator: ${op}`);
  }

  // String arithmetic
  static evaluateStringArithmetic(op: string, left: any, right: any): any {
    const leftStr = TypeSystem.convertToString(left);
    const rightStr = TypeSystem.convertToString(right);

    if (op === '+') {
      return leftStr + rightStr;
    }

    throw new Error(`Unsupported string arithmetic operator: ${op}`);
  }

  // Numeric arithmetic
  static evaluateNumericArithmetic(op: string, left: number, right: number): number {
    switch (op) {
      case '+':
        return left + right;
      case '-':
        return left - right;
      case '*':
        return left * right;
      case '/':
        return left / right;
      case '%':
        return left % right;
      case '^':
        return left ** right;
      default:
        throw new Error(`Unsupported numeric arithmetic operator: ${op}`);
    }
  }

  // Type-specific unary operations
  static evaluateUnary(op: string, operand: any): any {
    switch (op) {
      case 'NOT':
        return !TypeSystem.convertToBoolean(operand);
      case '-':
        return -TypeSystem.convertToNumber(operand)!;
      case '+':
        return +TypeSystem.convertToNumber(operand)!;
      default:
        throw new Error(`Unsupported unary operator: ${op}`);
    }
  }

  // Type validation for builtin functions
  static validateBuiltinArgs(name: string, args: any[]): boolean {
    switch (name) {
      case 'links':
      case 'images':
      case 'codeblocks':
      case 'section':
      case 'toc':
        return args.length === 0;
      case 'grep':
        return args.length === 1 && args[0] instanceof RegExp;
      case 'content':
        return args.length === 0 || args.length === 2;
      case 'fields':
        return args.length === 0 || args.length === 1;
      default:
        return true;
    }
  }

  // Type validation for method calls
  static validateMethodArgs(object: any, method: string, args: any[]): boolean {
    if (Array.isArray(object)) {
      return TypeSystem.validateArrayMethodArgs(method, args);
    }
    if (typeof object === 'string') {
      return TypeSystem.validateStringMethodArgs(method, args);
    }
    if (typeof object === 'object' && object !== null) {
      return TypeSystem.validateObjectMethodArgs(method, args);
    }
    return true;
  }

  // Validate array method arguments
  static validateArrayMethodArgs(method: string, args: any[]): boolean {
    switch (method) {
      case 'filter':
      case 'map':
      case 'where':
        return args.length === 1;
      case 'sort':
        return args.length === 1;
      case 'slice':
        return args.length === 1 || args.length === 2;
      case 'first':
      case 'last':
      case 'flatten':
      case 'unique':
      case 'count':
        return args.length === 0;
      default:
        return true;
    }
  }

  // Validate string method arguments
  static validateStringMethodArgs(method: string, args: any[]): boolean {
    switch (method) {
      case 'length':
      case 'toLowerCase':
      case 'toUpperCase':
      case 'trim':
        return args.length === 0;
      case 'startsWith':
      case 'endsWith':
      case 'includes':
        return args.length === 1 && typeof args[0] === 'string';
      case 'slice':
        return args.length === 1 || args.length === 2;
      default:
        return true;
    }
  }

  // Validate object method arguments
  static validateObjectMethodArgs(method: string, args: any[]): boolean {
    switch (method) {
      case 'keys':
      case 'values':
      case 'entries':
      case 'length':
        return args.length === 0;
      default:
        return true;
    }
  }
}
