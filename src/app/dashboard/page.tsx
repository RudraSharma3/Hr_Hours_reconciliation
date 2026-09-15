import AdminShell from '@/components/AdminShell';
import DashboardClient from './DashboardClient';

export default function DashboardPage() {
  return (
    <AdminShell>
      <DashboardClient />
    </AdminShell>
  );
}
