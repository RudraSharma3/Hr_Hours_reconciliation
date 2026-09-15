import { prisma } from './prisma';
import { computeMatch } from './matching';
import { getMessagingAdapter } from './adapters/messaging';
import { createConfirmationToken, buildConfirmationLink } from './tokens';
import { renderTemplate } from './templates';
import type { ReconciliationStatus } from './statusTypes';

async function getSettings() {
  let settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings) {
    settings = await prisma.settings.create({ data: { id: 1 } });
  }
  return settings;
}

async function logAudit(recordId: string, eventType: string, actor: string, details?: unknown) {
  await prisma.auditEvent.create({
    data: {
      reconciliationRecordId: recordId,
      eventType,
      actor,
      details: details ? JSON.stringify(details) : null,
    },
  });
}

/**
 * Step 2+3+4 of the required workflow: for every "current" ERP timesheet row
 * that doesn't already have a reconciliation record, create one and send the
 * employee their secure confirmation request.
 *
 * Idempotent: safe to run multiple times for the same month — it only
 * creates records for (employee, project, month) combinations that don't
 * already have one, thanks to the unique constraint + explicit check.
 */
export async function generateReconciliationRequests(month?: string): Promise<{
  created: number;
  skippedExisting: number;
  skippedUnknownReference: number;
}> {
  const rows = await prisma.erpTimesheetRow.findMany({
    where: { isCurrent: true, ...(month ? { month } : {}) },
  });

  let created = 0;
  let skippedExisting = 0;
  let skippedUnknownReference = 0;
  const messaging = getMessagingAdapter();
  const settings = await getSettings();

  for (const row of rows) {
    let employee = await prisma.employee.findUnique({ where: { employeeCode: row.employeeCode } });
    if (!employee) {
      const cleanCode = row.employeeCode.toLowerCase().replace(/[^a-z0-9]/g, '');
      const emailBase = `${cleanCode}@company.local`;
      const emailInUse = await prisma.employee.findUnique({ where: { email: emailBase } });
      const finalEmail = emailInUse ? `${cleanCode}-${Date.now()}@company.local` : emailBase;

      employee = await prisma.employee.create({
        data: {
          employeeCode: row.employeeCode,
          name: row.employeeCode,
          email: finalEmail,
        },
      });
    }

    let project = await prisma.project.findUnique({ where: { projectCode: row.projectCode } });
    if (!project) {
      project = await prisma.project.create({
        data: {
          projectCode: row.projectCode,
          name: row.projectCode,
        },
      });
    }

    const existing = await prisma.reconciliationRecord.findUnique({
      where: {
        employeeId_projectId_month: {
          employeeId: employee.id,
          projectId: project.id,
          month: row.month,
        },
      },
    });

    if (existing) {
      skippedExisting += 1;
      continue;
    }

    const record = await prisma.reconciliationRecord.create({
      data: {
        month: row.month,
        employeeId: employee.id,
        projectId: project.id,
        erpHours: row.erpHours,
        erpImportRowId: row.id,
        status: 'AWAITING_RESPONSE',
      },
    });

    await logAudit(record.id, 'REQUEST_CREATED', 'system', {
      erpHours: row.erpHours,
      month: row.month,
    });

    const { rawToken } = await createConfirmationToken(record.id, 'INITIAL');
    const link = buildConfirmationLink(rawToken);

    const subject = renderTemplate(settings.initialRequestSubject, { month: row.month });
    const body = renderTemplate(settings.initialRequestBody, {
      employeeName: employee.name,
      projectName: project.name,
      month: row.month,
      link,
    });

    const result = await messaging.send({
      recipient: employee.email,
      subject,
      body,
      template: 'INITIAL_REQUEST',
      context: {
        reconciliationRecordId: record.id,
        employeeName: employee.name,
        projectName: project.name,
        month: row.month,
        erpHours: row.erpHours,
        kind: 'INITIAL_REQUEST',
      },
    });

    await prisma.messageLog.create({
      data: {
        reconciliationRecordId: record.id,
        channel: messaging.channel,
        template: 'INITIAL_REQUEST',
        recipient: employee.email,
        subject,
        body,
        mocked: result.mocked,
      },
    });

    await logAudit(record.id, 'INITIAL_REQUEST_SENT', 'system', { recipient: employee.email });

    created += 1;
  }

  return { created, skippedExisting, skippedUnknownReference };
}

/**
 * Employee submits (or corrects) their confirmed hours via the secure link.
 * Applies the no-tolerance matching rule and, on a mismatch, automatically
 * sends the follow-up asking for review/correction/explanation.
 */
