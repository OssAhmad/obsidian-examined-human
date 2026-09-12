import { splitDelimitedFields } from './fields.ts';

export interface SessionRowFields {
  interval: string;
  type: string;
  engagement: string;
  notes: string;
}

export const SESSION_ROW_FORMAT = 'interval | engagement | notes, or interval | type | engagement | notes';

/**
 * Session type is optional in the data model, so a typeless row may omit the
 * column instead of requiring an empty placeholder between two delimiters.
 */
export function parseSessionRowFields(line: string): SessionRowFields | null {
  const parts = splitDelimitedFields(line);
  if (parts.length === 3) {
    const [interval, engagement, notes] = parts;
    return { interval, type: '', engagement, notes };
  }
  if (parts.length === 4) {
    const [interval, type, engagement, notes] = parts;
    return { interval, type, engagement, notes };
  }
  return null;
}
