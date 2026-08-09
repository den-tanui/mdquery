// src/files.ts
import { readdir, readFile, writeFile } from 'fs/promises';
import { join, basename, dirname, relative, isAbsolute, resolve } from 'path';
import matter from 'gray-matter';
import ignore from 'ignore';

export interface FileData {
  id?: string;
  filename: string;
  path: string;
  abspath: string;
  filepath: string;
  content: string;
  [key: string]: any;
}

export interface ReadOptions {
  depth?: number; // 0 = top level, 1 = one subdir, -1 = infinite
  hidden?: boolean; // include dot-entries (except .git)
  ignore?: boolean; // respect .gitignore (default true)
  files?: string[]; // explicit file list (overrides directory walking)
}

interface IgnoreLayer {
  dir: string;
  ig: ReturnType<typeof ignore>;
}

const DEFAULT_OPTIONS: Required<Omit<ReadOptions, 'files'>> = {
  depth: 0,
  hidden: false,
  ignore: true
};

export class FileOps {
  static async readFiles(dir: string, options: ReadOptions = {}): Promise<FileData[]> {
    if (options.files && options.files.length > 0) {
      const files: FileData[] = [];
      for (const f of options.files) {
        const file = await this.read(dir, f);
        if (file) files.push(file);
      }
      return files;
    }

    const opts = { ...DEFAULT_OPTIONS, ...options };
    const files: FileData[] = [];
    await this.walk(dir, dir, opts, [], files);
    return files;
  }

  private static async walk(
    root: string,
    currentDir: string,
    opts: Required<Omit<ReadOptions, 'files'>>,
    parentIgnores: IgnoreLayer[],
    out: FileData[]
  ): Promise<void> {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    // Load this directory's .gitignore (if any), layered on top of parents
    const ignores = [...parentIgnores];
    if (opts.ignore) {
      try {
        const gi = await readFile(join(currentDir, '.gitignore'), 'utf-8');
        ignores.push({ dir: currentDir, ig: ignore().add(gi) });
      } catch {
        // no .gitignore here
      }
    }

    const dirs: import('fs').Dirent[] = [];

    for (const entry of entries) {
      const name = entry.name;
      const fullPath = join(currentDir, name);

      // Always skip .git
      if (name === '.git') continue;

      // Skip hidden entries unless requested
      if (!opts.hidden && name.startsWith('.')) continue;

      // Respect .gitignore (dirs and files)
      if (opts.ignore && this.isIgnored(ignores, fullPath, entry.isDirectory())) {
        continue;
      }

      if (entry.isDirectory()) {
        dirs.push(entry);
      } else if (entry.isFile() && name.endsWith('.md')) {
        const file = await this.read(root, fullPath);
        if (file) out.push(file);
      }
    }

    // Recurse into subdirectories up to the depth limit
    const canRecurse = opts.depth === -1 || opts.depth > 0;
    if (canRecurse) {
      const nextDepth = opts.depth === -1 ? -1 : opts.depth - 1;
      for (const dir of dirs) {
        await this.walk(root, join(currentDir, dir.name), { ...opts, depth: nextDepth }, ignores, out);
      }
    }
  }

  private static isIgnored(layers: IgnoreLayer[], fullPath: string, isDir: boolean): boolean {
    for (const layer of layers) {
      const rel = relative(layer.dir, fullPath);
      if (rel.startsWith('..') || isAbsolute(rel)) continue;
      if (layer.ig.ignores(rel)) return true;
      if (isDir && layer.ig.ignores(rel + '/')) return true;
    }
    return false;
  }

  private static async read(root: string, filepath: string): Promise<FileData | null> {
    try {
      const content = await readFile(filepath, 'utf-8');
      const { data } = matter(content);
      const filename = basename(filepath, '.md');
      const rel = relative(root, filepath);

      return {
        ...data,
        filename,
        path: rel,
        abspath: filepath,
        filepath,
        content
      };
    } catch {
      return null;
    }
  }

  static async writeFile(
    target: string,
    data: Record<string, any>,
    content: string
  ): Promise<string> {
    // target may be a directory (create with file/filename) or a full path
    let filepath: string;
    if (target.endsWith('.md')) {
      filepath = target;
    } else {
      const name = data.filename || data.file || 'task';
      filepath = join(target, `${name}.md`);
    }

    const frontmatter = Object.entries(data)
      .filter(([key]) => !['filename', 'path', 'abspath', 'filepath', 'file', 'content'].includes(key))
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join('\n');

    const fileContent = `---\n${frontmatter}\n---\n\n${content}`;
    await writeFile(filepath, fileContent, 'utf-8');
    return filepath;
  }
}