export async function submitEmployeeConfirmation(params: {
  recordId: string;
  confirmedHours: number;
  explanation?: string;
  isCorrection: boolean;
}): Promise<void> {
  const { recordId, confirmedHours, explanation, isCorrection } = params;

  const record = await prisma.reconciliationRecord.findUniqueOrThrow({
    where: { id: recordId },
    include: { employee: true, project: true },
  });

  const previous = {
    employeeConfirmedHours: record.employeeConfirmedHours,
    status: record.status,
  };

  const match = computeMatch(confirmedHours, record.erpHours);

  const newStatus: ReconciliationStatus = match.result === 1 ? 'MATCHED' : 'FLAGGED';

  await prisma.reconciliationRecord.update({
    where: { id: recordId },
    data: {
      employeeConfirmedHours: confirmedHours,
      difference: match.difference,
      result: match.result,
      status: newStatus,
      employeeExplanation: explanation ?? record.employeeExplanation,
      finalisedAt: match.result === 1 ? new Date() : null,
    },
  });

  await logAudit(recordId, isCorrection ? 'EMPLOYEE_CORRECTED' : 'EMPLOYEE_SUBMITTED', 'employee', {
    previous,
    confirmedHours,
    erpHours: record.erpHours,
    difference: match.difference,
    result: match.result,
    explanation: explanation ?? null,
  });

  if (match.result === 1) {
    // Step 7: matched -> no further action.
    return;
  }

  // Step 8: flagged -> automatically ask the employee to review/correct/explain.
  const settings = await getSettings();
  const messaging = getMessagingAdapter();
  const { rawToken } = await createConfirmationToken(recordId, 'CORRECTION');
  const link = buildConfirmationLink(rawToken);

  const subject = renderTemplate(settings.mismatchSubject, { month: record.month });
  const body = renderTemplate(settings.mismatchBody, {
    employeeName: record.employee.name,
    projectName: record.project.name,
    month: record.month,
    confirmedHours,
    erpHours: record.erpHours,
    difference: match.difference,
    link,
  });

  const result = await messaging.send({
    recipient: record.employee.email,
    subject,
    body,
    template: 'MISMATCH_FOLLOWUP',
    context: {
      reconciliationRecordId: recordId,
      employeeName: record.employee.name,
      projectName: record.project.name,
      month: record.month,
      erpHours: record.erpHours,
      previousConfirmedHours: confirmedHours,
      previousDifference: match.difference,
      kind: 'MISMATCH_FOLLOWUP',
    },
  });

  await prisma.messageLog.create({
    data: {
      reconciliationRecordId: recordId,
      channel: messaging.channel,
      template: 'MISMATCH_FOLLOWUP',
      recipient: record.employee.email,
      subject,
      body,
      mocked: result.mocked,
    },
  });

  await prisma.reconciliationRecord.update({
    where: { id: recordId },
    data: { status: 'CORRECTION_REQUESTED' },
  });

  await logAudit(recordId, 'MISMATCH_FOLLOWUP_SENT', 'system', { recipient: record.employee.email });
}

/**
 * Step 9: remind employees who have not responded (still AWAITING_RESPONSE
 * or CORRECTION_REQUESTED) after `reminderIntervalDays`, up to `maxReminders`
 * times. Records past the reminder cap are left for the escalation job.
 */
export async function sendReminders(): Promise<{ reminded: number; skipped: number }> {
  const settings = await getSettings();
  const messaging = getMessagingAdapter();
  const cutoff = new Date(Date.now() - settings.reminderIntervalDays * 24 * 60 * 60 * 1000);

  const candidates = await prisma.reconciliationRecord.findMany({
    where: {
      status: { in: ['AWAITING_RESPONSE', 'CORRECTION_REQUESTED'] },
      escalated: false,
      reminderCount: { lt: settings.maxReminders },
      OR: [
        { lastReminderAt: null, createdAt: { lt: cutoff } },
        { lastReminderAt: { lt: cutoff } },
      ],
    },
    include: { employee: true, project: true },
  });

  let reminded = 0;
  for (const record of candidates) {
    const { rawToken } = await createConfirmationToken(
      record.id,
      record.status === 'CORRECTION_REQUESTED' ? 'CORRECTION' : 'INITIAL'
    );
    const link = buildConfirmationLink(rawToken);

    const subject = renderTemplate(settings.reminderSubject, { month: record.month });
    const body = renderTemplate(settings.reminderBody, {
      employeeName: record.employee.name,
      projectName: record.project.name,
      month: record.month,
      link,
    });

    const result = await messaging.send({
      recipient: record.employee.email,
      subject,
      body,
      template: 'REMINDER',
      context: {
        reconciliationRecordId: record.id,
        employeeName: record.employee.name,
        projectName: record.project.name,
        month: record.month,
        erpHours: record.erpHours,
        previousConfirmedHours: record.employeeConfirmedHours,
        previousDifference: record.difference,
        kind: 'REMINDER',
      },
    });

    await prisma.messageLog.create({
      data: {
        reconciliationRecordId: record.id,
        channel: messaging.channel,
        template: 'REMINDER',
        recipient: record.employee.email,
        subject,
        body,
        mocked: result.mocked,
      },
    });

    await prisma.reconciliationRecord.update({
      where: { id: record.id },
      data: { reminderCount: { increment: 1 }, lastReminderAt: new Date() },
    });

    await logAudit(record.id, 'REMINDER_SENT', 'system', { reminderCount: record.reminderCount + 1 });
    reminded += 1;
  }

  return { reminded, skipped: candidates.length - reminded };
}

