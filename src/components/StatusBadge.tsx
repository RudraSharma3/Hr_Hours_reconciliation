const STATUS_STYLES: Record<string, string> = {
  AWAITING_RESPONSE: 'bg-amber-100 text-amber-800',
  MATCHED: 'bg-emerald-100 text-emerald-800',
  FLAGGED: 'bg-red-100 text-red-800',
  CORRECTION_REQUESTED: 'bg-orange-100 text-orange-800',
  RESOLVED: 'bg-slate-200 text-slate-700',
  ESCALATED: 'bg-purple-100 text-purple-800',
};

const STATUS_LABELS: Record<string, string> = {
  AWAITING_RESPONSE: 'Awaiting response',
  MATCHED: 'Matched',
  FLAGGED: 'Flagged',
  CORRECTION_REQUESTED: 'Correction requested',
  RESOLVED: 'Resolved',
  ESCALATED: 'Escalated',
};

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700'}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
