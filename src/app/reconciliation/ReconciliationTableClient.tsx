'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import StatusBadge from '@/components/StatusBadge';

type Record = {
  id: string;
  month: string;
  erpHours: number;
  employeeConfirmedHours: number | null;
  difference: number | null;
  result: number | null;
  status: string;
  reminderCount: number;
  createdAt: string;
  employee: { id: string; name: string; employeeCode: string };
  project: { id: string; name: string; projectCode: string };
};

type Option = { id: string; name: string; employeeCode?: string; projectCode?: string };

const STATUS_OPTIONS = [
  '',
  'AWAITING_RESPONSE',
  'MATCHED',
  'FLAGGED',
  'CORRECTION_REQUESTED',
  'RESOLVED',
  'ESCALATED',
];

function ReconciliationTable() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [records, setRecords] = useState<Record[]>([]);
  const [employees, setEmployees] = useState<Option[]>([]);
  const [projects, setProjects] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);

  const [month, setMonth] = useState(searchParams.get('month') ?? '');
  const [status, setStatus] = useState(searchParams.get('status') ?? '');
  const [employee, setEmployee] = useState(searchParams.get('employee') ?? '');
  const [project, setProject] = useState(searchParams.get('project') ?? '');
  const [q, setQ] = useState(searchParams.get('q') ?? '');

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (month) params.set('month', month);
    if (status) params.set('status', status);
    if (employee) params.set('employee', employee);
    if (project) params.set('project', project);
    if (q) params.set('q', q);
    return params.toString();
  }, [month, status, employee, project, q]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/reconciliation?${queryString}`)
      .then((r) => r.json())
      .then((d) => {
        setRecords(d.records ?? []);
        setEmployees(d.employees ?? []);
        setProjects(d.projects ?? []);
      })
      .finally(() => setLoading(false));
    router.replace(`/reconciliation${queryString ? `?${queryString}` : ''}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Reconciliation Records</h1>
          <p className="text-sm text-slate-500 mt-1">Search and filter across every employee/project/month.</p>
        </div>
        <a href={`/api/reconciliation/export?${queryString}`} className="btn-secondary">
          Export CSV
        </a>
      </div>

      <div className="card p-4 mb-4 grid grid-cols-1 sm:grid-cols-5 gap-3">
        <input
          className="input"
          placeholder="Search name/code..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <input
          className="input"
          placeholder="Month (YYYY-MM)"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s ? s.replaceAll('_', ' ') : 'All statuses'}
            </option>
          ))}
        </select>
        <select className="input" value={employee} onChange={(e) => setEmployee(e.target.value)}>
          <option value="">All employees</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} ({e.employeeCode})
            </option>
          ))}
        </select>
        <select className="input" value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.projectCode})
            </option>
          ))}
        </select>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="py-2 px-4">Employee</th>
              <th className="py-2 px-4">Project</th>
              <th className="py-2 px-4">Month</th>
              <th className="py-2 px-4">ERP hrs</th>
              <th className="py-2 px-4">Confirmed</th>
              <th className="py-2 px-4">Diff</th>
              <th className="py-2 px-4">Status</th>
              <th className="py-2 px-4"></th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="py-2 px-4">
                  {r.employee.name}
                  <div className="text-xs text-slate-400">{r.employee.employeeCode}</div>
                </td>
                <td className="py-2 px-4">
                  {r.project.name}
                  <div className="text-xs text-slate-400">{r.project.projectCode}</div>
                </td>
                <td className="py-2 px-4">{r.month}</td>
                <td className="py-2 px-4">{r.erpHours}</td>
                <td className="py-2 px-4">{r.employeeConfirmedHours ?? '—'}</td>
                <td className="py-2 px-4">{r.difference ?? '—'}</td>
                <td className="py-2 px-4">
                  <StatusBadge status={r.status} />
                </td>
                <td className="py-2 px-4">
                  <Link href={`/reconciliation/${r.id}`} className="text-brand-600 hover:underline">
                    View
                  </Link>
                </td>
              </tr>
            ))}
            {!loading && records.length === 0 && (
              <tr>
                <td colSpan={8} className="py-6 text-center text-slate-400">
                  No records match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ReconciliationTableClient() {
  return (
    <Suspense>
      <ReconciliationTable />
    </Suspense>
  );
}
