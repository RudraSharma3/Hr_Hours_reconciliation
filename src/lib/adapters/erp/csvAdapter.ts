import Papa from 'papaparse';
import type { ErpAdapter, ErpImportOutcome, ErpTimesheetEntry } from './types';

/**
 * Expected CSV columns (header row required, order does not matter):
 *   employee_code, project_code, month, erp_hours
 *
 * month must be in YYYY-MM format. erp_hours must parse as a non-negative
 * number. Rows that fail validation are reported in `errors` and skipped —
 * the whole import is not aborted by one bad row.
 */
export class CsvErpAdapter implements ErpAdapter {
  readonly name = 'ERP CSV Import';

  async fetchTimesheets(input: { fileContent?: string }): Promise<ErpImportOutcome> {
    const { fileContent } = input;
    if (!fileContent) {
      throw new Error('CsvErpAdapter.fetchTimesheets requires fileContent');
    }

    const parsed = Papa.parse<Record<string, string>>(fileContent, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
    });

    const entries: ErpTimesheetEntry[] = [];
    const errors: { row: number; message: string }[] = [];

    parsed.data.forEach((row, idx) => {
      const rowNum = idx + 2; // +1 for 0-index, +1 for header row
      const employeeCode = row.employee_code?.trim();
      const projectCode = row.project_code?.trim();
      const month = row.month?.trim();
      const hoursRaw = row.erp_hours?.trim();

      if (!employeeCode || !projectCode || !month || !hoursRaw) {
        errors.push({ row: rowNum, message: 'Missing required field(s)' });
        return;
      }

      if (!/^\d{4}-\d{2}$/.test(month)) {
        errors.push({ row: rowNum, message: `Invalid month format "${month}" (expected YYYY-MM)` });
        return;
      }

      const erpHours = Number(hoursRaw);
      if (!Number.isFinite(erpHours) || erpHours < 0) {
        errors.push({ row: rowNum, message: `Invalid erp_hours value "${hoursRaw}"` });
        return;
      }

      entries.push({ employeeCode, projectCode, month, erpHours });
    });

    if (parsed.errors?.length) {
      for (const e of parsed.errors) {
        errors.push({ row: (e.row ?? 0) + 2, message: e.message });
      }
    }

    return { entries, errors };
  }
}
