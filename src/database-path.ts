export function normalizeVaultDatabasePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Set a vault-relative database path in plugin settings.');

  const forwardSlashes = trimmed.replace(/\\/g, '/');
  if (
    forwardSlashes.startsWith('/')
    || /^[A-Za-z]:\//.test(forwardSlashes)
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(forwardSlashes)
  ) {
    throw new Error('Database path must be relative to the vault root. Absolute paths are not supported.');
  }

  const parts = forwardSlashes.split('/').filter((part) => part && part !== '.');
  if (parts.some((part) => part === '..')) {
    throw new Error('Database path cannot leave the vault. Remove ".." segments.');
  }
  if (parts.length === 0) throw new Error('Set a vault-relative database path in plugin settings.');
  return parts.join('/');
}
