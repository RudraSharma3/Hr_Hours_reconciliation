import Papa from 'papaparse';

export type ExportRow = {
  employeeCode: string;
  employeeName: string;
  employeeEmail: string;
  projectCode: string;
  projectName: string;
  month: string;
  erpHours: number;
  employeeConfirmedHours: number | null;
  difference: number | null;
  result: number | null;
  status: string;
  employeeExplanation: string | null;
  reminderCount: number;
  createdAt: string;
  finalisedAt: string | null;
};

export function buildReconciliationCsv(rows: ExportRow[]): string {
  return Papa.unparse(
    rows.map((r) => ({
      employee_id: r.employeeCode,
      employee_name: r.employeeName,
      employee_email: r.employeeEmail,
      project_id: r.projectCode,
      project_name: r.projectName,
      month: r.month,
      erp_hours: r.erpHours,
      employee_confirmed_hours: r.employeeConfirmedHours ?? '',
      difference: r.difference ?? '',
      result: r.result ?? '',
      status: r.status,
      employee_explanation: r.employeeExplanation ?? '',
      reminder_count: r.reminderCount,
      created_date: r.createdAt,
      finalised_date: r.finalisedAt ?? '',
    }))
  );
}
