import { EmailAdapter } from './emailAdapter';
import { EvolraChatAdapter } from './evolraChatAdapter';
import type { MessagingAdapter } from './types';

/**
 * Single point of configuration for which messaging channel is active,
 * selected via the `MESSAGING_CHANNEL` env var:
 *   - "email" (default) — EmailAdapter (mock or real SMTP).
 *   - "evolra" — EvolraChatAdapter, your in-house Google Chat bot. See that
 *     file for exactly what needs confirming with Evolra's team before
 *     this is production-ready — the API contract there is a documented
 *     placeholder, not a verified integration.
 *
 * To add Teams/Slack/WhatsApp later: implement `MessagingAdapter` in a new
 * file and add another branch here (e.g. selected by this same env var, or
 * by a per-employee "preferred channel" field on the Employee model). No
 * other file in the app needs to change.
 */
export function getMessagingAdapter(): MessagingAdapter {
  if (process.env.MESSAGING_CHANNEL === 'evolra') {
    return new EvolraChatAdapter();
  }
  return new EmailAdapter();
}

export type { MessagingAdapter, OutboundMessage, OutboundMessageContext, SendResult } from './types';

