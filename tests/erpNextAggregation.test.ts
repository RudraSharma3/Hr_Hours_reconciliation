import { describe, it, expect } from 'vitest';
import { aggregateErpNextTimesheets, type ErpNextTimesheetDoc } from '../src/lib/adapters/erp/erpNextAggregation';

// Modeled directly on the sample timesheet PDF (TS-2026-00435): employee
// "Byte019", project "Learning Phase", 5 days x 8 hours = 40 hours in one
// week of September 2026.
const sampleWeek: ErpNextTimesheetDoc = {
  employee: 'Byte019',
  status: 'Submitted',
  time_logs: [
    { from_time: '2026-09-07 10:00:00', hours: 8, project: 'Learning Phase' },
    { from_time: '2026-09-08 10:00:00', hours: 8, project: 'Learning Phase' },
    { from_time: '2026-09-09 10:00:00', hours: 8, project: 'Learning Phase' },
    { from_time: '2026-09-10 10:00:00', hours: 8, project: 'Learning Phase' },
    { from_time: '2026-09-11 10:00:00', hours: 8, project: 'Learning Phase' },
  ],
};

describe('aggregateErpNextTimesheets', () => {
  it('sums one weekly timesheet into a single monthly total', () => {
    const { entries } = aggregateErpNextTimesheets([sampleWeek], '2026-09');
    expect(entries).toEqual([{ employeeCode: 'Byte019', projectCode: 'Learning Phase', month: '2026-09', erpHours: 40 }]);
  });

  it('sums multiple weekly timesheets in the same month for the same employee+project', () => {
    const secondWeek: ErpNextTimesheetDoc = {
      employee: 'Byte019',
      status: 'Submitted',
      time_logs: [
        { from_time: '2026-09-14 10:00:00', hours: 8, project: 'Learning Phase' },
        { from_time: '2026-09-15 10:00:00', hours: 8, project: 'Learning Phase' },
      ],
    };

    const { entries } = aggregateErpNextTimesheets([sampleWeek, secondWeek], '2026-09');
    expect(entries).toEqual([{ employeeCode: 'Byte019', projectCode: 'Learning Phase', month: '2026-09', erpHours: 56 }]);
  });

  it('keeps different projects for the same employee as separate entries', () => {
    const otherProjectWeek: ErpNextTimesheetDoc = {
      employee: 'Byte019',
      status: 'Submitted',
      time_logs: [{ from_time: '2026-09-12 10:00:00', hours: 4, project: 'Apollo' }],
    };

    const { entries } = aggregateErpNextTimesheets([sampleWeek, otherProjectWeek], '2026-09');
    expect(entries).toHaveLength(2);
    expect(entries).toContainEqual({ employeeCode: 'Byte019', projectCode: 'Learning Phase', month: '2026-09', erpHours: 40 });
    expect(entries).toContainEqual({ employeeCode: 'Byte019', projectCode: 'Apollo', month: '2026-09', erpHours: 4 });
  });

  it('excludes rows from months other than the target month', () => {
    const octoberDay: ErpNextTimesheetDoc = {
      employee: 'Byte019',
      status: 'Submitted',
      time_logs: [{ from_time: '2026-10-01 10:00:00', hours: 8, project: 'Learning Phase' }],
    };

    const { entries } = aggregateErpNextTimesheets([sampleWeek, octoberDay], '2026-09');
    expect(entries).toEqual([{ employeeCode: 'Byte019', projectCode: 'Learning Phase', month: '2026-09', erpHours: 40 }]);
  });

  it('excludes Draft and Cancelled timesheets — only finalized statuses count', () => {
    const draft: ErpNextTimesheetDoc = { ...sampleWeek, status: 'Draft' };
    const cancelled: ErpNextTimesheetDoc = { ...sampleWeek, status: 'Cancelled' };

    expect(aggregateErpNextTimesheets([draft], '2026-09').entries).toEqual([]);
    expect(aggregateErpNextTimesheets([cancelled], '2026-09').entries).toEqual([]);
  });

  it('counts Completed, Billed, and Payslip statuses as finalized', () => {
    for (const status of ['Completed', 'Billed', 'Payslip']) {
      const { entries } = aggregateErpNextTimesheets([{ ...sampleWeek, status }], '2026-09');
      expect(entries).toHaveLength(1);
    }
  });

  it('reports rows with no project set instead of silently dropping them', () => {
    const noProject: ErpNextTimesheetDoc = {
      employee: 'Byte019',
      status: 'Submitted',
      time_logs: [{ from_time: '2026-09-07 10:00:00', hours: 8, project: null }],
    };

    const { entries, skippedNoProject } = aggregateErpNextTimesheets([noProject], '2026-09');
    expect(entries).toEqual([]);
    expect(skippedNoProject).toBe(1);
  });
});
