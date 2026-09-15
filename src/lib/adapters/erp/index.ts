import { CsvErpAdapter } from './csvAdapter';
import { ErpNextAdapter } from './erpNextAdapter';
import type { ErpAdapter } from './types';

/**
 * Single point of configuration for which ERP adapter is active, selected
 * via the `ERP_MODE` env var:
 *   - "csv" (default) — manual CSV upload via the ERP Import page.
 *   - "erpnext" — pulls directly from ERPNext's REST API. Still requires
 *     `ERPNEXT_BASE_URL` / `ERPNEXT_API_KEY` / `ERPNEXT_API_SECRET` (see
 *     .env.example and README "Connecting ERPNext"). The CSV import page
 *     and its adapter keep working either way, e.g. as a manual fallback.
 *
 * To add a different ERP's API later: implement `ErpAdapter` in a new file
 * and add another branch here. No other file in the app needs to change.
 */
export function getErpAdapter(): ErpAdapter {
  if (process.env.ERP_MODE === 'erpnext') {
    return new ErpNextAdapter();
  }
  return new CsvErpAdapter();
}

export type { ErpAdapter, ErpImportOutcome, ErpTimesheetEntry } from './types';

