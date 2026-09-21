import { EmailAdapter } from './emailAdapter';
import { GoogleChatAdapter } from './googleChatAdapter';
import type { MessagingAdapter } from './types';

/**
 * Single point of configuration for which messaging channel is active,
 * selected via the `MESSAGING_CHANNEL` env var:
 *   - "google_chat" — GoogleChatAdapter, native interactive Google Chat Cards v2 bot.
 *   - "email" (default) — EmailAdapter (mock or real SMTP).
 */
export function getMessagingAdapter(): MessagingAdapter {
  const channel = (process.env.MESSAGING_CHANNEL ?? 'google_chat').toLowerCase();
  if (channel === 'google_chat' || channel === 'googlechat' || channel === 'chat') {
    return new GoogleChatAdapter();
  }
  return new EmailAdapter();
}

export type { MessagingAdapter, OutboundMessage, OutboundMessageContext, SendResult } from './types';
export { GoogleChatAdapter } from './googleChatAdapter';
export { EmailAdapter } from './emailAdapter';


