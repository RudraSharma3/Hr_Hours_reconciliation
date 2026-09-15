import { NextRequest, NextResponse } from 'next/server';
import { importErpCsv } from '@/lib/erpImportService';
import { getCurrentAdmin } from '@/lib/auth/admin';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');

  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No CSV file uploaded' }, { status: 400 });
  }

  const fileContent = await file.text();
  const fileName = (file as File).name ?? 'upload.csv';

  try {
    const result = await importErpCsv(fileName, fileContent);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Import failed' },
      { status: 500 }
    );
  }
}

// Recent import batches, for the ERP import page's history list.
export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const batches = await prisma.erpImportBatch.findMany({
    orderBy: { importedAt: 'desc' },
    take: 20,
    select: {
      id: true,
      fileName: true,
      importedAt: true,
      rowCount: true,
      successCount: true,
      errorCount: true,
    },
  });

  return NextResponse.json({ batches });
}
