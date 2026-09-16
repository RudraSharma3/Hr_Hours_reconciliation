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

  // Provision Rudra Sharma profile for seamless Google Chat Bot recognition
  await prisma.employee.upsert({
    where: { email: 'rudra@bytepx.com' },
    update: {},
    create: {
      employeeCode: 'EMP-1005',
      name: 'Rudra Sharma',
      email: 'rudra@bytepx.com',
    },
  });

  console.log('Database ready with 0 dummy reconciliation records. Clean slate for live imports.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
