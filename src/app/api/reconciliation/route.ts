import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentAdmin } from '@/lib/auth/admin';
import type { Prisma } from '@prisma/client';
import type { ReconciliationStatus } from '@/lib/statusTypes';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const month = searchParams.get('month') || undefined;
  const status = searchParams.get('status') || undefined;
  const employeeId = searchParams.get('employee') || undefined;
  const projectId = searchParams.get('project') || undefined;
  const q = searchParams.get('q') || undefined;

  const statusFilter =
    status === 'FLAGGED'
      ? { in: ['FLAGGED', 'CORRECTION_REQUESTED'] as ReconciliationStatus[] }
      : status
      ? (status as ReconciliationStatus)
      : undefined;

  const where: Prisma.ReconciliationRecordWhereInput = {
    ...(month ? { month } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(employeeId ? { employeeId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(q
      ? {
          OR: [
            { employee: { name: { contains: q } } },
            { employee: { employeeCode: { contains: q } } },
            { project: { name: { contains: q } } },
            { project: { projectCode: { contains: q } } },
          ],
        }
      : {}),
  };

  const [records, employees, projects] = await Promise.all([
    prisma.reconciliationRecord.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true, employeeCode: true, email: true } },
        project: { select: { id: true, name: true, projectCode: true } },
      },
      orderBy: [{ month: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    }),
    prisma.employee.findMany({
      where: { active: true },
      select: { id: true, name: true, employeeCode: true },
      orderBy: { name: 'asc' },
    }),
    prisma.project.findMany({
      where: { active: true },
      select: { id: true, name: true, projectCode: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  return NextResponse.json({ records, employees, projects });
}
