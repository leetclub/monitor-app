/** Vendon machine name ↔ SafetyCulture / alias names for QA summary counts. */

function applyQaNameTypos(norm: string): string {
  return norm.replace(/enginnering/g, 'engineering');
}

export function normKey(s: string): string {
  return applyQaNameTypos(
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim(),
  );
}

// Mirrors people-analytics-sync/config/commercial_people_camera_names.json + MOH mirror pairs.
const RAW_GROUPS: string[][] = [
  ['Adan Hospital - OPD', 'Adan OPD'],
  ['Adan Hallway'],
  ['Adan Hospital - Casualty', 'Adan Casualty', 'Adan Hospital Casualty', 'adan casualty 2026'],
  ['Adan Main Gate', 'Adan Hospital Main Gate'],
  ['Adan maternity', 'Adan Maternity'],
  ['Jaber Hospital - Gate 2', 'Jaber Gate 2'],
  ['Jaber Hospital - Gate 6', 'Jaber Gate 6'],
  ['Farwaniya Hospital - Fl. 3', 'Farwaniya Hospital', 'Farwaniya Fl 3', 'Farwaniya Hospital Fl', 'Farwaniya Hall', 'Farwaniya Dental', 'Farwaniya Main gate'],
  ['Farwaniya H - OPD-Fl.1', 'Farwaniya OPD', 'Farwaniya Hospital OPD', 'Farwaniya H OPD'],
  ['Jahra Hospital - Parking', 'Jahra Parking', 'Jahra Parking 2', 'Jahra Hospital Parking'],
  ['Jahra Hospital - Main Gate', 'Jahra Main Gate', 'Jahra Hospital Main'],
  ['Jahra Women center', 'Jahra Women', 'Jahra Hospital'],
  ['Amiri New', 'Amiri Hospital New', 'Amiri old 2', 'Amiri old', 'Amiri Old'],
  ['Maternity Hospital Main', 'Maternity Hospital', 'Maternity Hospital OPD', 'MOH main', 'Moh Main'],
  ['Razi Hospital - OPD', 'Razi OPD', 'Razi Hospital OPD'],
  ['Razi Hospital - Old', 'Razi Old', 'Razi Hospital Old'],
  ['Zain Hospital', 'Zain hospital', 'Zain'],
  ['KU Engineering', 'KU Enginnering', 'KU Engineering J', 'KU Enginnering J'],
];

const NORM_TO_GROUP: Map<string, Set<string>> = (() => {
  const m = new Map<string, Set<string>>();
  for (const names of RAW_GROUPS) {
    const keys = new Set(names.map(normKey).filter(Boolean));
    for (const k of keys) {
      m.set(k, keys);
    }
  }
  return m;
})();

export function normKeysForQaMachine(machineName: string): Set<string> {
  const nk = normKey(machineName);
  if (!nk) return new Set();
  const group = NORM_TO_GROUP.get(nk);
  if (group) return new Set(group);
  return new Set([nk]);
}

export function qaMachineNamesMatch(a: string, b: string): boolean {
  const ka = normKeysForQaMachine(a);
  const kb = normKeysForQaMachine(b);
  for (const k of ka) {
    if (kb.has(k)) return true;
  }
  return normKey(a) === normKey(b);
}
