import AdminShell from '@/components/AdminShell';
import ReconciliationTableClient from './ReconciliationTableClient';

export default function ReconciliationPage() {
  return (
    <AdminShell>
      <ReconciliationTableClient />
    </AdminShell>
  );
}
