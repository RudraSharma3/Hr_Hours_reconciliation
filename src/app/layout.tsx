import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Employee Hours Reconciliation Automation',
  description: 'Automated ERP vs. employee timesheet reconciliation for HR.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
