import type { ErpAdapter, ErpImportOutcome } from './types';
import { aggregateErpNextTimesheets, type ErpNextTimesheetDoc } from './erpNextAggregation';

/**
 * ERPNext adapter — pulls Timesheet documents from ERPNext's standard
 * Frappe REST API and aggregates them into monthly per-employee/project
 * totals (see erpNextAggregation.ts).
 *
 * Required environment variables (see .env.example):
 *   ERPNEXT_BASE_URL   e.g. https://yourcompany.erpnext.com (no trailing slash)
 *   ERPNEXT_API_KEY    from the ERPNext user's "API Access" section
 *   ERPNEXT_API_SECRET from the same place
 *
 * Auth: Frappe's token scheme — `Authorization: token <key>:<secret>`.
 *
 * This adapter is used two ways:
 *   1. Pulled on a schedule (e.g. month-end), fetching the whole company
 *      for the target month — see scripts/run-job.ts / the cron routes.
 *   2. Triggered by ERPNext's own outgoing Webhook feature the moment a
 *      Timesheet is submitted (see src/app/api/erp/webhook/erpnext), which
 *      calls this adapter scoped to just that one employee + month. This
 *      re-fetches everything for that employee/month rather than trying to
 *      incrementally add the single webhook payload, so amendments and
 *      cancellations are always reflected correctly.
 *
 * NOTE ON FIELD NAMES: this assumes `employee` and `time_logs[].project` on
 * the Timesheet doctype hold the values you want as employeeCode/
 * projectCode directly (ERPNext Link fields store the linked document's ID,
 * not its display label). If your ERPNext instance customizes Employee or
 * Project naming, confirm with whoever administers it before relying on
 * this in production — see README "Connecting ERPNext".
 */
export class ErpNextAdapter implements ErpAdapter {
  readonly name = 'ERPNext API';

  async fetchTimesheets(input: { month?: string; employeeCode?: string }): Promise<ErpImportOutcome> {
    const { month, employeeCode } = input;
    if (!month) {
      throw new Error('ErpNextAdapter.fetchTimesheets requires a target month (YYYY-MM)');
    }

    const docs = await this.fetchTimesheetDocs(month, employeeCode);
    const { entries, skippedNoProject } = aggregateErpNextTimesheets(docs, month);

    const errors: { row: number; message: string }[] = [];
    if (skippedNoProject > 0) {
      errors.push({
        row: 0,
        message: `${skippedNoProject} time log row(s) had no project set in ERPNext and were skipped.`,
      });
    }

    return { entries, errors };
  }

  private async fetchTimesheetDocs(month: string, employeeCode?: string): Promise<ErpNextTimesheetDoc[]> {
    const baseUrl = requireEnv('ERPNEXT_BASE_URL');
    const apiKey = requireEnv('ERPNEXT_API_KEY');
    const apiSecret = requireEnv('ERPNEXT_API_SECRET');
    const authHeaders = {
      Authorization: `token ${apiKey}:${apiSecret}`,
      Accept: 'application/json',
    };

    // Timesheets can start before and end after the target month, so filter
    // on a range that comfortably covers it rather than an exact match on
    // start_date/end_date.
    const [year, monthNum] = month.split('-').map(Number);
    const rangeStart = `${month}-01`;
    const lastDay = new Date(year, monthNum, 0).getDate();
    const rangeEnd = `${month}-${String(lastDay).padStart(2, '0')}`;

    const filters: unknown[] = [
      ['Timesheet', 'start_date', '<=', rangeEnd],
      ['Timesheet', 'end_date', '>=', rangeStart],
    ];
    if (employeeCode) {
      filters.push(['Timesheet', 'employee', '=', employeeCode]);
    }

    // Step 1: list matching document names. Frappe's list endpoint can't
    // reliably return child-table fields (like time_logs) even if you ask
    // for them via dotted notation — that only works for simple top-level
    // fields. So we fetch names here, then the full document per name below.
    const listParams = new URLSearchParams({
      filters: JSON.stringify(filters),
      fields: JSON.stringify(['name']),
      limit_page_length: '0', // 0 = no limit, per Frappe REST API convention
    });

    const listRes = await fetch(`${baseUrl}/api/resource/Timesheet?${listParams.toString()}`, {
      headers: authHeaders,
    });
    if (!listRes.ok) {
      const body = await listRes.text().catch(() => '');
      throw new Error(`ERPNext API list request failed (${listRes.status}): ${body.slice(0, 500)}`);
    }
    const listJson = (await listRes.json()) as { data: { name: string }[] };
    const names = (listJson.data ?? []).map((d) => d.name);

    // Step 2: fetch each full document (this is where time_logs comes
    // through). Fine for month-end/webhook-triggered volumes; if your
    // instance produces thousands of timesheets a month, batch these with a
    // concurrency limit instead of Promise.all-ing them all at once.
    const docs = await Promise.all(
      names.map(async (name) => {
        const res = await fetch(`${baseUrl}/api/resource/Timesheet/${encodeURIComponent(name)}`, {
          headers: authHeaders,
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`ERPNext API fetch of Timesheet ${name} failed (${res.status}): ${body.slice(0, 500)}`);
        }
        const json = (await res.json()) as { data: ErpNextTimesheetDoc };
        return json.data;
      })
    );

    return docs;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured — see .env.example`);
  return value;
}
