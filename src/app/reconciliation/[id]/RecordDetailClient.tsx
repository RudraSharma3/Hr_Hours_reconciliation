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

  async function handleApprove() {
    setResolving(true);
    try {
      await fetch(`/api/reconciliation/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', note: note || 'Approved by HR' }),
      });
      load();
      setNote('');
    } finally {
      setResolving(false);
    }
  }

  async function handleReject() {
    if (!note.trim()) {
      alert('Please enter a note explaining why this justification is being rejected.');
      return;
    }
    setResolving(true);
    try {
      await fetch(`/api/reconciliation/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', rejectionReason: note.trim() }),
      });
      load();
      setNote('');
    } finally {
      setResolving(false);
    }
  }

  async function handleSendCard(e: React.FormEvent) {
    e.preventDefault();
    if (!testEmail) return;
    setSendingEmail(true);
    setEmailStatus(null);
    try {
      const res = await fetch(`/api/reconciliation/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send_chat_card', recipient: testEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEmailStatus({ success: false, message: data.error ?? 'Failed to dispatch card' });
      } else {
        setEmailStatus({
          success: true,
          message: data.mocked
            ? `[Demo Mode] Google Chat Card logged for ${data.recipient}. In live mode, this card appears directly in Google Chat.`
            : `🎉 Interactive Google Chat card successfully pushed to ${data.recipient}!`,
        });
        load();
      }
    } catch {
      setEmailStatus({ success: false, message: 'Network error dispatching card' });
    } finally {
      setSendingEmail(false);
    }
  }

  if (loading || !record) return <p className="text-sm text-slate-500">Loading...</p>;

  const canDecide = ['FLAGGED', 'CORRECTION_REQUESTED', 'ESCALATED', 'AWAITING_RESPONSE'].includes(record.status);

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

      {/* Instant Dispatch / Test Card */}
      <div className="card p-5 border-2 border-slate-200 bg-slate-50/50">
        <h2 className="text-sm font-bold text-slate-900 mb-1 flex items-center gap-2">
          <span>🤖</span> Push Google Chat Blind Verification Card
        </h2>
        <p className="text-xs text-slate-500 mb-3">
          Push the interactive blind question card to the employee&apos;s Google Chat space immediately for live testing.
        </p>
        <form onSubmit={handleSendCard} className="flex flex-wrap items-center gap-3">
          <input
            type="email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="employee@company.com"
            className="input text-sm flex-1 min-w-[240px] bg-white font-medium"
            required
          />
          <button
            type="submit"
            disabled={sendingEmail}
            className="btn-primary bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-4 py-2.5 font-semibold rounded-lg flex items-center gap-1.5 shadow-sm"
          >
            {sendingEmail ? 'Pushing...' : '🚀 Push Bot Card to Google Chat'}
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
          <p className="text-xs font-medium text-slate-500">ERP timesheet</p>
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

      {/* Discrepancy & Justification Review Box */}
      {(record.status === 'FLAGGED' || record.difference) && (
        <div className="card p-5 border-2 border-amber-300 bg-amber-50/60 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-amber-950 flex items-center gap-1.5">
              <span>⚠️</span> Hours Discrepancy Awaiting HR Review
            </span>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-amber-200 text-amber-900">
              Diff: {record.difference} hrs
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="bg-white p-3 rounded-lg border border-amber-200">
              <span className="text-slate-500 font-medium">ERP Timesheet:</span>
              <p className="text-sm font-bold text-slate-800 mt-0.5">{record.erpHours} hrs</p>
            </div>
            <div className="bg-white p-3 rounded-lg border border-amber-200">
              <span className="text-slate-500 font-medium">Employee Stated:</span>
              <p className="text-sm font-bold text-indigo-700 mt-0.5">{record.employeeConfirmedHours} hrs</p>
            </div>
          </div>

          {record.employeeExplanation ? (
            <div className="bg-white p-4 rounded-lg border border-amber-200 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wider text-amber-900 mb-1">
                Employee Stated Justification:
              </p>
              <p className="text-sm text-slate-800 font-medium italic">&quot;{record.employeeExplanation}&quot;</p>
            </div>
          ) : (
            <p className="text-xs text-amber-800 italic">
              Employee has entered hours differing from ERP. Waiting for employee to submit justification via Google Chat.
            </p>
          )}
        </div>
      )}

      {/* HR Decision & Approval Box */}
      {canDecide && (
        <div className="card p-5 border-2 border-slate-200 bg-white space-y-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900">HR Decision & Actions</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Review the employee&apos;s justification. You can approve to finalize or reject to request revised timesheet hours.
            </p>
          </div>

          <div>
            <label className="label text-xs">HR Decision Notes / Rejection Reason</label>
            <textarea
              className="input text-sm bg-slate-50"
              rows={2}
              placeholder="e.g. Overtime approved by project lead, adjustments reflected in payroll..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              className="btn-primary bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs px-4 py-2.5 rounded-lg flex items-center gap-1.5 shadow-sm"
              onClick={handleApprove}
              disabled={resolving}
            >
              {resolving ? 'Processing...' : '✓ Approve Justification (Mark Resolved)'}
            </button>
            <button
              className="btn-secondary text-red-700 hover:bg-red-50 border-red-200 font-semibold text-xs px-4 py-2.5 rounded-lg flex items-center gap-1.5"
              onClick={handleReject}
              disabled={resolving}
            >
              {resolving ? 'Processing...' : '✕ Reject Justification'}
            </button>
          </div>
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
