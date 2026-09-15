'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Summary = {
  totalRequests: number;
  matched: number;
  flagged: number;
  awaitingResponse: number;
  resolved: number;
  unresolvedEscalations: number;
};

const CARDS: { key: keyof Summary; label: string; accent: string; href?: string }[] = [
  { key: 'totalRequests', label: 'Total requests', accent: 'text-slate-900', href: '/reconciliation' },
  { key: 'matched', label: 'Matched records', accent: 'text-emerald-600', href: '/reconciliation?status=MATCHED' },
  { key: 'flagged', label: 'Flagged records', accent: 'text-red-600', href: '/reconciliation?status=FLAGGED' },
  {
    key: 'awaitingResponse',
    label: 'Awaiting response',
    accent: 'text-amber-600',
    href: '/reconciliation?status=AWAITING_RESPONSE',
  },
  { key: 'resolved', label: 'Resolved records', accent: 'text-slate-600', href: '/reconciliation?status=RESOLVED' },
  {
    key: 'unresolvedEscalations',
    label: 'Unresolved escalations',
    accent: 'text-purple-600',
    href: '/reconciliation?status=ESCALATED',
  },
];

export default function DashboardClient() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then(setSummary)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            Only unresolved exceptions need your attention — everything else is automated.
          </p>
        </div>
        <Link href="/reconciliation?status=ESCALATED" className="btn-primary">
          Review escalations
        </Link>
      </div>

      {loading || !summary ? (
        <p className="text-sm text-slate-500">Loading...</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {CARDS.map((c) => {
            const value = summary[c.key];
            const content = (
              <div className="card p-5 hover:shadow-md transition-shadow">
                <p className="text-sm text-slate-500">{c.label}</p>
                <p className={`text-3xl font-semibold mt-2 ${c.accent}`}>{value}</p>
              </div>
            );
            return c.href ? (
              <Link key={c.key} href={c.href}>
                {content}
              </Link>
            ) : (
              <div key={c.key}>{content}</div>
            );
          })}
        </div>
      )}

      <div className="mt-8 card p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-2">How the automation works</h2>
        <ol className="text-sm text-slate-600 space-y-1 list-decimal list-inside">
          <li>ERP timesheets are imported (CSV today, API-ready) at the end of each month.</li>
          <li>Each employee automatically gets a secure link to confirm their hours per project.</li>
          <li>Submissions are compared to ERP hours with zero tolerance — any difference is flagged.</li>
          <li>Flagged records automatically get a follow-up; non-responders get reminders, then escalation.</li>
          <li>You only need to review records that reach <strong>Escalated</strong> or need manual resolution.</li>
        </ol>
      </div>
    </div>
  );
}
