import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentAdmin } from '@/lib/auth/admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [total, matched, flagged, awaiting, resolved, escalated, correctionRequested, recentRecords, recordsGrouped] =
    await Promise.all([
      prisma.reconciliationRecord.count(),
      prisma.reconciliationRecord.count({ where: { status: 'MATCHED' } }),
      prisma.reconciliationRecord.count({ where: { status: 'FLAGGED' } }),
      prisma.reconciliationRecord.count({ where: { status: 'AWAITING_RESPONSE' } }),
      prisma.reconciliationRecord.count({ where: { status: 'RESOLVED' } }),
      prisma.reconciliationRecord.count({ where: { status: 'ESCALATED' } }),
      prisma.reconciliationRecord.count({ where: { status: 'CORRECTION_REQUESTED' } }),
      prisma.reconciliationRecord.findMany({
        take: 10,
        orderBy: [{ month: 'desc' }, { createdAt: 'desc' }],
        include: { employee: true, project: true },
      }),
      prisma.reconciliationRecord.groupBy({
        by: ['month', 'status'],
        _count: { _all: true },
      }),
    ]);

  // Aggregate by month
  const monthMap: Record<string, { month: string; total: number; matched: number; flagged: number; awaiting: number }> = {};
  for (const group of recordsGrouped) {
    if (!monthMap[group.month]) {
      monthMap[group.month] = { month: group.month, total: 0, matched: 0, flagged: 0, awaiting: 0 };
    }
    const count = group._count._all;
    monthMap[group.month].total += count;
    if (group.status === 'MATCHED' || group.status === 'RESOLVED') {
      monthMap[group.month].matched += count;
    } else if (group.status === 'FLAGGED' || group.status === 'CORRECTION_REQUESTED' || group.status === 'ESCALATED') {
      monthMap[group.month].flagged += count;
    } else {
      monthMap[group.month].awaiting += count;
    }
  }

  const monthlyBreakdown = Object.values(monthMap).sort((a, b) => b.month.localeCompare(a.month));

  return NextResponse.json({
    totalRequests: total,
    matched,
    flagged: flagged + correctionRequested,
    awaitingResponse: awaiting,
    resolved,
    unresolvedEscalations: escalated,
    monthlyBreakdown,
    recentRecords: recentRecords.map((r) => ({
      id: r.id,
      month: r.month,
      erpHours: r.erpHours,
      employeeConfirmedHours: r.employeeConfirmedHours,
      difference: r.difference,
      status: r.status,
      employee: { name: r.employee.name, employeeCode: r.employee.employeeCode },
      project: { name: r.project.name, projectCode: r.project.projectCode },
    })),
  });
}
