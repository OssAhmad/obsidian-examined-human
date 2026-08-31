export type ReferenceKind = 'food' | 'engagement' | 'exercise' | 'account';

export interface UnresolvedReference {
  key: string;
  kind: ReferenceKind;
  rawName: string;
  contexts: string[];
}

interface Pattern {
  kind: ReferenceKind;
  expression: RegExp;
  context: string;
}

const PATTERNS: Pattern[] = [
  {
    kind: 'food',
    expression: /(?:Breakfast|Lunch|Dinner|Snack) food "([^"]+)" is not in the Food Library\./i,
    context: 'Meals',
  },
  {
    kind: 'engagement',
    expression: /Unknown engagement in session #(\d+): '([^']+)'\./i,
    context: 'Session',
  },
  {
    kind: 'engagement',
    expression: /Unknown engagement in transaction #(\d+): '([^']+)'\./i,
    context: 'Transaction',
  },
  {
    kind: 'engagement',
    expression: /Unknown engagement in milestone '([^']+)': '([^']+)'\./i,
    context: 'Milestone',
  },
  {
    kind: 'exercise',
    expression: /Unknown exercise: '([^']+)'\./i,
    context: 'Exercise details',
  },
  {
    kind: 'account',
    expression: /Unknown account in transaction #(\d+): '([^']+)'\./i,
    context: 'Transaction',
  },
];

function nameFromMatch(pattern: Pattern, match: RegExpExecArray): string {
  return pattern.kind === 'food' || pattern.kind === 'exercise' ? match[1] : match[2];
}

function contextFromMatch(pattern: Pattern, match: RegExpExecArray): string {
  if (pattern.kind === 'food' || pattern.kind === 'exercise') return pattern.context;
  if (pattern.context === 'Milestone') return `${pattern.context}: ${match[1]}`;
  return `${pattern.context} #${match[1]}`;
}

export function unresolvedReferencesFromErrors(errors: string[]): UnresolvedReference[] {
  const found = new Map<string, UnresolvedReference>();
  for (const error of errors) {
    for (const pattern of PATTERNS) {
      const match = pattern.expression.exec(error);
      if (!match) continue;
      const rawName = nameFromMatch(pattern, match).trim();
      if (!rawName) continue;
      const key = `${pattern.kind}:${rawName.toLocaleLowerCase()}`;
      const existing = found.get(key);
      const context = contextFromMatch(pattern, match);
      if (existing) {
        if (!existing.contexts.includes(context)) existing.contexts.push(context);
      } else {
        found.set(key, { key, kind: pattern.kind, rawName, contexts: [context] });
      }
      break;
    }
  }
  return [...found.values()].sort((left, right) => (
    left.kind.localeCompare(right.kind) || left.rawName.localeCompare(right.rawName)
  ));
}
