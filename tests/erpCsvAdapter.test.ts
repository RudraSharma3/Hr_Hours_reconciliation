import { describe, it, expect } from 'vitest';
import { CsvErpAdapter } from '../src/lib/adapters/erp/csvAdapter';

const adapter = new CsvErpAdapter();

describe('CsvErpAdapter', () => {
  it('parses valid rows', async () => {
    const csv = ['employee_code,project_code,month,erp_hours', 'EMP-1001,PRJ-APOLLO,2026-08,76'].join('\n');

    const result = await adapter.fetchTimesheets({ fileContent: csv });
    expect(result.errors).toHaveLength(0);
    expect(result.entries).toEqual([
      { employeeCode: 'EMP-1001', projectCode: 'PRJ-APOLLO', month: '2026-08', erpHours: 76 },
    ]);
  });

  it('is tolerant of header spacing/case and accepts multiple rows', async () => {
    const csv = [
      'Employee Code,Project Code,Month,ERP Hours',
      'EMP-1001,PRJ-APOLLO,2026-08,76',
      'EMP-1002,PRJ-APOLLO,2026-08,76',
    ].join('\n');

    const result = await adapter.fetchTimesheets({ fileContent: csv });
    expect(result.entries).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it('reports an error for missing required fields without aborting the whole import', async () => {
    const csv = [
      'employee_code,project_code,month,erp_hours',
      'EMP-1001,PRJ-APOLLO,2026-08,76',
      ',PRJ-APOLLO,2026-08,76',
    ].join('\n');

    const result = await adapter.fetchTimesheets({ fileContent: csv });
    expect(result.entries).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/Missing required field/);
  });

  it('reports an error for an invalid month format', async () => {
    const csv = ['employee_code,project_code,month,erp_hours', 'EMP-1001,PRJ-APOLLO,08-2026,76'].join('\n');

    const result = await adapter.fetchTimesheets({ fileContent: csv });
    expect(result.entries).toHaveLength(0);
    expect(result.errors[0].message).toMatch(/Invalid month format/);
  });

  it('reports an error for a non-numeric hours value', async () => {
    const csv = ['employee_code,project_code,month,erp_hours', 'EMP-1001,PRJ-APOLLO,2026-08,abc'].join('\n');

    const result = await adapter.fetchTimesheets({ fileContent: csv });
    expect(result.entries).toHaveLength(0);
    expect(result.errors[0].message).toMatch(/Invalid erp_hours/);
  });

  it('throws if no file content is provided', async () => {
    await expect(adapter.fetchTimesheets({})).rejects.toThrow();
  });
});
