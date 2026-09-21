import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/auth/admin';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding minimal database (Admin & Settings only)...');

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
  console.log(`Admin user ready: ${admin.email} / ${adminPassword}`);

  // --- Settings ------------------------------------------------------------
  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });

  // Provision Rudra Sharma profile and sample projects for local bot testing
  const rudra = await prisma.employee.upsert({
    where: { email: 'rudra@bytepx.com' },
    update: { name: 'Rudra Sharma' },
    create: {
      employeeCode: 'EMP-1005',
      name: 'Rudra Sharma',
      email: 'rudra@bytepx.com',
    },
  });

  const proj1 = await prisma.project.upsert({
    where: { projectCode: 'PRJ-LEARNING' },
    update: { name: 'Learning Phase' },
    create: { projectCode: 'PRJ-LEARNING', name: 'Learning Phase' },
  });

  const proj2 = await prisma.project.upsert({
    where: { projectCode: 'PRJ-HOLIDAY' },
    update: { name: 'National Holiday' },
    create: { projectCode: 'PRJ-HOLIDAY', name: 'National Holiday' },
  });

  const proj3 = await prisma.project.upsert({
    where: { projectCode: 'PRJ-DATATOOL' },
    update: { name: 'Data Tool' },
    create: { projectCode: 'PRJ-DATATOOL', name: 'Data Tool' },
  });

  // Seed sample reconciliation records for 2026-08
  await prisma.reconciliationRecord.upsert({
    where: {
      employeeId_projectId_month: {
        employeeId: rudra.id,
        projectId: proj1.id,
        month: '2026-08',
      },
    },
    update: { erpHours: 120, status: 'AWAITING_RESPONSE' },
    create: {
      employeeId: rudra.id,
      projectId: proj1.id,
      month: '2026-08',
      erpHours: 120,
      status: 'AWAITING_RESPONSE',
    },
  });

  await prisma.reconciliationRecord.upsert({
    where: {
      employeeId_projectId_month: {
        employeeId: rudra.id,
        projectId: proj2.id,
        month: '2026-08',
      },
    },
    update: { erpHours: 8, status: 'AWAITING_RESPONSE' },
    create: {
      employeeId: rudra.id,
      projectId: proj2.id,
      month: '2026-08',
      erpHours: 8,
      status: 'AWAITING_RESPONSE',
    },
  });

  await prisma.reconciliationRecord.upsert({
    where: {
      employeeId_projectId_month: {
        employeeId: rudra.id,
        projectId: proj3.id,
        month: '2026-08',
      },
    },
    update: { erpHours: 40, status: 'AWAITING_RESPONSE' },
    create: {
      employeeId: rudra.id,
      projectId: proj3.id,
      month: '2026-08',
      erpHours: 40,
      status: 'AWAITING_RESPONSE',
    },
  });

  console.log('Database ready with test reconciliation records for Rudra Sharma.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
