// src/executor.ts
import { Parser } from './parser';
import { FileOps, FileData } from './files';
import { ASTNode, SelectNode, UpdateNode, CreateNode, DeleteNode, WhereNode, ValueNode } from './types';

export interface QueryResult {
  type: 'select' | 'update' | 'create' | 'delete';
  data?: FileData[];
  count?: number;
  updated?: number;
  created?: number;
  deleted?: number;
}

export class Executor {
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
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
      default:
        throw new Error(`Unknown AST type: ${(ast as any).type}`);
    }
  }

  private async executeSelect(node: SelectNode): Promise<QueryResult> {
    let files = await FileOps.readFiles(this.dir);

    // WHERE
    if (node.where) {
      files = files.filter(f => this.evaluateWhere(f, node.where!));
    }

    // GROUP BY
    if (node.groupBy) {
      files = this.groupBy(files, node.groupBy);
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

    // Select specific fields
    if (node.fields[0] !== '*' && !node.fields.some(f => typeof f === 'object')) {
      files = files.map(f => {
        const selected: any = {};
        for (const field of node.fields) {
          if (typeof field === 'string') {
            selected[field] = f[field];
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

  private async executeUpdate(node: UpdateNode): Promise<QueryResult> {
    const files = await FileOps.readFiles(this.dir);
    let updated = 0;

    for (const file of files) {
      if (node.where && !this.evaluateWhere(file, node.where)) {
        continue;
      }

      // Update fields
      for (const [key, value] of Object.entries(node.set)) {
        (file as any)[key] = this.evaluateValue(value);
      }

      // Write back
      await FileOps.writeFile(this.dir, file, file.content);
      updated++;
    }

    return {
      type: 'update',
      updated
    };
  }

  private async executeCreate(node: CreateNode): Promise<QueryResult> {
    const newFile: any = {
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Set fields
    for (const [key, value] of Object.entries(node.fields)) {
      newFile[key] = this.evaluateValue(value);
    }

    await FileOps.writeFile(this.dir, newFile, '');

    return {
      type: 'create',
      created: 1
    };
  }

  private async executeDelete(node: DeleteNode): Promise<QueryResult> {
    const files = await FileOps.readFiles(this.dir);
    let deleted = 0;

    for (const file of files) {
      if (node.where && !this.evaluateWhere(file, node.where)) {
        continue;
      }

      // Delete file
      const { unlink } = await import('fs/promises');
      await unlink(file.filepath);
      deleted++;
    }

    return {
      type: 'delete',
      deleted
    };
  }

  private evaluateWhere(file: FileData, where: WhereNode): boolean {
    switch (where.type) {
      case 'and':
        return this.evaluateWhere(file, where.left as WhereNode) &&
               this.evaluateWhere(file, where.right as WhereNode);
      case 'or':
        return this.evaluateWhere(file, where.left as WhereNode) ||
               this.evaluateWhere(file, where.right as WhereNode);
      case 'comparison':
        return this.evaluateComparison(file, where.field!, where.op!, where.value!);
      default:
        return false;
    }
  }

  private evaluateComparison(file: FileData, field: string, op: string, value: ValueNode): boolean {
    const fieldValue = (file as any)[field];
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
    // Simple implementation - just sort by group fields
    return files.sort((a, b) => {
      for (const field of fields) {
        const aVal = (a as any)[field] || '';
        const bVal = (b as any)[field] || '';
        if (aVal !== bVal) {
          return aVal < bVal ? -1 : 1;
        }
      }
      return 0;
    });
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
