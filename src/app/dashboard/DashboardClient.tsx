'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import StatusBadge from '@/components/StatusBadge';

type MonthlyBreakdown = {
  month: string;
  total: number;
  matched: number;
  flagged: number;
  awaiting: number;
};

type RecentRecord = {
  id: string;
  month: string;
  erpHours: number;
  employeeConfirmedHours: number | null;
  difference: number | null;
  status: string;
  employee: { name: string; employeeCode: string };
  project: { name: string; projectCode: string };
};

type Summary = {
  totalRequests: number;
  matched: number;
  flagged: number;
  awaitingResponse: number;
  resolved: number;
  unresolvedEscalations: number;
  monthlyBreakdown?: MonthlyBreakdown[];
  recentRecords?: RecentRecord[];
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
  const [resetting, setResetting] = useState(false);
  const [triggeringBot, setTriggeringBot] = useState(false);
  const [botStatus, setBotStatus] = useState<string | null>(null);

  function loadDashboard() {
    setLoading(true);
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then(setSummary)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  async function handleTriggerBot() {
    setTriggeringBot(true);
    setBotStatus(null);
    try {
      const res = await fetch('/api/reconciliation/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setBotStatus(`❌ Failed: ${data.error ?? 'Unknown error'}`);
      } else {
        setBotStatus(`🚀 ${data.message ?? `Triggered ${data.sentCount} bot cards.`}`);
        loadDashboard();
      }
    } catch {
      setBotStatus('❌ Network error triggering bot messages.');
    } finally {
      setTriggeringBot(false);
    }
  }

  async function handleResetData() {
    if (!window.confirm('Are you sure you want to clear all data? This will remove all dummy records, ERP batches, and reconciliation records, giving you a completely clean slate with 0 records.')) {
      return;
    }
    setResetting(true);
    try {
      const res = await fetch('/api/admin/reset-data', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? 'Failed to reset data');
        return;
      }
      loadDashboard();
    } catch {
      alert('Network error resetting data.');
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            Zero-knowledge bot asks employees their hours → automated match verification or HR justification review.
          </p>
        </div>
        <div className="flex items-center flex-wrap gap-2.5">
          <button
            type="button"
            onClick={handleTriggerBot}
            disabled={triggeringBot}
            className="px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <span>🚀</span> {triggeringBot ? 'Triggering Bot...' : 'Trigger Bot to Pending Employees'}
          </button>
          <button
            type="button"
            onClick={handleResetData}
            disabled={resetting}
            className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <span>🗑️</span> {resetting ? 'Resetting...' : 'Reset to 0'}
          </button>
          <Link href="/erp-import" className="btn-secondary text-xs">
            + Import ERP
          </Link>
          <Link href="/reconciliation" className="btn-primary text-xs">
            View all records
          </Link>
        </div>
      </div>

      {botStatus && (
        <div className="p-3.5 rounded-lg bg-indigo-50 border border-indigo-200 text-xs font-medium text-indigo-900 flex items-center justify-between">
          <span>{botStatus}</span>
          <button onClick={() => setBotStatus(null)} className="text-indigo-500 hover:text-indigo-800 font-bold ml-2">
            ✕
          </button>
        </div>
      )}

      {loading || !summary ? (
        <p className="text-sm text-slate-500">Loading metrics...</p>
      ) : (
        <>
          {/* Top KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {CARDS.map((c) => {
              const value = summary[c.key] as number;
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

          {/* Monthly Imported Batches Overview */}
          {summary.monthlyBreakdown && summary.monthlyBreakdown.length > 0 && (
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-slate-900">Imported Monthly Batches</h2>
                <span className="text-xs text-slate-500">{summary.monthlyBreakdown.length} months active</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {summary.monthlyBreakdown.map((m) => (
                  <Link
                    key={m.month}
                    href={`/reconciliation?month=${m.month}`}
                    className="p-4 rounded-lg border border-slate-200 hover:border-brand-500 hover:bg-slate-50 transition-colors block"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900 text-sm">📅 Month: {m.month}</span>
                      <span className="text-xs font-medium px-2 py-0.5 rounded bg-brand-50 text-brand-700">
                        {m.total} records
                      </span>
                    </div>
                    <div className="mt-3 text-xs text-slate-500 flex gap-3">
                      <span className="text-emerald-600 font-medium">✓ {m.matched} matched</span>
                      <span className="text-red-600 font-medium">⚠ {m.flagged} flagged</span>
                      <span className="text-amber-600 font-medium">⏳ {m.awaiting} awaiting</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Recent Records Table */}
          <div className="card overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Recent Reconciliation Records</h2>
                <p className="text-xs text-slate-500 mt-0.5">Showing latest imported records across all months</p>
              </div>
              <Link href="/reconciliation" className="text-sm font-medium text-brand-600 hover:text-brand-700">
                View all in Reconciliation &rarr;
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50">
                    <th className="py-2.5 px-4">Employee</th>
                    <th className="py-2.5 px-4">Project</th>
                    <th className="py-2.5 px-4">Month</th>
                    <th className="py-2.5 px-4">ERP hrs</th>
                    <th className="py-2.5 px-4">Confirmed</th>
                    <th className="py-2.5 px-4">Diff</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.recentRecords && summary.recentRecords.length > 0 ? (
                    summary.recentRecords.map((r) => (
                      <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-2.5 px-4">
                          <span className="font-medium text-slate-900">{r.employee.name}</span>
                          <div className="text-xs text-slate-400">{r.employee.employeeCode}</div>
                        </td>
                        <td className="py-2.5 px-4">
                          <span className="text-slate-800">{r.project.name}</span>
                          <div className="text-xs text-slate-400">{r.project.projectCode}</div>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-xs">{r.month}</td>
                        <td className="py-2.5 px-4 font-semibold">{r.erpHours} hrs</td>
                        <td className="py-2.5 px-4 text-slate-600">
                          {r.employeeConfirmedHours != null ? `${r.employeeConfirmedHours} hrs` : '—'}
                        </td>
                        <td className="py-2.5 px-4 text-slate-600">{r.difference != null ? `${r.difference} hrs` : '—'}</td>
                        <td className="py-2.5 px-4">
                          <StatusBadge status={r.status} />
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <Link href={`/reconciliation/${r.id}`} className="text-brand-600 hover:underline font-medium text-xs">
                            View Details
                          </Link>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-slate-400">
                        No records imported yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Guide Section */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-2">How the automation works</h2>
        <ol className="text-sm text-slate-600 space-y-1 list-decimal list-inside">
          <li>ERP timesheets are imported (CSV today, API-ready) at the end of each month.</li>
          <li>Each employee automatically gets a secure link / Google Chat card to confirm their hours per project.</li>
          <li>Submissions are compared to ERP hours with zero tolerance — any difference is flagged.</li>
          <li>Flagged records automatically get a follow-up; non-responders get reminders, then escalation.</li>
          <li>You only need to review records that reach <strong>Escalated</strong> or need manual resolution.</li>
        </ol>
      </div>
    </div>
  );
}
