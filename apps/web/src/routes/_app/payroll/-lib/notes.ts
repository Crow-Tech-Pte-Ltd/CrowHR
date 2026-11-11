/** One note shared by several employees, in the order the notes first appear. */
export interface GroupedNote {
  key: string;
  message: string;
  names: string[];
}

/**
 * Collapses identical per-employee notes into one line each ("24 employees: … and 21 more"), so a
 * year with many employees new to Crow HR doesn't list the same sentence 24 times.
 */
export function groupEmployeeNotes(
  records: { employeeName: string; notes: { code: string; message: string }[] }[],
): GroupedNote[] {
  const groups = new Map<string, GroupedNote>();
  for (const r of records) {
    for (const n of r.notes) {
      const key = `${n.code}\u0000${n.message}`;
      const group = groups.get(key);
      if (group) group.names.push(r.employeeName);
      else groups.set(key, { key, message: n.message, names: [r.employeeName] });
    }
  }
  return [...groups.values()];
}

/** "Ahmad", "Ahmad and Arjun", "Ahmad, Arjun, Benjamin and 21 more". */
export function namesSummary(names: string[], shown = 3): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= shown) return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${names.slice(0, shown).join(", ")} and ${names.length - shown} more`;
}
