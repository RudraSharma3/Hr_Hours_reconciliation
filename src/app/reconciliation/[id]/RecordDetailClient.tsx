'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import StatusBadge from '@/components/StatusBadge';

type AuditEvent = {
  id: string;
  eventType: string;
  actor: string;
  details: string | null;
  createdAt: string;
};

type MessageLog = {
  id: string;
  channel: string;
  template: string;
  recipient: string;
  subject: string | null;
  body: string;
  mocked: boolean;
  sentAt: string;
};

type TokenInfo = {
  id: string;
  purpose: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
};

type RecordDetail = {
  id: string;
  month: string;
  erpHours: number;
  employeeConfirmedHours: number | null;
  difference: number | null;
  result: number | null;
  status: string;
  employeeExplanation: string | null;
  reminderCount: number;
  escalated: boolean;
  createdAt: string;
  finalisedAt: string | null;
  employee: { name: string; employeeCode: string; email: string };
  project: { name: string; projectCode: string };
  auditEvents: AuditEvent[];
  messages: MessageLog[];
  confirmationTokens: TokenInfo[];
};

export default function RecordDetailClient({ id }: { id: string }) {
  const [record, setRecord] = useState<RecordDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState('');

  // Test email state
  const [testEmail, setTestEmail] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState<{ success: boolean; message: string } | null>(null);

  function load() {
    setLoading(true);
    fetch(`/api/reconciliation/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setRecord(d.record);
        if (d.record && !testEmail) {
          setTestEmail(d.record.employee.email);
        }
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, [id]);

  async function handleResolve() {
    setResolving(true);
    try {
      await fetch(`/api/reconciliation/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve', note }),
      });
      load();
      setNote('');
    } finally {
      setResolving(false);
    }
  }

  async function handleSendEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!testEmail) return;
    setSendingEmail(true);
    setEmailStatus(null);
    try {
      const res = await fetch(`/api/reconciliation/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send_email', recipient: testEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEmailStatus({ success: false, message: data.error ?? 'Failed to send email' });
      } else {
        setEmailStatus({
          success: true,
          message: data.mocked
            ? `[Demo Mode] Email logged for ${data.recipient}. Set EMAIL_MODE=smtp in .env to deliver real emails to actual inboxes!`
            : `🎉 Real email successfully sent to ${data.recipient}! Check your inbox.`,
        });
        load();
      }
    } catch {
      setEmailStatus({ success: false, message: 'Network error sending email' });
    } finally {
      setSendingEmail(false);
    }
  }

  if (loading || !record) return <p className="text-sm text-slate-500">Loading...</p>;

  const canResolve = ['FLAGGED', 'CORRECTION_REQUESTED', 'ESCALATED'].includes(record.status);

  // Extract the latest confirmation URL from the message logs (e.g. http://.../confirm/...)
  const latestMessageWithLink = [...record.messages]
    .reverse()
    .find((m) => m.body.includes('/confirm/'));
  
  let latestLink: string | null = null;
  if (latestMessageWithLink) {
    const match = latestMessageWithLink.body.match(/https?:\/\/[^\s\n"']+/);
    if (match) {
      latestLink = match[0];
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/reconciliation" className="text-sm text-brand-600 hover:underline flex items-center gap-1">
          ← Back to reconciliation records
        </Link>

        <div className="flex items-center justify-between mt-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {record.employee.name} — {record.project.name}
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Code: <span className="font-medium text-slate-700">{record.employee.employeeCode}</span> · Email:{' '}
              <span className="font-medium text-slate-700">{record.employee.email}</span> · Month:{' '}
              <span className="font-medium text-slate-700">{record.month}</span>
            </p>
          </div>
          <StatusBadge status={record.status} />
        </div>
      </div>

      {/* Direct link banner for HR testing / access */}
      {latestLink && record.status !== 'MATCHED' && record.status !== 'RESOLVED' && (
        <div className="card p-5 bg-gradient-to-r from-indigo-50 to-blue-50 border-2 border-indigo-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-indigo-950 flex items-center gap-2">
              <span>📧</span> Employee Confirmation Link
            </p>
            <p className="text-xs text-indigo-800 mt-0.5">
              This is the secure link sent to {record.employee.name} to confirm their August hours.
            </p>
          </div>
          <a
            href={latestLink}
            target="_blank"
            rel="noreferrer"
            className="btn-primary bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 text-xs font-semibold rounded-lg shadow-sm whitespace-nowrap inline-flex items-center gap-2"
          >
            <span>🔗</span> Open Confirmation Page ↗
          </a>
        </div>
      )}

      {/* Test Email Card */}
      <div className="card p-5 border-2 border-slate-200 bg-slate-50/50">
        <h2 className="text-sm font-bold text-slate-900 mb-1 flex items-center gap-2">
          <span>✉️</span> Send / Test Email to Any Inbox
        </h2>
        <p className="text-xs text-slate-500 mb-3">
          Want to test receiving the real email in your own inbox? Enter your email address below and click send.
        </p>
        <form onSubmit={handleSendEmail} className="flex flex-wrap items-center gap-3">
          <input
            type="email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="your-email@example.com"
            className="input text-sm flex-1 min-w-[240px] bg-white font-medium"
            required
          />
          <button
            type="submit"
            disabled={sendingEmail}
            className="btn-primary bg-slate-800 hover:bg-slate-900 text-white text-xs px-4 py-2.5 font-semibold rounded-lg flex items-center gap-1.5"
          >
            {sendingEmail ? 'Sending...' : '📤 Send Email to This Address'}
          </button>
        </form>
        {emailStatus && (
          <div
            className={`mt-3 p-3 rounded-lg text-xs font-medium ${
              emailStatus.success ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            {emailStatus.message}
          </div>
        )}
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4">
          <p className="text-xs font-medium text-slate-500">ERP hours</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{record.erpHours} hrs</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium text-slate-500">Employee confirmed</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">
            {record.employeeConfirmedHours !== null ? `${record.employeeConfirmedHours} hrs` : '—'}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium text-slate-500">Difference</p>
          <p className={`text-2xl font-bold mt-1 ${record.difference ? 'text-red-600' : 'text-slate-900'}`}>
            {record.difference !== null ? `${record.difference} hrs` : '—'}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium text-slate-500">Reminders sent</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{record.reminderCount}</p>
        </div>
      </div>

      {/* Flagged Alert Box */}
      {(record.status === 'FLAGGED' || record.difference) && (
        <div className="card p-4 border-red-200 bg-red-50 text-red-900">
          <p className="text-sm font-semibold">⚠️ Hours Discrepancy Flagged</p>
          <p className="text-xs text-red-800 mt-1">
            The employee confirmed <strong>{record.employeeConfirmedHours} hrs</strong>, but ERP shows{' '}
            <strong>{record.erpHours} hrs</strong> (Difference: <strong>{record.difference} hrs</strong>).
          </p>
        </div>
      )}

      {/* Employee Explanation */}
      {record.employeeExplanation && (
        <div className="card p-4 bg-amber-50/50 border-amber-200">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-900 mb-1">
            Employee Explanation
          </p>
          <p className="text-sm text-slate-800">{record.employeeExplanation}</p>
        </div>
      )}

      {/* Resolution Box */}
      {canResolve && (
        <div className="card p-5 border-2 border-emerald-100 bg-emerald-50/30">
          <h2 className="text-sm font-bold text-slate-900 mb-1">Resolve this record</h2>
          <p className="text-xs text-slate-500 mb-3">
            If you have approved the hours or updated ERPNext, add a note and mark this resolved.
          </p>
          <textarea
            className="input mb-3 text-sm bg-white"
            rows={2}
            placeholder="e.g. Verified with team lead, leave days adjusted in payroll..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className="btn-primary bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleResolve} disabled={resolving}>
            {resolving ? 'Resolving...' : '✓ Mark as Resolved'}
          </button>
        </div>
      )}

      {/* Message History & Details */}
      <div className="card p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-3">Messages & Outbound Notifications</h2>
        <div className="space-y-4">
          {record.messages.map((m) => (
            <div key={m.id} className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-sm space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="font-semibold text-slate-800">{m.template.replaceAll('_', ' ')}</span>
                <span className="text-xs text-slate-500">
                  To: <span className="font-mono text-slate-700">{m.recipient}</span> · {new Date(m.sentAt).toLocaleString()}
                </span>
              </div>
              {m.subject && <p className="text-xs font-medium text-slate-700">Subject: {m.subject}</p>}
              <div className="text-xs text-slate-600 bg-white p-3 rounded border border-slate-200 whitespace-pre-wrap font-sans">
                {m.body.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
                  part.startsWith('http') ? (
                    <a key={i} href={part} target="_blank" rel="noreferrer" className="text-brand-600 font-medium underline break-all">
                      {part}
                    </a>
                  ) : (
                    part
                  )
                )}
              </div>
            </div>
          ))}
          {record.messages.length === 0 && <p className="text-sm text-slate-400">No messages logged yet.</p>}
        </div>
      </div>

      {/* Audit Trail */}
      <div className="card p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-3">Audit Trail</h2>
        <ol className="space-y-3">
          {record.auditEvents.map((e) => (
            <li key={e.id} className="text-sm border-l-2 border-slate-300 pl-3">
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-800">{e.eventType.replaceAll('_', ' ')}</span>
                <span className="text-xs text-slate-400">by {e.actor}</span>
                <span className="text-xs text-slate-400">{new Date(e.createdAt).toLocaleString()}</span>
              </div>
              {e.details && (
                <pre className="text-xs text-slate-500 mt-1 whitespace-pre-wrap break-words bg-slate-50 p-2 rounded">
                  {JSON.stringify(JSON.parse(e.details), null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
