import { prisma } from './prisma';
import { CsvErpAdapter } from './adapters/erp/csvAdapter';
import { ErpNextAdapter } from './adapters/erp/erpNextAdapter';
import type { ErpTimesheetEntry } from './adapters/erp/types';

export type IngestResult = {
  batchId: string;
  imported: number;
  errors: { row: number; message: string }[];
};

/**
 * Shared by every ERP source (CSV upload, ERPNext pull, ERPNext webhook).
 *
 * Every import is recorded as an ErpImportBatch (source label + optional raw
 * content for audit) and every entry becomes an ErpTimesheetRow tied to that
 * batch. If a later import supplies a new value for the same
 * (employeeCode, projectCode, month), the earlier row is NOT deleted or
 * overwritten — it's marked `isCurrent: false` and the new row becomes the
 * current one. This satisfies "do not silently overwrite imported ERP data;
 * retain import history," regardless of which source produced the data.
 */
export async function ingestErpEntries(params: {
  sourceLabel: string;
  entries: ErpTimesheetEntry[];
  errors: { row: number; message: string }[];
  rawContent?: string;
}): Promise<IngestResult> {
  const { sourceLabel, entries, errors, rawContent } = params;

  const batch = await prisma.erpImportBatch.create({
    data: {
      fileName: sourceLabel,
      rowCount: entries.length + errors.length,
      successCount: entries.length,
      errorCount: errors.length,
      rawContent: rawContent ?? `(no raw payload retained for source: ${sourceLabel})`,
      errors: errors.length ? JSON.stringify(errors) : null,
    },
  });

  for (const entry of entries) {
    // Auto-provision or update Employee
    const existingEmp = await prisma.employee.findUnique({
      where: { employeeCode: entry.employeeCode },
    });
    if (!existingEmp) {
      const cleanCode = entry.employeeCode.toLowerCase().replace(/[^a-z0-9]/g, '');
      const emailBase = entry.employeeEmail || `${cleanCode}@company.local`;
      const emailInUse = await prisma.employee.findUnique({ where: { email: emailBase } });
      const finalEmail = emailInUse ? `${cleanCode}-${Date.now()}@company.local` : emailBase;

      await prisma.employee.create({
        data: {
          employeeCode: entry.employeeCode,
          name: entry.employeeName || entry.employeeCode,
          email: finalEmail,
        },
      });
    } else if (entry.employeeName && existingEmp.name === existingEmp.employeeCode) {
      await prisma.employee.update({
        where: { id: existingEmp.id },
        data: { name: entry.employeeName },
      });
    }

    // Auto-provision or update Project
    const existingProj = await prisma.project.findUnique({
      where: { projectCode: entry.projectCode },
    });
    if (!existingProj) {
      await prisma.project.create({
        data: {
          projectCode: entry.projectCode,
          name: entry.projectName || entry.projectCode,
        },
      });
    } else if (entry.projectName && existingProj.name === existingProj.projectCode) {
      await prisma.project.update({
        where: { id: existingProj.id },
        data: { name: entry.projectName },
      });
    }

    // Supersede any existing "current" row for the same key.
    await prisma.erpTimesheetRow.updateMany({
      where: {
        employeeCode: entry.employeeCode,
        projectCode: entry.projectCode,
        month: entry.month,
        isCurrent: true,
      },
      data: { isCurrent: false },
    });

    await prisma.erpTimesheetRow.create({
      data: {
        batchId: batch.id,
        employeeCode: entry.employeeCode,
        projectCode: entry.projectCode,
        month: entry.month,
        erpHours: entry.erpHours,
        isCurrent: true,
      },
    });
  }

  return { batchId: batch.id, imported: entries.length, errors };
}

/** CSV upload path (ERP Import page). */
export async function importErpCsv(fileName: string, fileContent: string): Promise<IngestResult> {
  const adapter = new CsvErpAdapter();
  const outcome = await adapter.fetchTimesheets({ fileContent });
  return ingestErpEntries({
    sourceLabel: fileName,
    entries: outcome.entries,
    errors: outcome.errors,
    rawContent: fileContent,
  });
}

/**
 * ERPNext pull path — used by the month-end cron job and by the webhook
 * handler (scoped to one employee) when a Timesheet is submitted.
 * Requires ERP_MODE=erpnext (see .env.example and README "Connecting ERPNext").
 */
export async function importFromErpNext(month: string, employeeCode?: string): Promise<IngestResult> {
  const adapter = new ErpNextAdapter();
  const outcome = await adapter.fetchTimesheets({ month, employeeCode });
  const sourceLabel = employeeCode ? `erpnext-webhook:${employeeCode}:${month}` : `erpnext-pull:${month}`;
  return ingestErpEntries({ sourceLabel, entries: outcome.entries, errors: outcome.errors });
}
