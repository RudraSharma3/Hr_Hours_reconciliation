import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { importErpCsv } from '../src/lib/erpImportService';

// Runs against a real (migrated) database — see README "Running tests".

describe('importErpCsv', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a batch and current rows for valid entries', async () => {
    const code = `EMP-IMP-${Date.now()}`;
    const csv = ['employee_code,project_code,month,erp_hours', `${code},PRJ-IMP,2026-09,40`].join('\n');

    const result = await importErpCsv('test.csv', csv);
    expect(result.imported).toBe(1);
    expect(result.errors).toHaveLength(0);

    const row = await prisma.erpTimesheetRow.findFirst({
      where: { employeeCode: code, projectCode: 'PRJ-IMP', month: '2026-09' },
    });
    expect(row?.erpHours).toBe(40);
    expect(row?.isCurrent).toBe(true);
  });

  it('does not overwrite a prior import — it supersedes and keeps history', async () => {
    const code = `EMP-HIST-${Date.now()}`;
    const first = ['employee_code,project_code,month,erp_hours', `${code},PRJ-HIST,2026-09,40`].join('\n');
    const second = ['employee_code,project_code,month,erp_hours', `${code},PRJ-HIST,2026-09,45`].join('\n');

    await importErpCsv('first.csv', first);
    await importErpCsv('second.csv', second);

    const rows = await prisma.erpTimesheetRow.findMany({
      where: { employeeCode: code, projectCode: 'PRJ-HIST', month: '2026-09' },
      orderBy: { createdAt: 'asc' },
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].erpHours).toBe(40);
    expect(rows[0].isCurrent).toBe(false); // superseded, not deleted
    expect(rows[1].erpHours).toBe(45);
    expect(rows[1].isCurrent).toBe(true);
  });

  it('retains the raw CSV content and per-row errors on the batch record', async () => {
    const csv = ['employee_code,project_code,month,erp_hours', ',PRJ-X,2026-09,10'].join('\n');
    const result = await importErpCsv('with-error.csv', csv);
    expect(result.errors).toHaveLength(1);

    const batch = await prisma.erpImportBatch.findUnique({ where: { id: result.batchId } });
    expect(batch?.rawContent).toBe(csv);
    expect(batch?.errorCount).toBe(1);
  });
});
