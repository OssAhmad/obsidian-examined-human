export type DatabaseMutationDurability = 'durable' | 'ephemeral';

export function shouldCreateDatabaseBackup(durability: DatabaseMutationDurability): boolean {
  return durability === 'durable';
}
