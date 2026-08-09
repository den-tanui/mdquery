// src/executor.ts
import { Parser } from './parser';
import { FileOps, FileData, ReadOptions } from './files';
import { isAbsolute, join } from 'path';
import { ASTNode, SelectNode, UpdateNode, CreateNode, DeleteNode, WhereNode, ValueNode } from './types';

export interface QueryResult {
  type: 'select' | 'update' | 'create' | 'delete';
  data?: FileData[];
  count?: number;
  updated?: number;
  created?: number;
  deleted?: number;
}

export interface TriggerContext {
  old?: FileData;
  new?: FileData;
}

export class Executor {
  private dir: string;
  private context?: Record<string, any>;
  private triggerContext?: TriggerContext;
  private readOptions: ReadOptions;

  constructor(
    dir: string,
    context?: Record<string, any>,
    triggerContext?: TriggerContext,
    readOptions: ReadOptions = {}
  ) {
    this.dir = dir;
    this.context = context;
    this.triggerContext = triggerContext;
    this.readOptions = readOptions;
  }

  async execute(query: string): Promise<QueryResult> {
    const ast = new Parser(query).parse();
    return this.executeAST(ast);
  }

  private async executeAST(ast: ASTNode): Promise<QueryResult> {
    switch (ast.type) {
      case 'select':
        return this.executeSelect(ast);
      case 'update':
        return this.executeUpdate(ast);
      case 'create':
        return this.executeCreate(ast);
      case 'delete':
        return this.executeDelete(ast);
      case 'pipe':
        return this.executePipe(ast);
      default:
        throw new Error(`Unknown AST type: ${(ast as any).type}`);
    }
  }

  private async executePipe(node: any): Promise<QueryResult> {
    const result = await this.executeAST(node.expr);
    
    // Handle clipboard function
    if (node.fn === 'clipboard' && result.data) {
      const values = result.data.map((f: any) => f.filename || f.title || '').join('\n');
      await navigator.clipboard?.writeText(values);
    }
    
    return result;
  }

  private async executeSelect(node: SelectNode): Promise<QueryResult> {
    let files = await FileOps.readFiles(this.dir, this.readOptions);

    // WHERE
    if (node.where) {
      files = files.filter(f => this.evaluateWhere(f, node.where!));
    }

    // GROUP BY
    if (node.groupBy) {
      files = this.groupBy(files, node.groupBy);
    }

    // HAVING
    if (node.having) {
      files = files.filter(f => this.evaluateWhere(f, node.having!));
    }

    // ORDER BY
    if (node.orderBy) {
      files = this.orderBy(files, node.orderBy);
    }

    // LIMIT
    if (node.limit) {
      files = files.slice(0, node.limit);
    }

    // OFFSET
    if (node.offset) {
      files = files.slice(node.offset);
    }

    // JOIN
    if (node.join) {
      files = await this.executeJoin(files, node.join);
    }

    // DISTINCT
    if (node.distinct) {
      files = this.distinct(files, node.fields);
    }

    // Select specific fields (handle aggregates)
    const hasAggregates = node.fields.some(f => typeof f === 'object' && f.type === 'aggregate');
    if (node.fields[0] !== '*' || hasAggregates) {
      files = files.map(f => {
        const selected: any = {};
        for (const field of node.fields) {
          if (typeof field === 'string') {
            selected[field] = (f as any)[field];
          } else if (typeof field === 'object' && field.type === 'aggregate') {
            // Aggregate fields are already computed by groupBy
            const key = `${field.func}(${field.field})`;
            selected[key] = (f as any)[key];
          }
        }
        return selected;
      });
    }

    return {
      type: 'select',
      data: files,
      count: files.length
    };
  }

