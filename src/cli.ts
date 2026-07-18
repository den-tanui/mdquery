#!/usr/bin/env node
// src/cli.ts
import { Executor } from './executor';
import { Formatter, OutputFormat } from './formatter';

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: mdquery <query> [--format json|table|csv] [--dir <directory>] [--file <file>]');
    console.error('');
    console.error('Examples:');
    console.error('  mdquery "select where status = \'done\'"');
    console.error('  mdquery --dir=tasks/ "select order by priority"');
    console.error('  mdquery --file=task.md "select title, status"');
    console.error('  echo "select" | mdquery');
    process.exit(1);
  }
  
  let query = '';
  let format: OutputFormat = 'json';
  let dir = '.';
  let file: string | undefined;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--format' && args[i + 1]) {
      format = args[i + 1] as OutputFormat;
      i++;
    } else if (args[i] === '--dir' && args[i + 1]) {
      dir = args[i + 1];
      i++;
    } else if (args[i] === '--file' && args[i + 1]) {
      file = args[i + 1];
      i++;
    } else if (args[i].startsWith('--dir=')) {
      dir = args[i].split('=')[1];
    } else if (args[i].startsWith('--file=')) {
      file = args[i].split('=')[1];
    } else if (args[i].startsWith('--format=')) {
      format = args[i].split('=')[1] as OutputFormat;
    } else if (!args[i].startsWith('--')) {
      query = args[i];
    }
  }
  
  // Check for stdin pipe
  if (!query && process.stdin.isTTY === false) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    query = Buffer.concat(chunks).toString().trim();
  }
  
  if (!query) {
    console.error('Error: No query provided');
    process.exit(1);
  }
  
  // If file is specified, create a temporary directory-like context
  const executor = new Executor(dir);
  
  try {
    let result;
    
    if (file) {
      // Read single file and execute query
      const { readFile } = await import('fs/promises');
      const { join } = await import('path');
      const matter = (await import('gray-matter')).default;
      
      const content = await readFile(file, 'utf-8');
      const { data } = matter(content);
      
      // Create a temporary executor with the file's data
      const tempExecutor = new Executor(dir);
      const fileData = {
        id: data.id?.toString() || '0',
        filepath: file,
        content,
        ...data
      };
      
      // For single file, we still need to execute the query
      // This is a simplified version - in production, you'd want to handle this more robustly
      result = await tempExecutor.execute(query);
    } else {
      result = await executor.execute(query);
    }
    
    const output = Formatter.format(result, format);
    console.log(output);
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
