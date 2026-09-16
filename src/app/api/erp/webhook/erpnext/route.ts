import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { importFromErpNext } from '@/lib/erpImportService';

export const dynamic = 'force-dynamic';

/**
 * Real-time ERPNext integration, driven by ERPNext's own built-in
 * "Webhook" doctype (Settings > Webhook in ERPNext) rather than any custom
 * code on the ERP side. Configure one there:
 *
 *   Doctype:        Timesheet
 *   Doc Event:      on_submit  (fire whenever HR/employee submits a Timesheet)
 *   Request URL:    https://<your-app>/api/erp/webhook/erpnext
 *   Request Method: POST
 *   Enable Security: checked, with a Webhook Secret — ERPNext then signs
 *                    every request with `X-Frappe-Webhook-Signature`
 *                    (base64 HMAC-SHA256 of the raw body, keyed with that
 *                    secret). Set the SAME value as ERPNEXT_WEBHOOK_SECRET
 *                    in .env — this route verifies that signature and
 *                    rejects anything that doesn't match, rather than
 *                    trusting a static bearer token.
 *
 * On receipt, we deliberately do NOT trust the numbers in the webhook
 * payload directly — we treat it purely as a trigger ("employee X's
 * timesheet changed") and re-fetch + re-aggregate everything for that
 * employee + month from ERPNext's API (via importFromErpNext). That
 * correctly handles amendments/cancellations and avoids double-counting
 * if ERPNext ever retries a delivery.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.ERPNEXT_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'ERPNEXT_WEBHOOK_SECRET is not configured' }, { status: 500 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get('x-frappe-webhook-signature');

  if (!signature || !isValidSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
  }

  let payload: { employee?: string; start_date?: string; end_date?: string };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const employeeCode = payload.employee;
  const referenceDate = payload.start_date ?? payload.end_date;

  if (!employeeCode || !referenceDate) {
    return NextResponse.json(
      { error: 'Payload missing employee/start_date — check the ERPNext Webhook field selection' },
      { status: 400 }
    );
  }

  const month = referenceDate.slice(0, 7); // "2026-09-07" -> "2026-09"

  try {
    const result = await importFromErpNext(month, employeeCode);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Ingestion failed' }, { status: 500 });
  }
}

function isValidSignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
