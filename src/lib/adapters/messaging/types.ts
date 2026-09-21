/**
 * Messaging Adapter contract.
 *
 * The rest of the app (job runners, API routes) only calls `send()`.
 * Active implementations: `GoogleChatAdapter` (native Google Chat Cards v2)
 * and `EmailAdapter` (real SMTP or mock). Select the active one in
 * `src/lib/adapters/messaging/index.ts` via the `MESSAGING_CHANNEL` env var.
 */

export type OutboundMessageContext = {
  reconciliationRecordId: string;
  employeeName: string;
  projectName: string;
  month: string;
  erpHours: number;
  previousConfirmedHours?: number | null;
  previousDifference?: number | null;
  kind: 'INITIAL_REQUEST' | 'MISMATCH_FOLLOWUP' | 'REMINDER' | 'ESCALATION_NOTICE';
};

export type OutboundMessage = {
  recipient: string; // email address, Teams/Slack user id, WhatsApp number, etc.
  subject?: string; // not all channels use a subject
  body: string;
  template: string; // INITIAL_REQUEST | MISMATCH_FOLLOWUP | REMINDER | ESCALATION_NOTICE
  /**
   * Structured context for channels that build their own native UI instead
   * of just displaying `body` (e.g. an interactive Google Chat card with a
   * text-input widget). Optional and safely ignored by adapters that don't
   * need it (e.g. EmailAdapter, which just sends `subject`/`body`).
   */
  context?: OutboundMessageContext;
};

export type SendResult = {
  mocked: boolean;
  providerMessageId?: string;
};

export interface MessagingAdapter {
  readonly channel: string; // "EMAIL" | "TEAMS" | "SLACK" | "WHATSAPP"
  send(message: OutboundMessage): Promise<SendResult>;
}
