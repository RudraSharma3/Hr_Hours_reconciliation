import { EmailAdapter } from './emailAdapter';
import { EvolraChatAdapter } from './evolraChatAdapter';
import { GoogleChatAdapter } from './googleChatAdapter';
import type { MessagingAdapter } from './types';

/**
 * Single point of configuration for which messaging channel is active,
 * selected via the `MESSAGING_CHANNEL` env var:
 *   - "email" (default) — EmailAdapter (mock or real SMTP).
 *   - "google_chat" — GoogleChatAdapter, native interactive Google Chat Cards v2 bot.
 *   - "evolra" — EvolraChatAdapter, in-house Google Chat bot proxy.
 *
 * To add Teams/Slack/WhatsApp later: implement `MessagingAdapter` in a new
 * file and add another branch here. No other file in the app needs to change.
 */
export function getMessagingAdapter(): MessagingAdapter {
  const channel = (process.env.MESSAGING_CHANNEL ?? 'email').toLowerCase();
  if (channel === 'google_chat' || channel === 'googlechat' || channel === 'chat') {
    return new GoogleChatAdapter();
  }
  if (channel === 'evolra') {
    return new EvolraChatAdapter();
  }
  return new EmailAdapter();
}

export type { MessagingAdapter, OutboundMessage, OutboundMessageContext, SendResult } from './types';
export { GoogleChatAdapter } from './googleChatAdapter';
export { EmailAdapter } from './emailAdapter';
export { EvolraChatAdapter } from './evolraChatAdapter';


