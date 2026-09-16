import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/auth/admin';
import { computeMatch } from '../src/lib/matching';
import { createConfirmationToken } from '../src/lib/tokens';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // --- Admin user ---------------------------------------------------------
  const adminPassword = 'ChangeMe123!';
  const admin = await prisma.adminUser.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      name: 'HR Admin',
      passwordHash: await hashPassword(adminPassword),
    },
  });
  console.log(`Admin user ready: ${admin.email} / ${adminPassword} (change this after first login)`);

  // --- Settings ------------------------------------------------------------
  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });

  // --- Employees -------------------------------------------------------------
  const employeesData = [
    { employeeCode: 'EMP-1001', name: 'Amit Shah', email: 'amit.shah@example.com' },
    { employeeCode: 'EMP-1002', name: 'Neha Rao', email: 'neha.rao@example.com' },
    { employeeCode: 'EMP-1003', name: 'Priya Menon', email: 'priya.menon@example.com' },
    { employeeCode: 'EMP-1004', name: 'Rohan Gupta', email: 'rohan.gupta@example.com' },
    { employeeCode: 'EMP-1005', name: 'Rudra Sharma', email: 'rudra@bytepx.com' },
  ];

  const employees: Record<string, Awaited<ReturnType<typeof prisma.employee.upsert>>> = {};
  for (const e of employeesData) {
    employees[e.employeeCode] = await prisma.employee.upsert({
      where: { employeeCode: e.employeeCode },
      update: {},
      create: e,
    });
  }

  // --- Projects --------------------------------------------------------------
  const projectsData = [
    { projectCode: 'PRJ-APOLLO', name: 'Apollo' },
    { projectCode: 'PRJ-ZEUS', name: 'Zeus' },
    { projectCode: 'PRJ-HOLIDAY', name: 'National Holiday' },
    { projectCode: 'PRJ-LEARNING', name: 'Learning Phase' },
  ];

  const projects: Record<string, Awaited<ReturnType<typeof prisma.project.upsert>>> = {};
  for (const p of projectsData) {
    projects[p.projectCode] = await prisma.project.upsert({
      where: { projectCode: p.projectCode },
      update: {},
      create: p,
    });
  }

  const month = '2026-08';

  // --- ERP import batch (seed data is presented as if it came from a CSV import) ---
  const rawContent = [
    'employee_code,project_code,month,erp_hours',
    'EMP-1001,PRJ-APOLLO,2026-08,76',
    'EMP-1002,PRJ-APOLLO,2026-08,76',
    'EMP-1003,PRJ-ZEUS,2026-08,80',
    'EMP-1004,PRJ-APOLLO,2026-08,64',
  ].join('\n');

  const batch = await prisma.erpImportBatch.create({
    data: {
      fileName: 'seed-august-2026.csv',
      rowCount: 4,
      successCount: 4,
      errorCount: 0,
      rawContent,
    },
  });

  const erpRows = [
    { employeeCode: 'EMP-1001', projectCode: 'PRJ-APOLLO', erpHours: 76 },
    { employeeCode: 'EMP-1002', projectCode: 'PRJ-APOLLO', erpHours: 76 },
    { employeeCode: 'EMP-1003', projectCode: 'PRJ-ZEUS', erpHours: 80 },
    { employeeCode: 'EMP-1004', projectCode: 'PRJ-APOLLO', erpHours: 64 },
  ];

  for (const row of erpRows) {
    await prisma.erpTimesheetRow.create({
      data: {
        batchId: batch.id,
        employeeCode: row.employeeCode,
        projectCode: row.projectCode,
        month,
        erpHours: row.erpHours,
        isCurrent: true,
      },
    });
  }

  // --- Reconciliation records --------------------------------------------
  // Required sample 1: Amit Shah — flagged mismatch (60 confirmed vs 76 ERP)
  const amitErpHours = 76;
  const amitConfirmed = 60;
  const amitMatch = computeMatch(amitConfirmed, amitErpHours);

  const amitRecord = await prisma.reconciliationRecord.upsert({
    where: {
      employeeId_projectId_month: {
        employeeId: employees['EMP-1001'].id,
        projectId: projects['PRJ-APOLLO'].id,
        month,
      },
    },
    update: {},
    create: {
      month,
      employeeId: employees['EMP-1001'].id,
      projectId: projects['PRJ-APOLLO'].id,
      erpHours: amitErpHours,
      employeeConfirmedHours: amitConfirmed,
      difference: amitMatch.difference,
      result: amitMatch.result,
      status: 'FLAGGED',
      employeeExplanation: null,
      reminderCount: 0,
    },
  });

  await prisma.auditEvent.createMany({
    data: [
      {
        reconciliationRecordId: amitRecord.id,
        eventType: 'REQUEST_CREATED',
        actor: 'system',
        details: JSON.stringify({ erpHours: amitErpHours, month }),
      },
      {
        reconciliationRecordId: amitRecord.id,
        eventType: 'EMPLOYEE_SUBMITTED',
        actor: 'employee',
        details: JSON.stringify({
          confirmedHours: amitConfirmed,
          erpHours: amitErpHours,
          difference: amitMatch.difference,
          result: amitMatch.result,
        }),
      },
      {
        reconciliationRecordId: amitRecord.id,
        eventType: 'MISMATCH_FOLLOWUP_SENT',
        actor: 'system',
        details: JSON.stringify({ recipient: employees['EMP-1001'].email }),
      },
    ],
  });

  await prisma.messageLog.createMany({
    data: [
      {
        reconciliationRecordId: amitRecord.id,
        channel: 'EMAIL',
        template: 'INITIAL_REQUEST',
        recipient: employees['EMP-1001'].email,
        subject: 'Please confirm your project hours for 2026-08',
        body: 'Seed data — initial request.',
        mocked: true,
      },
      {
        reconciliationRecordId: amitRecord.id,
        channel: 'EMAIL',
        template: 'MISMATCH_FOLLOWUP',
        recipient: employees['EMP-1001'].email,
        subject: 'Action needed: hours mismatch for 2026-08',
        body: 'Seed data — mismatch follow-up. You confirmed 60, ERP shows 76, difference 16.',
        mocked: true,
      },
    ],
  });

  // Give Amit's record a live confirmation link so the demo can show the
  // correction flow end-to-end.
  const amitToken = await createConfirmationToken(amitRecord.id, 'CORRECTION');

  // Required sample 2: Neha Rao — exact match (76 confirmed vs 76 ERP)
  const nehaErpHours = 76;
  const nehaConfirmed = 76;
  const nehaMatch = computeMatch(nehaConfirmed, nehaErpHours);

  const nehaRecord = await prisma.reconciliationRecord.upsert({
    where: {
      employeeId_projectId_month: {
        employeeId: employees['EMP-1002'].id,
        projectId: projects['PRJ-APOLLO'].id,
        month,
      },
    },
    update: {},
    create: {
      month,
      employeeId: employees['EMP-1002'].id,
      projectId: projects['PRJ-APOLLO'].id,
      erpHours: nehaErpHours,
      employeeConfirmedHours: nehaConfirmed,
      difference: nehaMatch.difference,
      result: nehaMatch.result,
      status: 'MATCHED',
      finalisedAt: new Date(),
      reminderCount: 0,
    },
  });

  await prisma.auditEvent.createMany({
    data: [
      {
        reconciliationRecordId: nehaRecord.id,
        eventType: 'REQUEST_CREATED',
        actor: 'system',
        details: JSON.stringify({ erpHours: nehaErpHours, month }),
      },
      {
        reconciliationRecordId: nehaRecord.id,
        eventType: 'EMPLOYEE_SUBMITTED',
        actor: 'employee',
        details: JSON.stringify({
          confirmedHours: nehaConfirmed,
          erpHours: nehaErpHours,
          difference: nehaMatch.difference,
          result: nehaMatch.result,
        }),
      },
    ],
  });

  await prisma.messageLog.create({
    data: {
      reconciliationRecordId: nehaRecord.id,
      channel: 'EMAIL',
      template: 'INITIAL_REQUEST',
      recipient: employees['EMP-1002'].email,
      subject: 'Please confirm your project hours for 2026-08',
      body: 'Seed data — initial request.',
      mocked: true,
    },
  });

  // Sample 3: Priya Menon — awaiting response (no submission yet), has a
  // live confirmation link for the demo.
  const priyaRecord = await prisma.reconciliationRecord.upsert({
    where: {
      employeeId_projectId_month: {
        employeeId: employees['EMP-1003'].id,
        projectId: projects['PRJ-ZEUS'].id,
        month,
      },
    },
    update: {},
    create: {
      month,
      employeeId: employees['EMP-1003'].id,
      projectId: projects['PRJ-ZEUS'].id,
      erpHours: 80,
      status: 'AWAITING_RESPONSE',
    },
  });

  await prisma.auditEvent.create({
    data: {
      reconciliationRecordId: priyaRecord.id,
      eventType: 'REQUEST_CREATED',
      actor: 'system',
      details: JSON.stringify({ erpHours: 80, month }),
    },
  });

  const priyaToken = await createConfirmationToken(priyaRecord.id, 'INITIAL');

  // Sample 4: Rohan Gupta — escalated (missed all reminders)
  const rohanRecord = await prisma.reconciliationRecord.upsert({
    where: {
      employeeId_projectId_month: {
        employeeId: employees['EMP-1004'].id,
        projectId: projects['PRJ-APOLLO'].id,
        month,
      },
    },
    update: {},
    create: {
      month,
      employeeId: employees['EMP-1004'].id,
      projectId: projects['PRJ-APOLLO'].id,
      erpHours: 64,
      status: 'ESCALATED',
      reminderCount: 2,
      escalated: true,
      escalatedAt: new Date(),
    },
  });

  await prisma.auditEvent.createMany({
    data: [
      {
        reconciliationRecordId: rohanRecord.id,
        eventType: 'REQUEST_CREATED',
        actor: 'system',
        details: JSON.stringify({ erpHours: 64, month }),
      },
      {
        reconciliationRecordId: rohanRecord.id,
        eventType: 'REMINDER_SENT',
        actor: 'system',
        details: JSON.stringify({ reminderCount: 1 }),
      },
      {
        reconciliationRecordId: rohanRecord.id,
        eventType: 'REMINDER_SENT',
        actor: 'system',
        details: JSON.stringify({ reminderCount: 2 }),
      },
      {
        reconciliationRecordId: rohanRecord.id,
        eventType: 'ESCALATED',
        actor: 'system',
        details: JSON.stringify({ escalatedTo: 'hr-escalations@example.com' }),
      },
    ],
  });

  // Sample 5: Rudra Sharma — pending records for Google Chat verification
  await prisma.reconciliationRecord.upsert({
    where: {
      employeeId_projectId_month: {
        employeeId: employees['EMP-1005'].id,
        projectId: projects['PRJ-HOLIDAY'].id,
        month,
      },
    },
    update: {},
    create: {
      month,
      employeeId: employees['EMP-1005'].id,
      projectId: projects['PRJ-HOLIDAY'].id,
      erpHours: 8,
      status: 'AWAITING_RESPONSE',
    },
  });

  await prisma.reconciliationRecord.upsert({
    where: {
      employeeId_projectId_month: {
        employeeId: employees['EMP-1005'].id,
        projectId: projects['PRJ-LEARNING'].id,
        month,
      },
    },
    update: {},
    create: {
      month,
      employeeId: employees['EMP-1005'].id,
      projectId: projects['PRJ-LEARNING'].id,
      erpHours: 120,
      status: 'AWAITING_RESPONSE',
    },
  });

  console.log('Seed complete.');
  console.log('--- Demo links (mock mode — no real email is sent) ---');
  console.log(`Amit Shah correction link:  /confirm/${amitToken.rawToken}`);
  console.log(`Priya Menon initial link:   /confirm/${priyaToken.rawToken}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
