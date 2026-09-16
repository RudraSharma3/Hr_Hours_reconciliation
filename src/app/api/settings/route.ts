import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentAdmin } from '@/lib/auth/admin';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings) settings = await prisma.settings.create({ data: { id: 1 } });
  return NextResponse.json({ settings });
}

const schema = z.object({
  reminderIntervalDays: z.number().int().min(1).max(60),
  maxReminders: z.number().int().min(0).max(10),
  escalationEmail: z.string().email(),
  initialRequestSubject: z.string().min(1),
  initialRequestBody: z.string().min(1),
  mismatchSubject: z.string().min(1),
  mismatchBody: z.string().min(1),
  reminderSubject: z.string().min(1),
  reminderBody: z.string().min(1),
  escalationSubject: z.string().min(1),
  escalationBody: z.string().min(1),
});

export async function PUT(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const settings = await prisma.settings.upsert({
    where: { id: 1 },
    update: parsed.data,
    create: { id: 1, ...parsed.data },
  });

  return NextResponse.json({ settings });
}
