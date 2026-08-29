export type StorageEntryType = 'file' | 'folder';

export interface FolderStorage {
  indexedType(path: string): StorageEntryType | null;
  persistedType(path: string): Promise<StorageEntryType | null>;
  createFolder(path: string): Promise<void>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function backupDirectoryForDatabase(databasePath: string): string {
  const slash = databasePath.lastIndexOf('/');
  const directory = slash >= 0 ? databasePath.slice(0, slash) : '';
  return [directory, '.examined-human-backups'].filter(Boolean).join('/');
}

export function pluginBackupRetentionPlan(
  databasePath: string,
  files: string[],
  retentionLimit: number,
  protectedPath?: string,
): string[] {
  const limit = Math.max(0, Math.floor(retentionLimit));
  if (limit === 0) return [];
  const slash = databasePath.lastIndexOf('/');
  const fileName = slash >= 0 ? databasePath.slice(slash + 1) : databasePath;
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot) : '.db';
  const backupDirectory = backupDirectoryForDatabase(databasePath);
  const prefix = `${backupDirectory}/`;
  const pattern = new RegExp(`^${escapeRegExp(stem)}\\.before-[a-z0-9-]+-(\\d{17})${escapeRegExp(extension)}$`, 'i');
  const candidates = files.flatMap((path) => {
    if (!path.startsWith(prefix)) return [];
    const baseName = path.slice(prefix.length);
    if (baseName.includes('/')) return [];
    const match = pattern.exec(baseName);
    return match ? [{ path, timestamp: match[1] }] : [];
  }).sort((left, right) => right.timestamp.localeCompare(left.timestamp) || right.path.localeCompare(left.path));
  const keep = new Set(candidates.slice(0, limit).map((candidate) => candidate.path));
  const protectedCandidate = candidates.find((candidate) => candidate.path === protectedPath);
  if (protectedCandidate && !keep.has(protectedCandidate.path)) {
    const lastKept = [...keep].at(-1);
    if (lastKept) keep.delete(lastKept);
    keep.add(protectedCandidate.path);
  }
  return candidates
    .filter((candidate) => !keep.has(candidate.path))
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.path.localeCompare(right.path))
    .map((candidate) => candidate.path);
}

function assertFolder(path: string, type: StorageEntryType | null): boolean {
  if (type === 'folder') return true;
  if (type === 'file') throw new Error(`A file blocks backup folder creation: ${path}`);
  return false;
}

export async function ensureStorageFolder(storage: FolderStorage, path: string): Promise<void> {
  let current = '';
  for (const segment of path.split('/').filter(Boolean)) {
    current = current ? `${current}/${segment}` : segment;
    if (assertFolder(current, storage.indexedType(current))) continue;
    if (assertFolder(current, await storage.persistedType(current))) continue;
    try {
      await storage.createFolder(current);
    } catch (error) {
      // Hidden folders and externally synchronized folders may exist on disk
      // without appearing in Obsidian's indexed vault tree. A create can also
      // race another writer, so confirm persisted state before failing.
      if (assertFolder(current, await storage.persistedType(current))) continue;
      throw error;
    }
  }
}
