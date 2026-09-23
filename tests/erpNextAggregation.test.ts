import { describe, it, expect } from 'vitest';
import {
  aggregateErpNextTimesheets,
  isExcludedActivityOrProject,
  DEFAULT_EXCLUDED_PATTERNS,
  type ErpNextTimesheetDoc,
} from '../src/lib/adapters/erp/erpNextAggregation';

// Standard client project timesheet: employee "Byte019", project "Project Apollo",
// 5 days x 8 hours = 40 hours in September 2026.
const sampleWeek: ErpNextTimesheetDoc = {
  employee: 'Byte019',
  status: 'Submitted',
  time_logs: [
    { from_time: '2026-09-07 10:00:00', hours: 8, project: 'Project Apollo' },
    { from_time: '2026-09-08 10:00:00', hours: 8, project: 'Project Apollo' },
    { from_time: '2026-09-09 10:00:00', hours: 8, project: 'Project Apollo' },
    { from_time: '2026-09-10 10:00:00', hours: 8, project: 'Project Apollo' },
    { from_time: '2026-09-11 10:00:00', hours: 8, project: 'Project Apollo' },
  ],
};

describe('aggregateErpNextTimesheets', () => {
  it('sums one weekly timesheet into a single monthly total', () => {
    const { entries, skippedExcluded } = aggregateErpNextTimesheets([sampleWeek], '2026-09');
    expect(entries).toEqual([{ employeeCode: 'Byte019', projectCode: 'Project Apollo', month: '2026-09', erpHours: 40 }]);
    expect(skippedExcluded).toBe(0);
  });

  it('sums multiple weekly timesheets in the same month for the same employee+project', () => {
    const secondWeek: ErpNextTimesheetDoc = {
      employee: 'Byte019',
      status: 'Submitted',
      time_logs: [
        { from_time: '2026-09-14 10:00:00', hours: 8, project: 'Project Apollo' },
        { from_time: '2026-09-15 10:00:00', hours: 8, project: 'Project Apollo' },
      ],
    };

    const { entries } = aggregateErpNextTimesheets([sampleWeek, secondWeek], '2026-09');
    expect(entries).toEqual([{ employeeCode: 'Byte019', projectCode: 'Project Apollo', month: '2026-09', erpHours: 56 }]);
  });

  it('keeps different client projects for the same employee as separate entries', () => {
    const otherProjectWeek: ErpNextTimesheetDoc = {
      employee: 'Byte019',
      status: 'Submitted',
      time_logs: [{ from_time: '2026-09-12 10:00:00', hours: 4, project: 'Project Zeus' }],
    };

    const { entries } = aggregateErpNextTimesheets([sampleWeek, otherProjectWeek], '2026-09');
    expect(entries).toHaveLength(2);
    expect(entries).toContainEqual({ employeeCode: 'Byte019', projectCode: 'Project Apollo', month: '2026-09', erpHours: 40 });
    expect(entries).toContainEqual({ employeeCode: 'Byte019', projectCode: 'Project Zeus', month: '2026-09', erpHours: 4 });
  });

  it('excludes rows from months other than the target month', () => {
    const octoberDay: ErpNextTimesheetDoc = {
      employee: 'Byte019',
      status: 'Submitted',
      time_logs: [{ from_time: '2026-10-01 10:00:00', hours: 8, project: 'Project Apollo' }],
    };

    const { entries } = aggregateErpNextTimesheets([sampleWeek, octoberDay], '2026-09');
    expect(entries).toEqual([{ employeeCode: 'Byte019', projectCode: 'Project Apollo', month: '2026-09', erpHours: 40 }]);
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

  it('filters out Learning Phase, Leave, Holidays, WFH, and L&D rows automatically', () => {
    const mixedTimesheet: ErpNextTimesheetDoc = {
      employee: 'Byte019',
      status: 'Submitted',
      time_logs: [
        { from_time: '2026-09-01 10:00:00', hours: 8, project: 'Project Apollo' },
        { from_time: '2026-09-02 10:00:00', hours: 8, project: 'Learning Phase' },
        { from_time: '2026-09-03 10:00:00', hours: 8, project: 'Casual Leave', activity_type: 'Leave' },
        { from_time: '2026-09-04 10:00:00', hours: 8, project: 'Public Holiday', activity_type: 'Holiday' },
        { from_time: '2026-09-05 10:00:00', hours: 8, project: 'WFH Request', activity_type: 'Work From Home' },
        { from_time: '2026-09-06 10:00:00', hours: 4, project: 'L&D Training' },
        { from_time: '2026-09-06 10:00:00', hours: 4, project: 'Learning and Development' },
      ],
    };

    const { entries, skippedExcluded } = aggregateErpNextTimesheets([mixedTimesheet], '2026-09');
    // Only Project Apollo (8 hrs) should remain
    expect(entries).toEqual([
      { employeeCode: 'Byte019', projectCode: 'Project Apollo', month: '2026-09', erpHours: 8 },
    ]);
    expect(skippedExcluded).toBe(6);
  });

  it('isExcludedActivityOrProject checks various casing and partial matches', () => {
    expect(isExcludedActivityOrProject('Learning Phase')).toBe(true);
    expect(isExcludedActivityOrProject('LEARNING PHASE 1')).toBe(true);
    expect(isExcludedActivityOrProject('Casual Leave')).toBe(true);
    expect(isExcludedActivityOrProject(null, null, 'Sick Leave')).toBe(true);
    expect(isExcludedActivityOrProject(null, null, 'Public Holiday')).toBe(true);
    expect(isExcludedActivityOrProject('WFH')).toBe(true);
    expect(isExcludedActivityOrProject('Work From Home')).toBe(true);
    expect(isExcludedActivityOrProject('L&D')).toBe(true);
    expect(isExcludedActivityOrProject('Learning and Development')).toBe(true);

    // Client projects should NOT be excluded
    expect(isExcludedActivityOrProject('Project Apollo')).toBe(false);
    expect(isExcludedActivityOrProject('Client Mobile App')).toBe(false);
    expect(isExcludedActivityOrProject('Infrastructure Migration')).toBe(false);
  });
});

