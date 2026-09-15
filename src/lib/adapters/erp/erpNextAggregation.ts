import type { ErpTimesheetEntry } from './types';

/**
 * Shape we read out of ERPNext's Timesheet doctype (only the fields we
 * need). ERPNext's Timesheet has a `time_logs` child table with one row per
 * day/activity — see the "Timesheet Detail" child doctype. A single
 * Timesheet document commonly covers a week or a custom range, not
 * necessarily a full month, which is why this aggregator sums across
 * however many Timesheet documents overlap the target month rather than
 * assuming one document = one month.
 */
export type ErpNextTimesheetDoc = {
  employee: string; // Employee doctype id/name, e.g. "Byte019"
  employee_name?: string;
  status: string; // Draft | Submitted | Billed | Payslip | Completed | Cancelled
  time_logs: {
    from_time: string; // ISO-ish datetime string, e.g. "2026-09-07 10:00:00"
    hours: number;
    project?: string | null; // Project doctype id/name, e.g. "Learning Phase"
    project_name?: string | null;
  }[];
};

// Only these statuses represent hours ERPNext considers final. Draft rows
// haven't been submitted yet and Cancelled rows were reversed — counting
// either would let un-finalized or voided hours leak into reconciliation.
const COUNTED_STATUSES = new Set(['Submitted', 'Completed', 'Billed', 'Payslip']);

/**
 * Sum `time_logs` hours across one or more ERPNext Timesheet documents into
 * one entry per (employee, project) for the given target month, in the
 * exact shape every other ErpAdapter returns.
 *
 * Rows with no `project` are skipped (with a note in the caller) since our
 * data model requires a project per reconciliation record.
 */
export function aggregateErpNextTimesheets(
  docs: ErpNextTimesheetDoc[],
  targetMonth: string
): { entries: ErpTimesheetEntry[]; skippedNoProject: number } {
  const totals = new Map<
    string,
    { erpHours: number; employeeName?: string; projectName?: string }
  >();
  let skippedNoProject = 0;

  for (const doc of docs) {
    if (!COUNTED_STATUSES.has(doc.status)) continue;

    for (const log of doc.time_logs) {
      const month = log.from_time.slice(0, 7); // "2026-09-07 10:00:00" -> "2026-09"
      if (month !== targetMonth) continue;

      if (!log.project) {
        skippedNoProject += 1;
        continue;
      }

      const key = `${doc.employee}::${log.project}`;
      const prev = totals.get(key);
      totals.set(key, {
        erpHours: (prev?.erpHours ?? 0) + log.hours,
        employeeName: doc.employee_name || prev?.employeeName,
        projectName: log.project_name || prev?.projectName,
      });
    }
  }

  const entries: ErpTimesheetEntry[] = Array.from(totals.entries()).map(([key, data]) => {
    const [employeeCode, projectCode] = key.split('::');
    return {
      employeeCode,
      projectCode,
      month: targetMonth,
      erpHours: data.erpHours,
      employeeName: data.employeeName,
      projectName: data.projectName,
    };
  });

  return { entries, skippedNoProject };
}
