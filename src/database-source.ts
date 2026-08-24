const SQLITE_WAL_HEADER_BYTES = 32;

export const UNCHECKPOINTED_WAL_MESSAGE =
  'EQH.db has uncheckpointed SQLite WAL data from another writer. Close or checkpoint the writing plugin, then press Refresh; EH Dashboards will not load or overwrite stale main-file bytes.';

export function hasUncheckpointedWal(size: number | null | undefined): boolean {
  return typeof size === 'number' && size > SQLITE_WAL_HEADER_BYTES;
}
