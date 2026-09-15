import type { MessagingAdapter, OutboundMessage, SendResult } from './types';

/**
 * Evolra adapter — sends the confirmation request as a Google Chat message
 * via your in-house Evolra bot's API instead of email. The employee replies
 * directly in Google Chat; Evolra is expected to call our webhook
 * (`/api/webhooks/evolra`, see that file) with their answer.
 *
 * ⚠️ THE EXACT REQUEST/RESPONSE SHAPE BELOW IS A PLACEHOLDER. I don't have
 * Evolra's actual API contract, so this adapter is written to the most
 * common shape for an internal chat-bot "send message" endpoint (POST a
 * JSON body with a recipient + either plain text or a structured card).
 * Before this goes live, confirm with whoever built Evolra:
 *
 *   1. The exact endpoint URL and HTTP method to trigger an outbound message.
 *   2. The auth scheme (bearer token used below is a guess — could be an
 *      API key header, HMAC signature, mTLS, etc.).
 *   3. How Evolra identifies a recipient — this assumes the employee's
 *      company email doubles as their Google Chat identity. Confirm that's
 *      actually how Evolra resolves users.
 *   4. Whether Evolra supports Google Chat's interactive "Card" format
 *      (a text-input widget + submit button) or only plain text messages.
 *      Cards are strongly preferred — see note below.
 *   5. Whether Evolra's webhook-back to us (see /api/webhooks/evolra) can
 *      echo back arbitrary metadata we send it now (specifically
 *      `reconciliationRecordId`) — that's how we correlate "this reply" to
 *      "that pending request" without guessing. If Evolra can't pass
 *      metadata through, we'd have to fall back to "most recent pending
 *      record for this employee," which is less robust (breaks if an
 *      employee has two pending requests at once, e.g. two projects in the
 *      same month).
 *
 * WHY A CARD, NOT A TEXT MESSAGE: the original requirement was "the
 * employee should enter their hours and submit; HR must not need to
 * interpret free-text messages." A plain chat message ("I worked 60 hours")
 * would put us right back into free-text parsing. Google Chat's Card
 * framework supports a text-input widget + submit button that fires a
 * structured callback with the exact value and no NLP guessing — if Evolra
 * can render cards, use `buildCardPayload()` below; if it can only send
 * plain text, `buildTextPayload()` is the fallback and the webhook handler
 * will need best-effort numeric parsing instead (see that file's TODO).
 */
export class EvolraChatAdapter implements MessagingAdapter {
  readonly channel = 'EVOLRA_CHAT';

  async send(message: OutboundMessage): Promise<SendResult> {
    const baseUrl = process.env.EVOLRA_API_BASE_URL;
    const apiKey = process.env.EVOLRA_API_KEY;

    if (!baseUrl || !apiKey) {
      // Same "mock mode" philosophy as EmailAdapter: don't hard-fail local
      // dev/demo just because Evolra credentials aren't configured yet.
      // eslint-disable-next-line no-console
      console.log(
        `\n[MOCK EVOLRA MESSAGE] To: ${message.recipient}\n${JSON.stringify(
          message.context ?? { subject: message.subject, body: message.body },
          null,
          2
        )}\n`
      );
      return { mocked: true };
    }

    const payload = message.context ? buildCardPayload(message) : buildTextPayload(message);

    const res = await fetch(`${baseUrl}/api/messages/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Evolra send failed (${res.status}): ${body.slice(0, 500)}`);
    }

    const json = await res.json().catch(() => ({}) as { messageId?: string });
    return { mocked: false, providerMessageId: json.messageId };
  }
}

/**
 * Structured card payload: shows the request details and, for kinds that
 * need employee input (everything except ESCALATION_NOTICE, which just
 * informs HR), a number input + submit button. The button's `parameters`
 * carry `reconciliationRecordId` so Evolra can echo it back verbatim in its
 * webhook callback — confirm Evolra actually supports passing through
 * arbitrary action parameters like this (point 5 in the class comment).
 */
function buildCardPayload(message: OutboundMessage) {
  const ctx = message.context!;
  const needsInput = ctx.kind !== 'ESCALATION_NOTICE';

  return {
    recipientEmail: message.recipient,
    card: {
      header: { title: message.subject ?? 'Timesheet confirmation' },
      sections: [
        {
          widgets: [
            { textParagraph: { text: message.body } },
            ...(ctx.previousConfirmedHours != null
              ? [
                  {
                    textParagraph: {
                      text: `You previously confirmed ${ctx.previousConfirmedHours} hrs (ERP: ${ctx.erpHours} hrs, difference: ${ctx.previousDifference}).`,
                    },
                  },
                ]
              : []),
            ...(needsInput
              ? [
                  {
                    textInput: {
                      name: 'confirmedHours',
                      label: `Hours worked on ${ctx.projectName} (${ctx.month})`,
                      type: 'SINGLE_LINE',
                    },
                  },
                  {
                    textInput: {
                      name: 'explanation',
                      label: 'Explanation (optional)',
                      type: 'MULTIPLE_LINE',
                    },
                  },
                  {
                    buttonList: {
                      buttons: [
                        {
                          text: 'Submit',
                          onClick: {
                            action: {
                              function: 'submitTimesheetConfirmation',
                              parameters: [{ key: 'reconciliationRecordId', value: ctx.reconciliationRecordId }],
                            },
                          },
                        },
                      ],
                    },
                  },
                ]
              : []),
          ],
        },
      ],
    },
  };
}

/** Fallback if Evolra can only send plain text (see class comment, point 4). */
function buildTextPayload(message: OutboundMessage) {
  return {
    recipientEmail: message.recipient,
    text: message.subject ? `${message.subject}\n\n${message.body}` : message.body,
  };
}
