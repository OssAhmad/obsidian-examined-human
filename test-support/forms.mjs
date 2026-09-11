const LABELS = { daily: 'Daily', weekly: 'Weekly', budget: 'Budget' };

export function buildEhForm(kind, { fields = {}, sections = [], lineEnding = '\n' } = {}) {
  const lines = [`#### EH ${LABELS[kind]} Form`];
  for (const [name, value] of Object.entries(fields)) lines.push(`${name}: ${value}`);
  for (const section of sections) {
    lines.push('', `##### ${section.name}`);
    if (section.entries) lines.push('ENTRIES:');
    lines.push(...(section.lines ?? []));
  }
  lines.push('', '#### END');
  return lines.join(lineEnding);
}

export function buildDailyForm(options = {}) {
  const { date = '2026-09-10', ...rest } = options;
  return buildEhForm('daily', { fields: { date }, ...rest });
}
