#!/usr/bin/env node
// src/cli.ts
import { Executor } from './executor';
import { Formatter, OutputFormat } from './formatter';

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: mdquery <query> [--format json|table|csv] [--dir <directory>]');
    process.exit(1);
  }
  
  let query = '';
  let format: OutputFormat = 'json';
  let dir = '.';
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--format' && args[i + 1]) {
      format = args[i + 1] as OutputFormat;
      i++;
    } else if (args[i] === '--dir' && args[i + 1]) {
      dir = args[i + 1];
      i++;
    } else if (!args[i].startsWith('--')) {
      query = args[i];
    }
  }
  
  if (!query) {
    console.error('Error: No query provided');
    process.exit(1);
  }
  
  try {
    const executor = new Executor(dir);
    const result = await executor.execute(query);
    const output = Formatter.format(result, format);
    console.log(output);
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
