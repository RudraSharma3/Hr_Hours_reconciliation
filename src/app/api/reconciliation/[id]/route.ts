import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentAdmin } from '@/lib/auth/admin';
import { resolveRecord, sendConfirmationEmailForRecord } from '@/lib/reconciliationService';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const record = await prisma.reconciliationRecord.findUnique({
    where: { id: params.id },
    include: {
      employee: true,
      project: true,
      auditEvents: { orderBy: { createdAt: 'asc' } },
      messages: { orderBy: { sentAt: 'asc' } },
      confirmationTokens: {
        select: { id: true, purpose: true, expiresAt: true, usedAt: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ record });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  if (body.action === 'resolve') {
    await resolveRecord(params.id, admin.email, body.note);
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'send_email') {
    try {
      const result = await sendConfirmationEmailForRecord(params.id, body.recipient);
      return NextResponse.json(result);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to send email' },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
