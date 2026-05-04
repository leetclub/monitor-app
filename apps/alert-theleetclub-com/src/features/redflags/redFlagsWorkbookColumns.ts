/**
 * Visible table titles for /red-flags — aligned with alert.theleetclub.com.xlsx **Red Flags** sheet.
 * When the workbook header row changes, update these strings and docs/alert-workbook-red-flags-tab.md.
 */
export const RED_FLAGS_COLUMNS = {
  machine: {
    title: 'Machine',
    sub: 'Name · ID · alert · last tx',
  },
  location: {
    title: 'Location',
    sub: 'Site / Vendon',
  },
  operator: {
    title: 'Operator',
    sub: 'Live ops · cleaning',
  },
  goCheck: { title: 'Go check', sub: '' as const },
  details: { title: 'Details', sub: '' as const },
  pfa: { title: 'PFA', sub: '' as const },
} as const;
