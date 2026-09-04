import type { App, TFile } from 'obsidian';
import { ehFormFrontmatterStatus, shouldDiscoverEhFormFile } from './form-status.ts';
import { pathIsInJournalFolder } from './journal-folder.ts';

export type EhFormKind = 'daily' | 'weekly' | 'budget';
export type FormDiscoveryMode = 'tagged-vault' | 'journal-folder';

export interface DiscoveredEhForm {
  kind: EhFormKind;
  date: string | null;
  startDate: string | null;
  endDate: string | null;
  fileName: string;
  filePath: string;
  formText: string;
}

export type CachedEhForm = Omit<DiscoveredEhForm, 'fileName' | 'filePath' | 'formText'>;

export interface FormDiscoveryCacheEntry {
  mtime: number;
  size: number;
  forms: CachedEhForm[];
}

export interface FormDiscoveryCache {
  version: 1;
  entries: Record<string, FormDiscoveryCacheEntry>;
}

export interface FormDiscoveryResult {
  forms: Array<Omit<DiscoveredEhForm, 'formText'>>;
  cache: FormDiscoveryCache;
  scannedFileCount: number;
  reusedFileCount: number;
}

const HEADING = /^####\s+EH\s+(Daily|Weekly|Budget)\s+Form\s*$/gmi;
const END = /^####\s+END\s*$/gmi;

export const EMPTY_FORM_DISCOVERY_CACHE: FormDiscoveryCache = { version: 1, entries: {} };

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function labeledDate(formText: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const value = new RegExp(`^${escaped}:\\s*(.*?)\\s*$`, 'im').exec(formText)?.[1]?.trim() ?? '';
  return validIsoDate(value) ? value : null;
}

function plusDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function formDates(kind: EhFormKind, formText: string): Pick<CachedEhForm, 'date' | 'startDate' | 'endDate'> {
  if (kind === 'daily') {
    const date = labeledDate(formText, 'date');
    if (!date) throw new Error('EH Daily Form requires a valid date: YYYY-MM-DD field.');
    return { date, startDate: null, endDate: null };
  }
  if (kind === 'weekly') {
    const startDate = labeledDate(formText, 'start date');
    const endDate = labeledDate(formText, 'end date');
    if (!startDate || !endDate) throw new Error('EH Weekly Form requires valid start date: and end date: YYYY-MM-DD fields.');
    if (startDate && endDate && plusDays(startDate, 6) !== endDate) {
      throw new Error(`Weekly Form declares ${startDate} through ${endDate}; end date must be start date + 6 days.`);
    }
    return { date: null, startDate, endDate };
  }
  const startDate = labeledDate(formText, 'period start');
  const endDate = labeledDate(formText, 'period end');
  if (!startDate || !endDate) throw new Error('EH Budget Form requires valid period start: and period end: YYYY-MM-DD fields.');
  return {
    date: null,
    startDate,
    endDate,
  };
}

/** Extract every complete EH form from a single Markdown file. */
export function formsInText(file: Pick<TFile, 'name' | 'path'>, sourceText: string): DiscoveredEhForm[] {
  const forms: DiscoveredEhForm[] = [];
  HEADING.lastIndex = 0;
  let heading: RegExpExecArray | null;
  while ((heading = HEADING.exec(sourceText)) != null) {
    const kind = heading[1].toLowerCase() as EhFormKind;
    END.lastIndex = heading.index + heading[0].length;
    const end = END.exec(sourceText);
    if (!end || end.index == null) throw new Error(`${file.path}: ${heading[0]} has no matching #### END marker.`);
    const formText = sourceText.slice(heading.index, end.index + end[0].length);
    const dates = formDates(kind, formText);
    forms.push({ kind, ...dates, fileName: file.name, filePath: file.path, formText });
    HEADING.lastIndex = end.index + end[0].length;
  }
  return forms;
}

function discoveryStatus(app: App, file: TFile): ReturnType<typeof ehFormFrontmatterStatus> {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  return ehFormFrontmatterStatus(frontmatter);
}

function cacheEntry(file: TFile, forms: DiscoveredEhForm[]): FormDiscoveryCacheEntry {
  return {
    mtime: file.stat.mtime,
    size: file.stat.size,
    forms: forms.map(({ formText: _formText, fileName: _fileName, filePath: _filePath, ...form }) => form),
  };
}

