export const DEFAULT_JOURNAL_FOLDER = 'Oss Ahmad Journal';

export function normalizeJournalFolder(value: string): string {
  const forwardSlashes = value.trim().replace(/\\/g, '/');
  if (
    forwardSlashes.startsWith('/')
    || /^[A-Za-z]:\//.test(forwardSlashes)
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(forwardSlashes)
  ) {
    throw new Error('Journal folder must be relative to the vault root. Absolute paths are not supported.');
  }

  const parts = forwardSlashes.split('/').filter((part) => part && part !== '.');
  if (parts.some((part) => part === '..')) {
    throw new Error('Journal folder cannot leave the vault. Remove ".." segments.');
  }
  return parts.join('/');
}

export function pathIsInJournalFolder(filePath: string, journalFolder: string): boolean {
  const folder = normalizeJournalFolder(journalFolder);
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return folder === '' || normalizedPath.startsWith(`${folder}/`);
}
