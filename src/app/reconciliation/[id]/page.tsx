import AdminShell from '@/components/AdminShell';
import RecordDetailClient from './RecordDetailClient';

export default function ReconciliationDetailPage({ params }: { params: { id: string } }) {
  return (
    <AdminShell>
      <RecordDetailClient id={params.id} />
    </AdminShell>
  );
}
