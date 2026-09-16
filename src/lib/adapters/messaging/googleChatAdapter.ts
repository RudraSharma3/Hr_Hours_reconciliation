import crypto from 'crypto';
import type { MessagingAdapter, OutboundMessage, OutboundMessageContext, SendResult } from './types';

/**
 * Google Chat Adapter — sends interactive Google Chat Cards (v2) to employees.
 *
 * Employees receive structured cards in Google Chat where they can review ERP
 * hours, enter their confirmed hours and optional explanations via native text
 * inputs, and submit with one click.
 *
 * The inbound webhook (/api/chat/google) processes CARD_CLICKED interaction
 * events and returns instant real-time status cards without requiring the
 * employee to open an external web browser.
 */

let cachedOAuthToken: { accessToken: string; expiresAt: number } | null = null;

export class GoogleChatAdapter implements MessagingAdapter {
  readonly channel = 'GOOGLE_CHAT';

  async send(message: OutboundMessage): Promise<SendResult> {
    const webhookUrl = process.env.GOOGLE_CHAT_WEBHOOK_URL;
    const serviceAccountKey = process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_KEY;

    const payload = message.context
      ? buildGoogleChatCardPayload(message)
      : buildGoogleChatTextPayload(message);

    // 1. If test env or no cloud credentials configured, run in clean local mock mode
    if (process.env.NODE_ENV === 'test' || (!webhookUrl && !serviceAccountKey)) {
      // eslint-disable-next-line no-console
      console.log(
        `\n🤖 [MOCK GOOGLE CHAT BOT] Message to: ${message.recipient}\n` +
          `Subject: ${message.subject ?? '(none)'}\n` +
          `Payload:\n${JSON.stringify(payload, null, 2)}\n`
      );
      return { mocked: true };
    }

    // 2. Space Webhook destination
    if (webhookUrl) {
      try {
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`Google Chat webhook send failed (${res.status}): ${body.slice(0, 500)}`);
        }

        const json = (await res.json().catch(() => ({}))) as { name?: string };
        return { mocked: false, providerMessageId: json.name };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[Google Chat Webhook Delivery Warning]: ${err instanceof Error ? err.message : err}`);
        return { mocked: true };
      }
    }

    // 3. Google Chat REST API with Service Account credentials
    if (serviceAccountKey) {
      try {
        const accessToken = await getGoogleServiceAccountToken(serviceAccountKey);
        const spaceName = process.env.GOOGLE_CHAT_DEFAULT_SPACE_ID;

        let res: Response;
        if (spaceName) {
          res = await fetch(`https://chat.googleapis.com/v1/${spaceName}/messages`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(payload),
          });
        } else {
          // If no specific space ID, try to set up a direct message with the employee
          res = await fetch('https://chat.googleapis.com/v1/spaces:setup', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              space: { spaceType: 'DIRECT_MESSAGE', singleUserBotDm: true },
              memberships: [{ member: { name: `users/${message.recipient}`, type: 'HUMAN' } }],
            }),
          });

          if (res.ok) {
            const setupData = (await res.json()) as { name?: string };
            if (setupData.name) {
              res = await fetch(`https://chat.googleapis.com/v1/${setupData.name}/messages`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${accessToken}`,
                },
                body: JSON.stringify(payload),
              });
            }
          }
        }

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          // eslint-disable-next-line no-console
          console.log(
            `\n🤖 [GOOGLE CHAT LOG] Prepared card for ${message.recipient} (Live API response ${res.status}: ${body.slice(0, 100)}). Logged locally.`
          );
          return { mocked: true };
        }

        const json = (await res.json().catch(() => ({}))) as { name?: string };
        return { mocked: false, providerMessageId: json.name };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[Google Chat API Warning]: ${err instanceof Error ? err.message : err}. Logging card.`);
        return { mocked: true };
      }
    }

    return { mocked: true };
  }
}


