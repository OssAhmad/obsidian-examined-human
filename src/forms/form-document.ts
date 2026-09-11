export type EhFormKind = 'daily' | 'weekly' | 'budget';

export interface EhFormBlock {
  kind: EhFormKind;
  headingStart: number;
  bodyStart: number;
  endStart: number;
  endEnd: number;
  text: string;
  body: string;
}

export interface FormSection {
  name: string;
  headingStart: number;
  contentStart: number;
  contentEnd: number;
  content: string;
}

const FORM_LABELS: Record<EhFormKind, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  budget: 'Budget',
};

const ANY_FORM_HEADING = /^####[ \t]+EH[ \t]+(Daily|Weekly|Budget)[ \t]+Form[ \t]*$/gmi;

function blockFromHeading(sourceText: string, kind: EhFormKind, heading: RegExpExecArray): EhFormBlock {
  const bodyStart = (heading.index ?? 0) + heading[0].length;
  const afterHeading = sourceText.slice(bodyStart);
  const end = /^####[ \t]+END[ \t]*$/mi.exec(afterHeading);
  if (!end || end.index == null) {
    throw new Error(`The EH ${FORM_LABELS[kind]} Form has no matching #### END marker.`);
  }
  const endStart = bodyStart + end.index;
  const endEnd = endStart + end[0].length;
  return {
    kind,
    headingStart: heading.index ?? 0,
    bodyStart,
    endStart,
    endEnd,
    text: sourceText.slice(heading.index ?? 0, endEnd),
    body: sourceText.slice(bodyStart, endStart),
  };
}

export function lineEndingFor(text: string): '\r\n' | '\n' {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

export function findEhForm(sourceText: string, kind: EhFormKind): EhFormBlock | null {
  const heading = new RegExp(`^####[ \\t]+EH[ \\t]+${FORM_LABELS[kind]}[ \\t]+Form[ \\t]*$`, 'mi').exec(sourceText);
  if (!heading || heading.index == null) return null;
  return blockFromHeading(sourceText, kind, heading);
}

export function findAllEhForms(sourceText: string): EhFormBlock[] {
  const forms: EhFormBlock[] = [];
  ANY_FORM_HEADING.lastIndex = 0;
  let heading: RegExpExecArray | null;
  while ((heading = ANY_FORM_HEADING.exec(sourceText)) != null) {
    const kind = heading[1].toLowerCase() as EhFormKind;
    const form = blockFromHeading(sourceText, kind, heading);
    forms.push(form);
    ANY_FORM_HEADING.lastIndex = form.endEnd;
  }
  return forms;
}

export function requireEhForm(
  sourceText: string,
  kind: EhFormKind,
  missingHeadingMessage?: string,
  missingEndMessage?: string,
): EhFormBlock {
  try {
    const form = findEhForm(sourceText, kind);
    if (form) return form;
  } catch (error) {
    if (missingEndMessage && error instanceof Error && error.message.includes('no matching #### END')) {
      throw new Error(missingEndMessage);
    }
    throw error;
  }
  throw new Error(missingHeadingMessage ?? `The note does not contain an EH ${FORM_LABELS[kind]} Form heading.`);
}

export function formSections(body: string): Map<string, FormSection> {
  const headings = [...body.matchAll(/^#####(?!#)[ \t]+(.+?)[ \t]*$/gm)];
  const sections = new Map<string, FormSection>();
  headings.forEach((heading, index) => {
    const headingStart = heading.index ?? 0;
    const contentStart = headingStart + heading[0].length;
    const contentEnd = index + 1 < headings.length ? headings[index + 1].index ?? body.length : body.length;
    const name = heading[1].trim();
    sections.set(name.toLowerCase(), {
      name,
      headingStart,
      contentStart,
      contentEnd,
      content: body.slice(contentStart, contentEnd),
    });
  });
  return sections;
}

export function findFormSection(formText: string, name: string): FormSection | null {
  return formSections(formText).get(name.trim().toLowerCase()) ?? null;
}

export function findEntriesMarker(sectionText: string): { start: number; end: number } | null {
  const marker = /^ENTRIES:[ \t]*$/mi.exec(sectionText);
  if (!marker || marker.index == null) return null;
  return { start: marker.index, end: marker.index + marker[0].length };
}

export function entryLines(sectionText: string): string[] {
  const marker = findEntriesMarker(sectionText);
  if (!marker) return [];
  return sectionText.slice(marker.end).split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
