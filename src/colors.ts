// src/colors.ts

// Default SGR codes for mdquery elements
export const DEFAULT_COLORS: Record<string, string> = {
  title: '01;34',   // bold blue
  border: '90',     // bright black
  error: '31',      // red
  warning: '33',    // yellow
};

// Parse LS_COLORS-style env var: "title=01;34:border=90" → Map
export function parseColorEnv(env: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of env.split(':')) {
    const eq = part.indexOf('=');
    if (eq > 0) {
      const key = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (key && value) map.set(key, value);
    }
  }
  return map;
}

// Resolve the SGR code for an element:
// MDQUERY_COLORS > LS_COLORS (file-like keys) > config colors > defaults
export function resolveColor(
  element: string,
  mdColors: Map<string, string>,
  lsColors: Map<string, string>,
  configColors?: Map<string, string>
): string {
  const fromMd = mdColors.get(element);
  if (fromMd) return fromMd;
  // LS_COLORS file-like keys: title→fi (file), border→di (dir)
  const lsKey = element === 'title' ? 'fi' : element === 'border' ? 'di' : undefined;
  if (lsKey) {
    const fromLs = lsColors.get(lsKey);
    if (fromLs) return fromLs;
  }
  if (configColors) {
    const fromConfig = configColors.get(element);
    if (fromConfig) return fromConfig;
  }
  return DEFAULT_COLORS[element] ?? '';
}

// Wrap a string in an SGR code: "\x1b[01;34mtext\x1b[0m"
export function sgr(text: string, code: string): string {
  if (!code) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}