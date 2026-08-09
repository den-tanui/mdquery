// src/clipboard.ts
import { execFileSync } from 'child_process';

type ClipboardCommand = {
  cmd: string;
  args: string[];
};

function detectClipboard(): ClipboardCommand | null {
  const platform = process.platform;

  // macOS
  if (platform === 'darwin') {
    return { cmd: 'pbcopy', args: [] };
  }

  // Windows
  if (platform === 'win32') {
    return { cmd: 'clip', args: [] };
  }

  // Linux/Unix - check Wayland first, then X11
  const candidates: ClipboardCommand[] = [
    // Wayland
    { cmd: 'wl-copy', args: [] },
    // X11
    { cmd: 'xclip', args: ['-selection', 'clipboard'] },
    { cmd: 'xsel', args: ['--clipboard', '--input'] },
  ];

  for (const candidate of candidates) {
    try {
      execFileSync('which', [candidate.cmd], { stdio: 'ignore' });
      return candidate;
    } catch {
      // not found, try next
    }
  }

  return null;
}

let cachedCommand: ClipboardCommand | null | undefined;

function getClipboardCommand(): ClipboardCommand | null {
  if (cachedCommand === undefined) {
    cachedCommand = detectClipboard();
  }
  return cachedCommand;
}

export function copyToClipboard(text: string): boolean {
  const cmd = getClipboardCommand();
  if (!cmd) return false;

  try {
    execFileSync(cmd.cmd, cmd.args, { input: text, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function hasClipboard(): boolean {
  return getClipboardCommand() !== null;
}