function restore(file: TFile, entry: FormDiscoveryCacheEntry): Array<Omit<DiscoveredEhForm, 'formText'>> {
  return entry.forms.map((form) => ({ ...form, fileName: file.name, filePath: file.path }));
}

function isVaultFile(value: unknown): value is TFile {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TFile>;
  return typeof candidate.name === 'string'
    && typeof candidate.path === 'string'
    && candidate.stat != null
    && typeof candidate.stat === 'object';
}

export function sanitizeFormDiscoveryCache(value: unknown): FormDiscoveryCache {
  if (!value || typeof value !== 'object') return { ...EMPTY_FORM_DISCOVERY_CACHE, entries: {} };
  const rawEntries = (value as { entries?: unknown }).entries;
  if (!rawEntries || typeof rawEntries !== 'object') return { ...EMPTY_FORM_DISCOVERY_CACHE, entries: {} };
  const entries: Record<string, FormDiscoveryCacheEntry> = {};
  for (const [path, raw] of Object.entries(rawEntries as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Partial<FormDiscoveryCacheEntry>;
    if (!Number.isFinite(entry.mtime) || !Number.isFinite(entry.size) || !Array.isArray(entry.forms)) continue;
    const forms = entry.forms.filter((form): form is CachedEhForm => (
      !!form && typeof form === 'object'
       && ['daily', 'weekly', 'budget'].includes(form.kind)
    )).map((form) => ({
      kind: form.kind,
      date: typeof form.date === 'string' ? form.date : null,
      startDate: typeof form.startDate === 'string' ? form.startDate : null,
      endDate: typeof form.endDate === 'string' ? form.endDate : null,
    }));
    entries[path] = { mtime: Number(entry.mtime), size: Number(entry.size), forms };
  }
  return { version: 1, entries };
}

export async function discoverEhForms(
  app: App,
  mode: FormDiscoveryMode,
  journalFolder: string,
  existingCache: FormDiscoveryCache,
): Promise<FormDiscoveryResult> {
  const candidates = app.vault.getMarkdownFiles().filter((file) => shouldDiscoverEhFormFile(
    discoveryStatus(app, file),
    mode,
    pathIsInJournalFolder(file.path, journalFolder),
  ));
  const candidatePaths = new Set(candidates.map((file) => file.path));
  const entries: Record<string, FormDiscoveryCacheEntry> = {};
  const forms: Array<Omit<DiscoveredEhForm, 'formText'>> = [];
  let scannedFileCount = 0;
  let reusedFileCount = 0;
  for (const file of candidates) {
    const cached = existingCache.entries[file.path];
    if (cached && cached.mtime === file.stat.mtime && cached.size === file.stat.size) {
      entries[file.path] = cached;
      forms.push(...restore(file, cached));
      reusedFileCount += 1;
      continue;
    }
    let discovered: DiscoveredEhForm[];
    try {
      discovered = formsInText(file, await app.vault.cachedRead(file));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message.startsWith(`${file.path}:`) ? message : `${file.path}: ${message}`);
    }
    entries[file.path] = cacheEntry(file, discovered);
    forms.push(...restore(file, entries[file.path]));
    scannedFileCount += 1;
  }
  // Candidate eligibility is authoritative: stale entries from renamed, deleted,
  // untagged, or out-of-folder files must not reappear in navigators.
  for (const path of Object.keys(existingCache.entries)) {
    if (!candidatePaths.has(path)) delete entries[path];
  }
  return { forms, cache: { version: 1, entries }, scannedFileCount, reusedFileCount };
}

export function cachedEhForms(app: App, cache: FormDiscoveryCache): Array<Omit<DiscoveredEhForm, 'formText'>> {
  const forms: Array<Omit<DiscoveredEhForm, 'formText'>> = [];
  for (const [path, entry] of Object.entries(cache.entries)) {
    const file = app.vault.getAbstractFileByPath(path);
    if (!isVaultFile(file)) continue;
    // The cache stores discovery descriptors, not a claim that the note content
    // is unchanged. Daily and Weekly Assessment read the selected note again for
    // validation, so ordinary edits must not make an already discovered form
    // disappear before the next discovery scan refreshes this descriptor.
    forms.push(...restore(file, entry));
  }
  return forms;
}
