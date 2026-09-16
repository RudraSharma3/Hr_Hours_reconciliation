import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentAdmin } from '@/lib/auth/admin';
import { buildReconciliationCsv } from '@/lib/csvExport';
import type { Prisma } from '@prisma/client';
import type { ReconciliationStatus } from '@/lib/statusTypes';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const month = searchParams.get('month') ?? undefined;
  const status = searchParams.get('status') ?? undefined;

  const where: Prisma.ReconciliationRecordWhereInput = {
    ...(month ? { month } : {}),
    ...(status ? { status: status as ReconciliationStatus } : {}),
  };

  const records = await prisma.reconciliationRecord.findMany({
    where,
    include: { employee: true, project: true },
    orderBy: [{ month: 'desc' }, { createdAt: 'desc' }],
  });

  const csv = buildReconciliationCsv(
    records.map((r) => ({
      employeeCode: r.employee.employeeCode,
      employeeName: r.employee.name,
      employeeEmail: r.employee.email,
      projectCode: r.project.projectCode,
      projectName: r.project.name,
      month: r.month,
      erpHours: r.erpHours,
      employeeConfirmedHours: r.employeeConfirmedHours,
      difference: r.difference,
      result: r.result,
      status: r.status,
      employeeExplanation: r.employeeExplanation,
      reminderCount: r.reminderCount,
      createdAt: r.createdAt.toISOString(),
      finalisedAt: r.finalisedAt ? r.finalisedAt.toISOString() : null,
    }))
  );

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="reconciliation-export-${Date.now()}.csv"`,
    },
  });
}
