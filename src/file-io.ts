// src/file-io.ts
import { fdir } from 'fdir';
import { join, relative, isAbsolute } from 'path';
import { readFile } from 'fs/promises';
import matter from 'gray-matter';
import ignore from 'ignore';
import { ReadOptions } from './files';

export interface FileIOAnalysis {
  requiresContent: boolean;
  bodyPredicates: { field: string; op: string; value: string }[];
}

const DEFAULT_OPTIONS: Required<Omit<ReadOptions, 'files'>> = {
  depth: 0,
  hidden: false,
  ignore: true
};

export class FastFileOps {
  static async listFiles(dir: string, options: ReadOptions = {}): Promise<string[]> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    let crawler = new fdir()
      .withFullPaths()
      .filter((path: string) => path.endsWith('.md'));

    if (!opts.hidden) {
      crawler = crawler
        .exclude((dirName: string) => dirName.startsWith('.'))
        .filter((path: string) => !path.split('/').pop()!.startsWith('.'));
    }

    // IMPORTANT: legacy depth semantics differ from fdir's withMaxDepth.
    // Legacy: depth 0 = recursive (default), 1 = top level only, 2 = one subdir level.
    // fdir:   maxDepth 0 = top level only, 1 = root + 1 subdir, 2 = root + 2 subdirs.
    // Mapping: legacy depth N (N >= 1) -> fdir maxDepth N-1. Legacy 0 -> no maxDepth.
    if (opts.depth > 0) {
      crawler = crawler.withMaxDepth(opts.depth - 1);
    }

    let files = crawler.crawl(dir).sync();

    // fdir does not respect .gitignore — apply it here
    if (opts.ignore) {
      files = this.applyGitignore(dir, files);
    }

    return files;
  }

  private static applyGitignore(root: string, files: string[]): string[] {
    let ig: ReturnType<typeof ignore> | null = null;
    try {
      const gi = require('fs').readFileSync(join(root, '.gitignore'), 'utf-8');
      ig = ignore().add(gi);
    } catch {
      return files; // no .gitignore
    }
    return files.filter(f => {
      const rel = relative(root, f);
      if (rel.startsWith('..') || isAbsolute(rel)) return true;
      return !ig!.ignores(rel);
    });
  }
}
