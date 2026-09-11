function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function labeledValue(text: string, label: string, bullet = false): string | null {
  const prefix = bullet ? '-[ \\t]*' : '';
  const match = new RegExp(`^${prefix}${escapeRegExp(label)}:[ \\t]*(.*?)[ \\t]*$`, 'im').exec(text);
  return match?.[1]?.trim() || null;
}

export function splitDelimitedFields(line: string, expected?: number): string[] {
  if (expected != null) {
    for (const delimiter of ['|', ';']) {
      const parts = line.split(delimiter).map((part) => part.trim());
      if (parts.length === expected) return parts;
    }
  }
  const command = /^\s*[A-Z_]+\s*([|;])/.exec(line);
  const delimiter = command?.[1] ?? (line.includes('|') ? '|' : ';');
  return line.split(delimiter).map((part) => part.trim());
}

export function splitPipeFields(line: string): string[] {
  return line.split('|').map((part) => part.trim());
}
