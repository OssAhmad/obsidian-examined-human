export interface AdminCommandDefinition {
  argumentCounts: readonly number[];
}

function command(...argumentCounts: number[]): AdminCommandDefinition {
  return { argumentCounts };
}

export const ADMIN_COMMANDS = {
  SESSION_TYPE_ADD: command(2, 3),
  SESSION_TYPE_REMOVE: command(1),
  ENGAGEMENT_TYPE_ADD: command(2, 3),
  ENGAGEMENT_TYPE_REMOVE: command(1),
  ENGAGEMENT_CREATE: command(4),
  ENGAGEMENT_COMPLETE: command(1),
  ENGAGEMENT_PAUSE: command(1),
  ENGAGEMENT_RENAME: command(2),
  ENGAGEMENT_UPDATE: command(9),
  ENGAGEMENT_ALIAS: command(2),
  ENGAGEMENT_ALIAS_ADD: command(2),
  ENGAGEMENT_ALIAS_REMOVE: command(2),
  ENGAGEMENT_ALIAS_MOVE: command(2),
  ENGAGEMENT_SET_STATUS: command(2),
  ENGAGEMENT_SET_DATES: command(3),
  ENGAGEMENT_SET_NOTES: command(2),
  ENGAGEMENT_REOPEN: command(1),
  EXERCISE_CREATE: command(2),
  EXERCISE_UPDATE: command(4),
  EXERCISE_RENAME: command(2),
  EXERCISE_ALIAS: command(2),
  EXERCISE_ALIAS_ADD: command(2),
  EXERCISE_ALIAS_REMOVE: command(2),
  EXERCISE_ALIAS_MOVE: command(2),
  ACCOUNT_CREATE: command(3, 4),
  ACCOUNT_ALIAS: command(2),
  ACCOUNT_ALIAS_ADD: command(2),
  ACCOUNT_ALIAS_REMOVE: command(2),
  ACCOUNT_ALIAS_MOVE: command(2),
  ACCOUNT_UPDATE: command(4),
  ACCOUNT_RENAME: command(2),
  ACCOUNT_SET_TYPE: command(2),
  ACCOUNT_SET_CURRENCY: command(2),
  ACCOUNT_SET_ADDRESS: command(2),
  FOOD_CREATE: command(10, 11),
  FOOD_UPDATE: command(10),
  FOOD_RENAME: command(2),
  FOOD_DELETE: command(1),
  FOOD_ALIAS_ADD: command(2),
  FOOD_ALIAS_REMOVE: command(2),
  FOOD_ALIAS_MOVE: command(2),
} as const satisfies Record<string, AdminCommandDefinition>;

export type AdminCommandName = keyof typeof ADMIN_COMMANDS;

export function supportedAdminCommands(): string[] {
  return Object.keys(ADMIN_COMMANDS);
}

export function adminCommandDefinition(name: string): AdminCommandDefinition | null {
  return Object.prototype.hasOwnProperty.call(ADMIN_COMMANDS, name)
    ? ADMIN_COMMANDS[name as AdminCommandName]
    : null;
}

export function validateAdminCommandArguments(name: string, received: number): string | null {
  const definition = adminCommandDefinition(name);
  if (!definition) return `Unknown admin command '${name}'. Supported commands: ${supportedAdminCommands().join(', ')}.`;
  if (definition.argumentCounts.includes(received)) return null;
  return `${name} expects ${definition.argumentCounts.join(' or ')} arguments; received ${received}.`;
}
