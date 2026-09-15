/**
 * ERP Adapter contract.
 *
 * The rest of the application (job runners, import UI) only talks to this
 * interface. Every implementation returns the SAME shape — one entry per
 * (employee, project, month) with an already-summed total — regardless of
 * how granular the underlying source data is. That means an adapter for a
 * source that reports per-day hours (like ERPNext's Timesheet doctype) is
 * responsible for aggregating internally before returning; nothing else in
 * the app needs to know the source was ever more granular than "monthly
 * total".
 *
 * Implementations: `CsvErpAdapter` (manual CSV export) and `ErpNextAdapter`
 * (ERPNext REST API, pull or webhook-triggered). Swap the active one in
 * `src/lib/adapters/erp/index.ts` via the `ERP_MODE` env var.
 */

export type ErpTimesheetEntry = {
  employeeCode: string;
  projectCode: string;
  month: string; // YYYY-MM
  erpHours: number;
  employeeName?: string;
  projectName?: string;
  employeeEmail?: string;
};

export type ErpImportOutcome = {
  entries: ErpTimesheetEntry[];
  errors: { row: number; message: string }[];
};

export interface ErpAdapter {
  /** Human-readable name shown in the UI / audit trail. */
  readonly name: string;

  /**
   * Fetch timesheet entries, already aggregated to one row per
   * (employee, project, month).
   *
   * - `fileContent`: used by the CSV adapter (a full CSV file's text).
   * - `month`: which month (YYYY-MM) to fetch/aggregate. Required for API
   *   adapters; ignored by the CSV adapter (the CSV carries its own month
   *   column per row).
   * - `employeeCode`: optional — restricts the fetch to one employee. Used
   *   by webhook-triggered re-fetches (see ErpNextAdapter) so a single
   *   submitted timesheet doesn't require re-pulling the whole company's
   *   data for that month.
   */
  fetchTimesheets(input: {
    fileContent?: string;
    month?: string;
    employeeCode?: string;
  }): Promise<ErpImportOutcome>;
}

