'use client';

import { useEffect, useState } from 'react';

type Settings = {
  reminderIntervalDays: number;
  maxReminders: number;
  escalationEmail: string;
  initialRequestSubject: string;
  initialRequestBody: string;
  mismatchSubject: string;
  mismatchBody: string;
  reminderSubject: string;
  reminderBody: string;
  escalationSubject: string;
  escalationBody: string;
};

const TEMPLATE_FIELDS: { subject: keyof Settings; body: keyof Settings; label: string }[] = [
  { subject: 'initialRequestSubject', body: 'initialRequestBody', label: 'Initial confirmation request' },
  { subject: 'mismatchSubject', body: 'mismatchBody', label: 'Mismatch follow-up' },
  { subject: 'reminderSubject', body: 'reminderBody', label: 'Reminder' },
  { subject: 'escalationSubject', body: 'escalationBody', label: 'Escalation notice (to HR)' },
];

export default function SettingsClient() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => setSettings(d.settings));
  }, []);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
    setSaved(false);
  }

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (res.ok) setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return <p className="text-sm text-slate-500">Loading...</p>;

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Settings</h1>
      <p className="text-sm text-slate-500 mb-6">
        Reminder timing, escalation timing, and message templates. Templates support placeholders like{' '}
        <code>{'{{employeeName}}'}</code>, <code>{'{{projectName}}'}</code>, <code>{'{{month}}'}</code>,{' '}
        <code>{'{{link}}'}</code>, <code>{'{{confirmedHours}}'}</code>, <code>{'{{erpHours}}'}</code>,{' '}
        <code>{'{{difference}}'}</code>.
      </p>

      <div className="card p-5 mb-6 space-y-4">
        <h2 className="text-sm font-semibold text-slate-900">Timing</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="label">Remind after (days)</label>
            <input
              className="input"
              type="number"
              min={1}
              value={settings.reminderIntervalDays}
              onChange={(e) => update('reminderIntervalDays', Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label">Max reminders before escalation</label>
            <input
              className="input"
              type="number"
              min={0}
              value={settings.maxReminders}
              onChange={(e) => update('maxReminders', Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label">Escalation email (HR)</label>
            <input
              className="input"
              type="email"
              value={settings.escalationEmail}
              onChange={(e) => update('escalationEmail', e.target.value)}
            />
          </div>
        </div>
      </div>

      {TEMPLATE_FIELDS.map((f) => (
        <div className="card p-5 mb-6 space-y-3" key={f.subject}>
          <h2 className="text-sm font-semibold text-slate-900">{f.label}</h2>
          <div>
            <label className="label">Subject</label>
            <input
              className="input"
              value={settings[f.subject]}
              onChange={(e) => update(f.subject, e.target.value)}
            />
          </div>
          <div>
            <label className="label">Body</label>
            <textarea
              className="input font-mono text-xs"
              rows={6}
              value={settings[f.body]}
              onChange={(e) => update(f.body, e.target.value)}
            />
          </div>
        </div>
      ))}

      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save settings'}
        </button>
        {saved && <span className="text-sm text-emerald-600">Saved.</span>}
      </div>
    </div>
  );
}
