// src/files.ts
import { readdir, readFile, writeFile } from 'fs/promises';
import { join, basename } from 'path';
import matter from 'gray-matter';

export interface FileData {
  id: string;
  filepath: string;
  content: string;
  [key: string]: any;
}

export class FileOps {
  static async readFiles(dir: string): Promise<FileData[]> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const mdFiles = entries.filter(e => e.isFile() && e.name.endsWith('.md'));
      
      const files: FileData[] = [];
      
      for (const entry of mdFiles) {
        const filepath = join(dir, entry.name);
        const content = await readFile(filepath, 'utf-8');
        const { data } = matter(content);
        
        // Ensure id is string for consistent comparison
        const id = data.id?.toString() || basename(entry.name, '.md');
        
        // Spread data first, then override id to ensure string type
        files.push({
          ...data,
          id,
          filepath,
          content
        });
      }
      
      return files;
    } catch (error) {
      return [];
    }
  }

  static async writeFile(
    dir: string,
    data: Record<string, any>,
    content: string
  ): Promise<void> {
    const id = data.id?.toString() || '0';
    const filepath = join(dir, `task-${id.padStart(3, '0')}.md`);
    
    const fileContent = `---
${Object.entries(data)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join('\n')}
---

${content}`;
    
    await writeFile(filepath, fileContent, 'utf-8');
  }
}
