export function engagementMatchesSearch(name: string, aliases: string[], query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [name, ...aliases].some((candidate) => candidate.toLocaleLowerCase().includes(needle));
}