  private distinct(files: FileData[], fields: (string | any)[]): FileData[] {
    const seen = new Set<string>();
    return files.filter(f => {
      const key = fields.map(field => {
        if (typeof field === 'string') {
          return String((f as any)[field]);
        }
        if (typeof field === 'object' && field.type === 'aggregate') {
          return `${field.func}(${field.field})`;
        }
        return '';
      }).join('|');
      
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private async executeJoin(files: FileData[], join: any): Promise<FileData[]> {
    // Load the joined table
    const joinedFiles = await FileOps.readFiles(join.table);
    
    // Perform the join
    const result: FileData[] = [];
    
    for (const file of files) {
      for (const joined of joinedFiles) {
        // Create a merged file-like object
        const merged: any = { ...file };
        
        // Add joined fields with prefix
        for (const [key, value] of Object.entries(joined)) {
          if (key !== 'id' && key !== 'filepath' && key !== 'content') {
            merged[`${join.table}.${key}`] = value;
          }
        }
        
        // Check ON condition
        if (this.evaluateWhere(merged as FileData, join.on)) {
          result.push(merged as FileData);
        }
      }
    }
    
    return result;
  }

  private async executeUpdate(node: UpdateNode): Promise<QueryResult> {
    const files = await FileOps.readFiles(this.dir, this.readOptions);
    const matches = node.where
      ? files.filter(f => this.evaluateWhere(f, node.where))
      : files;

    if (matches.length === 0) {
      throw new Error(this.noMatchError(node.where));
    }

    for (const file of matches) {
      // Update fields
      for (const [key, value] of Object.entries(node.set)) {
        (file as any)[key] = this.evaluateValue(value);
      }

      // Write back to the original file path
      await FileOps.writeFile(file.filepath, file, file.content);
    }

    return {
      type: 'update',
      updated: matches.length
    };
  }

  private async executeCreate(node: CreateNode): Promise<QueryResult> {
    const newFile: any = {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Set fields
    for (const [key, value] of Object.entries(node.fields)) {
      newFile[key] = this.evaluateValue(value);
    }

    // Determine target: abspath > path > file/filename > error
    let target: string;
    if (newFile.abspath) {
      target = newFile.abspath;
    } else if (newFile.path) {
      target = this.resolveTargetPath(newFile.path);
    } else if (newFile.file || newFile.filename) {
      target = this.dir;
    } else {
      throw new Error('create requires path to file');
    }

    await FileOps.writeFile(target, newFile, '');

    return {
      type: 'create',
      created: 1
    };
  }

  private async executeDelete(node: DeleteNode): Promise<QueryResult> {
    const files = await FileOps.readFiles(this.dir, this.readOptions);
    const matches = node.where ? files.filter(f => this.evaluateWhere(f, node.where)) : files;

    if (matches.length === 0) {
      throw new Error(this.noMatchError(node.where));
    }

    for (const file of matches) {
      // Delete file
      const { unlink } = await import('fs/promises');
      await unlink(file.filepath);
    }

    return {
      type: 'delete',
      deleted: matches.length
    };
  }

  private noMatchError(where?: WhereNode): string {
    if (where && where.type === 'comparison' && where.field) {
      const value = where.value && where.value.type === 'string' ? where.value.value : '';
      return `no file with ${where.field} '${value}'`;
    }
    return 'no files matched the query';
  }

  private resolveTargetPath(p: string): string {
    if (isAbsolute(p)) return p;
    return join(this.dir, p);
  }

  private evaluateWhere(file: FileData, where: WhereNode): boolean {
    switch (where.type) {
      case 'and':
        return this.evaluateWhere(file, where.left as WhereNode) &&
               this.evaluateWhere(file, where.right as WhereNode);
      case 'or':
        return this.evaluateWhere(file, where.left as WhereNode) ||
               this.evaluateWhere(file, where.right as WhereNode);
      case 'not':
        return !this.evaluateWhere(file, where.expr as WhereNode);
      case 'comparison':
        return this.evaluateComparison(file, where.field!, where.op!, where.value!, where.fieldPath);
      case 'array_comparison':
        return this.evaluateArrayComparison(file, where.field!, where.arrayOp!, where.arrayCondition!);
      default:
        return false;
    }
  }

  private evaluateArrayComparison(file: FileData, field: string, arrayOp: string, condition: WhereNode): boolean {
    const arrayValue = (file as any)[field];
    
    if (!Array.isArray(arrayValue)) {
      return false;
    }

    if (arrayOp === 'any') {
      return arrayValue.some((item: any) => {
        // For string arrays, create a temp file with a special value field
        // For object arrays, spread the item properties
        const tempFile = typeof item === 'object' 
          ? { ...file, ...item }
          : { ...file, _value: item };
        
        // If the condition has an empty field, use _value
        if (condition.type === 'comparison' && condition.field === '') {
          const tempCondition = { ...condition, field: '_value', fieldPath: '_value' };
          return this.evaluateWhere(tempFile, tempCondition);
        }
        
        return this.evaluateWhere(tempFile, condition);
      });
    }

    if (arrayOp === 'all') {
      return arrayValue.every((item: any) => {
        const tempFile = typeof item === 'object'
          ? { ...file, ...item }
          : { ...file, _value: item };
        
        if (condition.type === 'comparison' && condition.field === '') {
          const tempCondition = { ...condition, field: '_value', fieldPath: '_value' };
          return this.evaluateWhere(tempFile, tempCondition);
        }
        
        return this.evaluateWhere(tempFile, condition);
      });
    }

    return false;
  }

  private evaluateComparison(file: FileData, field: string, op: string, value: ValueNode, fieldPath?: string): boolean {
    // Handle aggregate functions in comparisons (e.g., count(*) > 1)
    const aggregateMatch = field.match(/^(count|sum|avg|min|max)\((.+)\)$/);
    if (aggregateMatch) {
      const [, func, aggField] = aggregateMatch;
      const compareValue = this.evaluateValue(value);
      
      // For aggregated comparisons, we need to evaluate against grouped data
      // This is a simplified version - in production, you'd want to handle this more robustly
      const fieldValue = (file as any)[field] || (file as any)[`${func}(${aggField})`];
      
      if (fieldValue === undefined) return false;
      
      const coercedFieldValue = typeof fieldValue === 'string' ? Number(fieldValue) : fieldValue;
      const coercedCompareValue = typeof compareValue === 'string' ? Number(compareValue) : compareValue;
      
      switch (op) {
        case '=': return coercedFieldValue === coercedCompareValue;
        case '!=': return coercedFieldValue !== coercedCompareValue;
        case '<': return coercedFieldValue < coercedCompareValue;
        case '>': return coercedFieldValue > coercedCompareValue;
        case '<=': return coercedFieldValue <= coercedCompareValue;
        case '>=': return coercedFieldValue >= coercedCompareValue;
        default: return false;
      }
    }

    // Handle trigger variables (new.field, old.field)
    let fieldValue: any;
    if (fieldPath && this.triggerContext) {
      const [prefix, ...rest] = fieldPath.split('.');
      const fieldName = rest.join('.');
      if (prefix === 'new' && this.triggerContext.new) {
        fieldValue = (this.triggerContext.new as any)[fieldName];
      } else if (prefix === 'old' && this.triggerContext.old) {
        fieldValue = (this.triggerContext.old as any)[fieldName];
      } else {
        fieldValue = (file as any)[field];
      }
    } else {
      fieldValue = (file as any)[field];
    }

    const compareValue = this.evaluateValue(value);

    // Type coercion for comparison
    let coercedFieldValue = fieldValue;
    let coercedCompareValue = compareValue;
    
    // Convert to same type for comparison
    if (typeof fieldValue === 'string' && typeof compareValue === 'number') {
      coercedFieldValue = Number(fieldValue);
    } else if (typeof fieldValue === 'number' && typeof compareValue === 'string') {
      coercedCompareValue = Number(compareValue);
    }

    switch (op) {
      case '=':
        return coercedFieldValue === coercedCompareValue;
      case '!=':
        return coercedFieldValue !== coercedCompareValue;
      case '<':
        return coercedFieldValue < coercedCompareValue;
      case '>':
        return coercedFieldValue > coercedCompareValue;
      case '<=':
        return coercedFieldValue <= coercedCompareValue;
      case '>=':
        return coercedFieldValue >= coercedCompareValue;
      case 'contains':
        return String(fieldValue).includes(String(compareValue));
      case 'starts_with':
        return String(fieldValue).startsWith(String(compareValue));
      case 'ends_with':
        return String(fieldValue).endsWith(String(compareValue));
      case 'is_empty':
        return !fieldValue || fieldValue === '';
      case 'is_not_empty':
        return fieldValue && fieldValue !== '';
      default:
        return false;
    }
  }

  private evaluateValue(value: ValueNode): any {
    if (value.type === 'string') return value.value;
    if (value.type === 'number') return value.value;
    if (value.type === 'boolean') return value.value;
    if (value.type === 'null') return null;
    return value;
  }

  private groupBy(files: FileData[], fields: string[]): FileData[] {
    // Group files by the specified fields and calculate aggregates
    const groups = new Map<string, FileData[]>();
    
    for (const file of files) {
      const key = fields.map(f => String((file as any)[f])).join('|');
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(file);
    }
    
    // Convert groups to aggregated results
    const result: FileData[] = [];
    for (const [, groupFiles] of groups) {
      const aggregated: any = { ...groupFiles[0] };
      
      // Calculate count
      aggregated['count(*)'] = groupFiles.length;
      
      // Store the count for each field
      for (const field of fields) {
        aggregated[`count(${field})`] = groupFiles.length;
      }
      
      result.push(aggregated as FileData);
    }
    
    return result;
  }

  private orderBy(files: FileData[], orderBy: { field: string; direction: 'asc' | 'desc' }[]): FileData[] {
    return files.sort((a, b) => {
      for (const { field, direction } of orderBy) {
        const aVal = (a as any)[field] || '';
        const bVal = (b as any)[field] || '';
        
        if (aVal === bVal) continue;
        
        const compare = aVal < bVal ? -1 : 1;
        return direction === 'asc' ? compare : -compare;
      }
      return 0;
    });
  }
}
