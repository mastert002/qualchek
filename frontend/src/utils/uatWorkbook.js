import * as XLSX from 'xlsx';

// One row per test step, so a tester can tick off each step in the sheet.
// Cases with no steps still get one row, carrying the case's expected result.
// Actual result, Pass / Fail, Tester and Comments are left blank for the tester.
const HEADERS = [
  'UAT ID', 'Suite', 'Title', 'Priority', 'Preconditions',
  'Step No', 'Action', 'Expected Result',
  'Actual Result', 'Pass / Fail', 'Tester', 'Comments',
];

export function buildUatRows(cases) {
  const rows = [HEADERS];
  cases.forEach((tc, index) => {
    const uatId = `UAT-${String(index + 1).padStart(3, '0')}`;
    const base = [uatId, tc.suite_name || '', tc.title || '', tc.priority || '', tc.preconditions || ''];
    const steps = tc.steps || [];
    if (steps.length === 0) {
      rows.push([...base, '', '', tc.expected_result || '', '', '', '', '']);
      return;
    }
    steps.forEach((step, i) => {
      rows.push([...base, i + 1, step.action || '', step.expected || '', '', '', '', '']);
    });
  });
  return rows;
}

export function downloadUatWorkbook(cases) {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(buildUatRows(cases));
  sheet['!cols'] = [12, 18, 36, 10, 40, 8, 48, 48, 30, 12, 18, 30].map(wch => ({ wch }));
  XLSX.utils.book_append_sheet(wb, sheet, 'UAT');
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `uat-test-cases-${date}.xlsx`);
}
