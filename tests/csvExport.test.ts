import { describe, it, expect } from 'vitest';
import { buildReconciliationCsv } from '../src/lib/csvExport';

describe('buildReconciliationCsv', () => {
  it('produces a header row and one data row per record', () => {
    const csv = buildReconciliationCsv([
      {
        employeeCode: 'EMP-1001',
        employeeName: 'Amit Shah',
        employeeEmail: 'amit.shah@example.com',
        projectCode: 'PRJ-APOLLO',
        projectName: 'Apollo',
        month: '2026-08',
        erpHours: 76,
        employeeConfirmedHours: 60,
        difference: 16,
        result: 0,
        status: 'FLAGGED',
        employeeExplanation: null,
        reminderCount: 0,
        createdAt: '2026-08-01T00:00:00.000Z',
        finalisedAt: null,
      },
    ]);

    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('employee_id');
    expect(lines[0]).toContain('erp_hours');
    expect(lines[1]).toContain('EMP-1001');
    expect(lines[1]).toContain('76');
    expect(lines[1]).toContain('16');
  });

  it('renders nulls as empty fields rather than the literal word null', () => {
    const csv = buildReconciliationCsv([
      {
        employeeCode: 'EMP-1003',
        employeeName: 'Priya Menon',
        employeeEmail: 'priya.menon@example.com',
        projectCode: 'PRJ-ZEUS',
        projectName: 'Zeus',
        month: '2026-08',
        erpHours: 80,
        employeeConfirmedHours: null,
        difference: null,
        result: null,
        status: 'AWAITING_RESPONSE',
        employeeExplanation: null,
        reminderCount: 0,
        createdAt: '2026-08-01T00:00:00.000Z',
        finalisedAt: null,
      },
    ]);

    expect(csv).not.toContain('null');
  });
});
