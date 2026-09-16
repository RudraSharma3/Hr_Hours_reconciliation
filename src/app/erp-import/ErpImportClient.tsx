'use client';

import { useEffect, useRef, useState } from 'react';

type Batch = {
  id: string;
  fileName: string;
  importedAt: string;
  rowCount: number;
  successCount: number;
  errorCount: number;
};

type SyncResult = {
  batchId: string;
  imported: number;
  errors: { row: number; message: string }[];
};

export default function ErpImportClient() {
  const [batches, setBatches] = useState<Batch[]>([]);
  
  // Default to current year-month (e.g. 2026-09)
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [targetMonth, setTargetMonth] = useState(defaultMonth);

  // ERPNext Sync State
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Request Generation State
  const [generating, setGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState<{
    created: number;
    skippedExisting: number;
    skippedUnknownReference: number;
  } | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // CSV Fallback State
  const [showCsv, setShowCsv] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvResult, setCsvResult] = useState<SyncResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Reset Data State
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<string | null>(null);

  function loadBatches() {
    fetch('/api/erp/import')
      .then((r) => r.json())
      .then((d) => setBatches(d.batches ?? []))
      .catch(() => {});
  }

  useEffect(() => {
    loadBatches();
  }, []);

  async function handleResetData() {
    if (!window.confirm('Are you sure you want to clear all data? This will remove all dummy records, ERP batches, and reconciliation records, giving you a fresh clean slate with 0 records.')) {
      return;
    }
    setResetting(true);
    setResetResult(null);
    try {
      const res = await fetch('/api/admin/reset-data', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? 'Failed to reset data');
        return;
      }
      setResetResult('✨ All records and import history cleared successfully! Database is completely fresh with 0 records.');
      loadBatches();
    } catch {
      alert('Network error resetting data.');
    } finally {
      setResetting(false);
    }
  }

  // 1. Sync directly from ERPNext
  async function handleSyncErpNext(e: React.FormEvent) {
    e.preventDefault();
    setSyncError(null);
    setSyncResult(null);
    setSyncing(true);

    try {
      const res = await fetch('/api/erp/sync-erpnext', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: targetMonth }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSyncError(data.error ?? 'Failed to connect to ERPNext. Please check your .env settings.');
        return;
      }
      setSyncResult(data);
      loadBatches();
    } catch {
      setSyncError('Network error connecting to the server.');
    } finally {
      setSyncing(false);
    }
  }

  // 2. Generate and send requests to employees
  async function handleGenerateRequests() {
    setGenerating(true);
    setGenerateError(null);
    setGenerateResult(null);

    try {
      const res = await fetch('/api/reconciliation/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: targetMonth }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGenerateError(data.error ?? 'Failed to generate requests.');
        return;
      }
      setGenerateResult(data);
    } catch {
      setGenerateError('Network error generating requests.');
    } finally {
      setGenerating(false);
    }
  }

  // 3. Fallback CSV upload
  async function handleCsvUpload(e: React.FormEvent) {
    e.preventDefault();
    setCsvError(null);
    setCsvResult(null);
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setCsvError('Please select a CSV file first.');
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/erp/import', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        setCsvError(data.error ?? 'Import failed');
        return;
      }
      setCsvResult(data);
      loadBatches();
      if (fileInput.current) fileInput.current.value = '';
    } catch {
      setCsvError('Network error uploading CSV.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">ERP & Timesheet Sync</h1>
          <p className="text-sm text-slate-500">
            Sync monthly employee timesheets directly from ERPNext, or upload a manual CSV export. Reconciliation requests are generated automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={handleResetData}
          disabled={resetting}
          className="px-3 py-2 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors flex items-center gap-1.5 self-start sm:self-auto"
        >
          <span>🗑️</span> {resetting ? 'Resetting...' : 'Reset to 0 Records'}
        </button>
      </div>

      {resetResult && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 font-medium">
          {resetResult}
        </div>
      )}

      {/* Step 1: ERPNext Direct Sync Card */}
      <div className="card p-6 border-2 border-indigo-100 bg-gradient-to-br from-white to-indigo-50/30">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-sm">
            1
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">Sync Timesheets from ERPNext</h2>
            <p className="text-xs text-slate-500">Pull submitted timesheets automatically via ERPNext API</p>
          </div>
        </div>

        <form onSubmit={handleSyncErpNext} className="mt-4 flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
              Select Target Month
            </label>
            <input
              type="month"
              value={targetMonth}
              onChange={(e) => setTargetMonth(e.target.value)}
              className="input w-48 font-medium text-slate-900 bg-white"
              required
            />
          </div>

          <button
            type="submit"
            disabled={syncing}
            className="btn-primary bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg shadow-sm font-medium flex items-center gap-2 disabled:opacity-50"
          >
            {syncing ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                </svg>
                Syncing from ERPNext...
              </>
            ) : (
              <>
                <span>🔄</span> Fetch from ERPNext
              </>
            )}
          </button>
        </form>

        {syncError && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <strong>Sync Error:</strong> {syncError}
          </div>
        )}

        {syncResult && (
          <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-900">
            <p className="font-semibold flex items-center gap-2">
              <span className="text-emerald-600">✓</span> Successfully imported {syncResult.imported} employee-project timesheet record(s) for {targetMonth}!
            </p>
            {syncResult.errors.length > 0 && (
              <div className="mt-2 text-xs text-amber-800 bg-amber-50 p-2.5 rounded border border-amber-200">
                <p className="font-medium">{syncResult.errors.length} row(s) skipped:</p>
                <ul className="list-disc list-inside mt-1 space-y-0.5">
                  {syncResult.errors.map((e, idx) => (
                    <li key={idx}>{e.message}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Step 2: Generate Requests */}
      <div className="card p-6 border-2 border-emerald-100 bg-gradient-to-br from-white to-emerald-50/30">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-sm">
            2
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">Send Confirmation Requests to Employees</h2>
            <p className="text-xs text-slate-500">
              Generates secure one-time verification links and notifies employees for month {targetMonth}
            </p>
          </div>
        </div>

        <div className="mt-4">
          <button
            onClick={handleGenerateRequests}
            disabled={generating}
            className="btn-primary bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-lg shadow-sm font-medium flex items-center gap-2 disabled:opacity-50"
          >
            {generating ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                </svg>
                Generating Requests...
              </>
            ) : (
              <>
                <span>🚀</span> Send Requests to Employees
              </>
            )}
          </button>
        </div>

        {generateError && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <strong>Error:</strong> {generateError}
          </div>
        )}

        {generateResult && (
          <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-900">
            <p className="font-semibold">
              🎉 Created {generateResult.created} new reconciliation request(s)!
            </p>
            <p className="text-xs text-slate-600 mt-1">
              • {generateResult.skippedExisting} employee records already had open requests for this month.
              {generateResult.skippedUnknownReference > 0 && (
                <> • {generateResult.skippedUnknownReference} skipped due to unknown employee/project reference.</>
              )}
            </p>
          </div>
        )}
      </div>

      {/* Optional: CSV Manual Upload Accordion */}
      <div className="card p-5 border border-slate-200">
        <button
          type="button"
          onClick={() => setShowCsv(!showCsv)}
          className="w-full flex items-center justify-between text-left text-sm font-semibold text-slate-700 hover:text-slate-900"
        >
          <span className="flex items-center gap-2">
            <span>📁</span> Need to upload a manual CSV export instead?
          </span>
          <span className="text-xs text-slate-500 font-normal">{showCsv ? '▲ Hide' : '▼ Show CSV Upload'}</span>
        </button>

        {showCsv && (
          <div className="mt-4 pt-4 border-t border-slate-100 space-y-4">
            <p className="text-xs text-slate-500">
              Expected CSV columns: <code>employee_code, project_code, month, erp_hours</code>
            </p>
            <form onSubmit={handleCsvUpload} className="space-y-3">
              <div>
                <input ref={fileInput} type="file" accept=".csv,text/csv" className="input text-sm" />
              </div>
              {csvError && <p className="text-xs text-red-600 font-medium">{csvError}</p>}
              <button type="submit" className="btn-secondary text-xs px-4 py-2" disabled={uploading}>
                {uploading ? 'Importing CSV...' : 'Upload CSV'}
              </button>
            </form>

            {csvResult && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded text-xs text-slate-700">
                Uploaded {csvResult.imported} row(s).
              </div>
            )}
          </div>
        )}
      </div>

      {/* Import History Table */}
      <div className="card p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Import History & Audit Log</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase text-slate-500 border-b border-slate-200 bg-slate-50">
                <th className="py-2.5 px-3">Source / Batch</th>
                <th className="py-2.5 px-3">Date & Time</th>
                <th className="py-2.5 px-3">Total Rows</th>
                <th className="py-2.5 px-3">Success</th>
                <th className="py-2.5 px-3">Errors</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {batches.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50/50">
                  <td className="py-3 px-3 font-medium text-slate-800 flex items-center gap-1.5">
                    {b.fileName.includes('erpnext') ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800">
                        ERPNext
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
                        CSV
                      </span>
                    )}
                    <span className="truncate max-w-xs">{b.fileName}</span>
                  </td>
                  <td className="py-3 px-3 text-slate-500 text-xs">
                    {new Date(b.importedAt).toLocaleString()}
                  </td>
                  <td className="py-3 px-3 text-slate-700">{b.rowCount}</td>
                  <td className="py-3 px-3 text-emerald-600 font-medium">{b.successCount}</td>
                  <td className="py-3 px-3 text-slate-500">
                    {b.errorCount > 0 ? <span className="text-red-600 font-medium">{b.errorCount}</span> : '0'}
                  </td>
                </tr>
              ))}
              {batches.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-400 text-xs">
                    No imports recorded yet. Click "Fetch from ERPNext" above to pull your first batch.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