/**
 * Step 10: escalate records that are still unresolved after hitting the
 * reminder cap. Escalation notifies HR (escalationEmail) — the employee is
 * not messaged again by this step.
 */
export async function escalateUnresolved(): Promise<{ escalated: number }> {
  const settings = await getSettings();
  const messaging = getMessagingAdapter();

  const candidates = await prisma.reconciliationRecord.findMany({
    where: {
      status: { in: ['AWAITING_RESPONSE', 'CORRECTION_REQUESTED', 'FLAGGED'] },
      escalated: false,
      reminderCount: { gte: settings.maxReminders },
    },
    include: { employee: true, project: true },
  });

  for (const record of candidates) {
    const subject = renderTemplate(settings.escalationSubject, { month: record.month });
    const body = renderTemplate(settings.escalationBody, {
      employeeName: record.employee.name,
      projectName: record.project.name,
      month: record.month,
      confirmedHours: record.employeeConfirmedHours ?? 'N/A',
      erpHours: record.erpHours,
      difference: record.difference ?? 'N/A',
      reminderCount: record.reminderCount,
    });

    const result = await messaging.send({
      recipient: settings.escalationEmail,
      subject,
      body,
      template: 'ESCALATION_NOTICE',
      context: {
        reconciliationRecordId: record.id,
        employeeName: record.employee.name,
        projectName: record.project.name,
        month: record.month,
        erpHours: record.erpHours,
        previousConfirmedHours: record.employeeConfirmedHours,
        previousDifference: record.difference,
        kind: 'ESCALATION_NOTICE',
      },
    });

    await prisma.messageLog.create({
      data: {
        reconciliationRecordId: record.id,
        channel: messaging.channel,
        template: 'ESCALATION_NOTICE',
        recipient: settings.escalationEmail,
        subject,
        body,
        mocked: result.mocked,
      },
    });

    await prisma.reconciliationRecord.update({
      where: { id: record.id },
      data: { status: 'ESCALATED', escalated: true, escalatedAt: new Date() },
    });

    await logAudit(record.id, 'ESCALATED', 'system', { escalatedTo: settings.escalationEmail });
  }

  return { escalated: candidates.length };
}

/** Admin marks a flagged/escalated record as resolved after manual review. */
export async function resolveRecord(recordId: string, adminEmail: string, note?: string): Promise<void> {
  await prisma.reconciliationRecord.update({
    where: { id: recordId },
    data: { status: 'RESOLVED', finalisedAt: new Date() },
  });
  await logAudit(recordId, 'RESOLVED', adminEmail, { note: note ?? null });
}

/** Sends/resends a confirmation email for a single record (with optional recipient override for testing). */
export async function sendConfirmationEmailForRecord(
  recordId: string,
  overrideRecipient?: string
): Promise<{ success: boolean; recipient: string; mocked: boolean }> {
  const record = await prisma.reconciliationRecord.findUniqueOrThrow({
    where: { id: recordId },
    include: { employee: true, project: true },
  });

  const settings = await getSettings();
  const messaging = getMessagingAdapter();
  const { rawToken } = await createConfirmationToken(record.id, 'INITIAL');
  const link = buildConfirmationLink(rawToken);

  const recipient = overrideRecipient || record.employee.email;
  const subject = renderTemplate(settings.initialRequestSubject, { month: record.month });
  const body = renderTemplate(settings.initialRequestBody, {
    employeeName: record.employee.name,
    projectName: record.project.name,
    month: record.month,
    link,
  });

  const result = await messaging.send({
    recipient,
    subject,
    body,
    template: 'INITIAL_REQUEST',
    context: {
      reconciliationRecordId: record.id,
      employeeName: record.employee.name,
      projectName: record.project.name,
      month: record.month,
      erpHours: record.erpHours,
      kind: 'INITIAL_REQUEST',
    },
  });

  await prisma.messageLog.create({
    data: {
      reconciliationRecordId: record.id,
      channel: messaging.channel,
      template: 'INITIAL_REQUEST',
      recipient,
      subject,
      body,
      mocked: result.mocked,
    },
  });

  await logAudit(record.id, 'INITIAL_REQUEST_SENT', 'admin', { recipient });

  return { success: true, recipient, mocked: result.mocked };
}
