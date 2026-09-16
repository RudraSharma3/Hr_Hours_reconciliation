import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { submitEmployeeConfirmation } from '@/lib/reconciliationService';

export const dynamic = 'force-dynamic';

/**
 * Inbound webhook Evolra should call when an employee replies to a
 * confirmation request sent via EvolraChatAdapter.
 *
 * ⚠️ PLACEHOLDER PAYLOAD SHAPE — same caveat as evolraChatAdapter.ts: I
 * don't have Evolra's actual outbound webhook schema, so this expects the
 * most natural shape (employee identity + the reconciliationRecordId we
 * originally sent + the value they entered). Confirm the real field names
 * with Evolra's team and adjust the zod schema below — everything past
 * validation (`submitEmployeeConfirmation`) is already fully built and
 * doesn't need to change.
 *
 * Auth: expects `Authorization: Bearer <EVOLRA_WEBHOOK_SECRET>`. If Evolra
 * supports HMAC-signing its webhook payloads (more secure, same approach as
 * the ERPNext webhook in src/app/api/erp/webhook/erpnext/route.ts), prefer
 * that instead and swap the check below.
 */
const payloadSchema = z.object({
  employeeEmail: z.string().email(),
  reconciliationRecordId: z.string().optional(), // see fallback note below
  confirmedHours: z.number().min(0).max(1000),
  explanation: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  const expectedSecret = process.env.EVOLRA_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ error: 'EVOLRA_WEBHOOK_SECRET is not configured' }, { status: 500 });
  }
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { employeeEmail, reconciliationRecordId, confirmedHours, explanation } = parsed.data;

  const record = reconciliationRecordId
    ? await prisma.reconciliationRecord.findUnique({ where: { id: reconciliationRecordId }, include: { employee: true } })
    : // Fallback if Evolra can't echo back metadata (see evolraChatAdapter.ts,
      // point 5) — picks this employee's single most recent open request.
      // Ambiguous if they have more than one pending at once; prefer fixing
      // metadata passthrough on Evolra's side over relying on this.
      await prisma.reconciliationRecord.findFirst({
        where: {
          employee: { email: employeeEmail },
          status: { in: ['AWAITING_RESPONSE', 'CORRECTION_REQUESTED'] },
        },
        include: { employee: true },
        orderBy: { createdAt: 'desc' },
      });

  if (!record) {
    return NextResponse.json({ error: 'No matching pending reconciliation record found' }, { status: 404 });
  }

  // Defense in depth: even though the record was looked up by id, confirm
  // the identity Evolra claims sent this reply actually owns that record —
  // an employee's reply must never be able to alter someone else's record.
  if (record.employee.email.toLowerCase() !== employeeEmail.toLowerCase()) {
    return NextResponse.json({ error: 'Employee does not match this reconciliation record' }, { status: 403 });
  }

  await submitEmployeeConfirmation({
    recordId: record.id,
    confirmedHours,
    explanation,
    isCorrection: record.status === 'CORRECTION_REQUESTED' || record.status === 'FLAGGED',
  });

  const updated = await prisma.reconciliationRecord.findUnique({ where: { id: record.id } });

  return NextResponse.json({ ok: true, status: updated?.status, result: updated?.result, difference: updated?.difference });
}