/**
 * Builds an interactive Google Chat Card (v2) payload for reconciliation requests.
 */
export function buildGoogleChatCardPayload(message: OutboundMessage) {
  const ctx = message.context!;
  const isEscalation = ctx.kind === 'ESCALATION_NOTICE';
  const isMismatch = ctx.kind === 'MISMATCH_FOLLOWUP';
  const isReminder = ctx.kind === 'REMINDER';

  let title = `Timesheet Confirmation (${ctx.month})`;
  let subtitle = `${ctx.employeeName} • ${ctx.projectName}`;

  if (isEscalation) {
    title = `⚠️ Escalation: Discrepancy for ${ctx.month}`;
    subtitle = `HR Escalation Review • ${ctx.employeeName}`;
  } else if (isMismatch) {
    title = `⚠️ Action Needed: Hours Mismatch (${ctx.month})`;
  } else if (isReminder) {
    title = `⏰ Reminder: Pending Confirmation (${ctx.month})`;
  }

  const widgets: unknown[] = [
    {
      decoratedText: {
        topLabel: 'Project & Month',
        text: `<b>${ctx.projectName}</b> (${ctx.month})`,
      },
    },
    {
      decoratedText: {
        topLabel: 'ERP Timesheet Hours',
        text: `<b>${ctx.erpHours} hrs</b>`,
      },
    },
  ];

  if (ctx.previousConfirmedHours != null) {
    widgets.push({
      decoratedText: {
        topLabel: 'Previous Submission',
        text: `You confirmed: <b>${ctx.previousConfirmedHours} hrs</b> (Difference: <b>${ctx.previousDifference ?? 0} hrs</b>)`,
      },
    });
  }

  widgets.push({
    textParagraph: {
      text: message.body.replace(/\n/g, '<br>'),
    },
  });

  // For interactive requests that require employee submission (Initial, Mismatch, Reminder)
  if (!isEscalation) {
    widgets.push(
      {
        textInput: {
          name: 'confirmedHours',
          label: `Enter your confirmed hours for ${ctx.projectName}`,
          type: 'SINGLE_LINE',
          ...(ctx.previousConfirmedHours != null
            ? { value: String(ctx.previousConfirmedHours) }
            : {}),
        },
      },
      {
        textInput: {
          name: 'explanation',
          label: 'Explanation / Notes (optional, or explain difference)',
          type: 'SINGLE_LINE',
        },
      },
      {
        buttonList: {
          buttons: [
            {
              text: isMismatch ? 'Submit Corrected Hours' : 'Confirm Hours',
              onClick: {
                action: {
                  function: 'submitHoursConfirmation',
                  parameters: [
                    { key: 'reconciliationRecordId', value: ctx.reconciliationRecordId },
                    { key: 'recipientEmail', value: message.recipient },
                  ],
                },
              },
            },
          ],
        },
      }
    );
  }

  return {
    cardsV2: [
      {
        cardId: `reconciliation-${ctx.reconciliationRecordId}`,
        card: {
          header: {
            title,
            subtitle,
          },
          sections: [
            {
              header: 'Hours Verification',
              widgets,
            },
          ],
        },
      },
    ],
  };
}

/**
 * Returns an instant Card v2 response when employee confirms hours and it matches.
 */
