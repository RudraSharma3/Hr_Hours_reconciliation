'use client';

import { useEffect, useState } from 'react';

type RecordInfo = {
  id: string;
  employeeName: string;
  projectName: string;
  month: string;
  erpHours: number;
  status: string;
  previousConfirmedHours: number | null;
  previousDifference: number | null;
  isCorrection: boolean;
};

type Props = { params: { token: string } };

export default function ConfirmPage({ params }: Props) {
  const { token } = params;
  const [info, setInfo] = useState<RecordInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState('');
  const [explanation, setExplanation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<{ status: string; result: number | null; difference: number | null } | null>(
    null
  );

  useEffect(() => {
    fetch(`/api/confirm/${token}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? 'LINK_INVALID');
        }
        return r.json();
      })
      .then((d) => setInfo(d.record))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsedHours = Number(hours);
    if (!Number.isFinite(parsedHours) || parsedHours < 0) {
      setError('Enter a valid, non-negative number of hours.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/confirm/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmedHours: parsedHours, explanation: explanation || undefined }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Submission failed');
        return;
      }
      setOutcome(body);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <CenteredCard>Loading...</CenteredCard>;
  }

  if (error && !info) {
    return (
      <CenteredCard>
        <h1 className="text-lg font-semibold text-slate-900 mb-2">This link can&apos;t be used</h1>
        <p className="text-sm text-slate-600">
          {error === 'EXPIRED' && 'This confirmation link has expired. Please contact HR for a new one.'}
          {error === 'ALREADY_USED' && 'This confirmation link has already been used.'}
          {error === 'NOT_FOUND' && 'This confirmation link is not valid.'}
          {!['EXPIRED', 'ALREADY_USED', 'NOT_FOUND'].includes(error) && 'This confirmation link is not valid.'}
        </p>
      </CenteredCard>
    );
  }

  if (outcome) {
    return (
      <CenteredCard>
        {outcome.result === 1 ? (
          <>
            <h1 className="text-lg font-semibold text-emerald-700 mb-2">Thanks — hours confirmed!</h1>
            <p className="text-sm text-slate-600">
              Your confirmed hours matched the ERP timesheet exactly. No further action is needed.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-amber-700 mb-2">Submitted — under review</h1>
            <p className="text-sm text-slate-600">
              We recorded a difference of {outcome.difference} hour(s) between your confirmation and the ERP
              timesheet. HR has been notified automatically and may follow up with you.
            </p>
          </>
        )}
      </CenteredCard>
    );
  }

  if (!info) return null;

  return (
    <CenteredCard wide>
      <h1 className="text-lg font-semibold text-slate-900 mb-1">
        {info.isCorrection ? 'Please review your hours' : 'Confirm your project hours'}
      </h1>
      <p className="text-sm text-slate-500 mb-4">
        {info.employeeName} · {info.projectName} · {info.month}
      </p>

      {info.isCorrection && info.previousConfirmedHours !== null && (
        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 mb-4 text-sm text-amber-800">
          Our records show a difference between your last confirmation ({info.previousConfirmedHours} hrs) and the
          ERP timesheet ({info.erpHours} hrs) — a difference of {info.previousDifference}. Please re-confirm the
          correct number of hours, or explain the discrepancy below.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">Hours you worked on {info.projectName} in {info.month}</label>
          <input
            className="input"
            type="number"
            min={0}
            step={0.5}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">
            Explanation {info.isCorrection ? '(recommended if hours differ from ERP)' : '(optional)'}
          </label>
          <textarea
            className="input"
            rows={3}
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            placeholder="e.g. I was on leave for 2 days that were not recorded in ERP..."
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={submitting}>
          {submitting ? 'Submitting...' : 'Submit'}
        </button>
      </form>
    </CenteredCard>
  );
}

function CenteredCard({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className={`w-full ${wide ? 'max-w-md' : 'max-w-sm'} card p-6`}>{children}</div>
    </div>
  );
}