export function buildMatchSuccessCard(params: {
  employeeName: string;
  projectName: string;
  month: string;
  confirmedHours: number;
  erpHours: number;
}) {
  return {
    text: `✅ Timesheet Reconciled Successfully: ${params.projectName} (${params.month}) - ${params.confirmedHours} hrs.`,
    actionResponse: {
      type: 'NEW_MESSAGE',
    },
    cardsV2: [
      {
        cardId: 'reconciliation-success',
        card: {
          header: {
            title: '✅ Timesheet Reconciled Successfully',
            subtitle: `${params.employeeName} • ${params.projectName} (${params.month})`,
          },
          sections: [
            {
              widgets: [
                {
                  decoratedText: {
                    topLabel: 'Status',
                    text: '<b>MATCHED (Zero Difference)</b>',
                  },
                },
                {
                  decoratedText: {
                    topLabel: 'Confirmed & ERP Hours',
                    text: `<b>${params.confirmedHours} hrs</b> (ERP: ${params.erpHours} hrs)`,
                  },
                },
                {
                  textParagraph: {
                    text: 'Thank you! Your hours have been verified and finalized. No further action is required.',
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

/**
 * Returns an instant Card v2 response when employee confirms hours and there is a discrepancy.
 */
export function buildMismatchCard(params: {
  recordId: string;
  employeeName: string;
  projectName: string;
  month: string;
  confirmedHours: number;
  erpHours: number;
  difference: number;
  explanation?: string;
}) {
  return {
    text: `⚠️ Hours Difference Flagged: ${params.projectName} (${params.month}) - ${params.confirmedHours} hrs confirmed vs ${params.erpHours} hrs in ERP (Diff: ${params.difference} hrs).`,
    actionResponse: {
      type: 'NEW_MESSAGE',
    },
    cardsV2: [
      {
        cardId: `reconciliation-mismatch-${params.recordId}`,
        card: {
          header: {
            title: '⚠️ Hours Difference Flagged',
            subtitle: `${params.employeeName} • ${params.projectName} (${params.month})`,
          },
          sections: [
            {
              widgets: [
                {
                  decoratedText: {
                    topLabel: 'Status',
                    text: '<b>FLAGGED (Discrepancy Detected)</b>',
                  },
                },
                {
                  decoratedText: {
                    topLabel: 'Comparison',
                    text: `You confirmed: <b>${params.confirmedHours} hrs</b><br>ERP Timesheet: <b>${params.erpHours} hrs</b><br>Difference: <b>${params.difference} hrs</b>`,
                  },
                },
                ...(params.explanation
                  ? [
                      {
                        decoratedText: {
                          topLabel: 'Your Note',
                          text: params.explanation,
                        },
                      },
                    ]
                  : []),
                {
                  textParagraph: {
                    text: 'Please review your timesheet. You can update your hours below or provide additional context for HR review.',
                  },
                },
                {
                  textInput: {
                    name: 'confirmedHours',
                    label: 'Corrected Hours',
                    type: 'SINGLE_LINE',
                  },
                },
                {
                  textInput: {
                    name: 'explanation',
                    label: 'Reason for discrepancy / Correction note',
                    type: 'SINGLE_LINE',
                  },
                },
                {
                  buttonList: {
                    buttons: [
                      {
                        text: 'Update & Re-Submit',
                        onClick: {
                          action: {
                            function: 'submitHoursConfirmation',
                            parameters: [
                              { key: 'reconciliationRecordId', value: params.recordId },
                              { key: 'inputFieldName', value: 'confirmedHours' },
                            ],
                          },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

/**
 * Builds a card listing an employee's pending reconciliation requests when queried.
 */
export function buildPendingRequestsCard(
  titleSubtitle: string,
  records: Array<{
    id: string;
    projectName: string;
    month: string;
    erpHours: number;
    status: string;
    employeeName?: string;
  }>
) {
  if (records.length === 0) {
    return {
      cardsV2: [
        {
          cardId: 'pending-none',
          card: {
            header: {
              title: '🎉 All Caught Up!',
              subtitle: titleSubtitle,
            },
            sections: [
              {
                widgets: [
                  {
                    textParagraph: {
                      text: 'You have no pending timesheet reconciliation requests at this time.',
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    };
  }

  return {
    cardsV2: [
      {
        cardId: 'pending-list',
        card: {
          header: {
            title: `📋 Pending Timesheets (${records.length})`,
            subtitle: titleSubtitle,
          },
          sections: records.map((rec) => ({
            header: `${rec.employeeName ? `${rec.employeeName} • ` : ''}${rec.projectName} • ${rec.month}`,
            widgets: [
              {
                decoratedText: {
                  topLabel: 'ERP Hours & Status',
                  text: `<b>${rec.erpHours} hrs</b> • Status: <b>${rec.status}</b>`,
                },
              },
              {
                textInput: {
                  name: `confirmedHours_${rec.id}`,
                  label: `Confirmed hours for ${rec.projectName}`,
                  type: 'SINGLE_LINE',
                },
              },
              {
                buttonList: {
                  buttons: [
                    {
                      text: 'Confirm',
                      onClick: {
                        action: {
                          function: 'submitHoursConfirmation',
                          parameters: [
                            { key: 'reconciliationRecordId', value: rec.id },
                            { key: 'inputFieldName', value: `confirmedHours_${rec.id}` },
                          ],
                        },
                      },
                    },
                  ],
                },
              },
            ],
          })),
        },
      },
    ],
  };
}

/**
 * Builds an interactive Help & Instructions card.
 */
export function buildHelpCard() {
  return {
    cardsV2: [
      {
        cardId: 'bot-help',
        card: {
          header: {
            title: '🤖 Timesheet Reconciliation Bot',
            subtitle: 'Automated HR Hours Verification',
          },
          sections: [
            {
              header: 'Available Commands',
              widgets: [
                {
                  decoratedText: {
                    topLabel: 'Type "pending" or "status"',
                    text: 'View and confirm all your open monthly reconciliation requests.',
                  },
                },
                {
                  decoratedText: {
                    topLabel: 'Interactive Cards',
                    text: 'When you receive a monthly request card, enter your confirmed hours and click Submit directly inside the card.',
                  },
                },
                {
                  decoratedText: {
                    topLabel: 'Zero Tolerance Policy',
                    text: 'If your hours differ from the ERP timesheet, please provide a short explanation for HR review.',
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  };
}


/** Plain text fallback for Google Chat */
function buildGoogleChatTextPayload(message: OutboundMessage) {
  return {
    text: message.subject ? `*${message.subject}*\n\n${message.body}` : message.body,
  };
}

/**
 * Obtains a Google OAuth2 access token for the service account via signed JWT assertion.
 */
async function getGoogleServiceAccountToken(keyJson: string): Promise<string> {
  if (cachedOAuthToken && cachedOAuthToken.expiresAt > Date.now() + 60000) {
    return cachedOAuthToken.accessToken;
  }

  let key: {
    type?: string;
    client_email?: string;
    private_key?: string;
    token_uri?: string;
    access_token?: string;
  };

  try {
    key = typeof keyJson === 'string' ? JSON.parse(keyJson) : keyJson;
  } catch {
    // If key is already a raw bearer token
    return keyJson;
  }

  if (key.access_token) {
    return key.access_token;
  }

  if (!key.client_email || !key.private_key) {
    return keyJson;
  }

  const now = Math.floor(Date.now() / 1000);
  const tokenUri = key.token_uri || 'https://oauth2.googleapis.com/token';
  const privateKey = (key.private_key || '').replace(/\\n/g, '\n');

  const jwt = signJwtAssertion(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: key.client_email,
      sub: key.client_email,
      aud: tokenUri,
      scope:
        'https://www.googleapis.com/auth/chat.bot https://www.googleapis.com/auth/chat.messages.create https://www.googleapis.com/auth/chat.spaces https://www.googleapis.com/auth/chat.memberships',
      iat: now,
      exp: now + 3600,
    },
    privateKey
  );


  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !data.access_token) {
    throw new Error(
      `Google OAuth token exchange failed: ${data.error_description || data.error || res.statusText}`
    );
  }

  cachedOAuthToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };

  return data.access_token;
}

function signJwtAssertion(header: object, payload: object, privateKey: string): string {
  const encHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${encHeader}.${encPayload}`);
  const signature = signer.sign(privateKey, 'base64url');
  return `${encHeader}.${encPayload}.${signature}`;
}

