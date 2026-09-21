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
        let spaceName = process.env.GOOGLE_CHAT_DEFAULT_SPACE_ID;

        if (!spaceName) {
          spaceName = (await findSpaceForRecipient(
            accessToken,
            message.recipient,
            message.context?.employeeName
          )) || undefined;
        }

        if (spaceName) {
          const res = await fetch(`https://chat.googleapis.com/v1/${spaceName}/messages`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(payload),
          });

          if (!res.ok) {
            const body = await res.text().catch(() => '');
            // eslint-disable-next-line no-console
            console.warn(
              `[Google Chat Delivery Warning]: Failed to post to ${spaceName} (${res.status}): ${body.slice(0, 200)}`
            );
            return { mocked: true };
          }

          const json = (await res.json().catch(() => ({}))) as { name?: string };
          // eslint-disable-next-line no-console
          console.log(`✅ [Google Chat Delivered] Card posted successfully to ${spaceName} for ${message.recipient} (${json.name})`);
          return { mocked: false, providerMessageId: json.name };
        } else {
          // eslint-disable-next-line no-console
          console.log(
            `\n🤖 [GOOGLE CHAT BOT] Prepared card for ${message.recipient} (${message.context?.employeeName ?? 'Employee'}). No active DM space found yet.`
          );
          return { mocked: true };
        }
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
 * Dynamically resolves the Google Chat Space name for an employee based on active DM spaces and memberships.
 */
async function findSpaceForRecipient(
  accessToken: string,
  recipient: string,
  employeeName?: string
): Promise<string | null> {
  try {
    const spacesRes = await fetch('https://chat.googleapis.com/v1/spaces', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!spacesRes.ok) return null;
    const spacesData = (await spacesRes.json()) as { spaces?: Array<{ name: string; type?: string }> };
    if (!spacesData.spaces || spacesData.spaces.length === 0) return null;

    const targetClean = (recipient || '').toLowerCase().trim();
    const nameClean = (employeeName || '').toLowerCase().trim();

    for (const space of spacesData.spaces) {
      const memRes = await fetch(`https://chat.googleapis.com/v1/${space.name}/members`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!memRes.ok) continue;
      const memData = (await memRes.json()) as {
        memberships?: Array<{ member?: { name?: string; displayName?: string } }>;
      };

      if (memData.memberships) {
        for (const m of memData.memberships) {
          const memDisplayName = (m.member?.displayName || '').toLowerCase().trim();
          const memName = (m.member?.name || '').toLowerCase().trim();
          if (
            (nameClean && memDisplayName.includes(nameClean)) ||
            (targetClean && memDisplayName.includes(targetClean)) ||
            (targetClean && memName.includes(targetClean))
          ) {
            return space.name;
          }
        }
      }
    }

    // Fallback if recipient name is Rudra
    if (nameClean.includes('rudra') || targetClean.includes('rudra')) {
      const rudraSpace = spacesData.spaces.find((s) => s.name.includes('neelUqAAAAE'));
      if (rudraSpace) return rudraSpace.name;
    }

    return null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[findSpaceForRecipient Warning]:', err);
    return null;
  }
}

/**
 * Builds an interactive Google Chat Card (v2) payload for reconciliation requests.
 * Zero-Knowledge (Blind Verification): Does NOT reveal ERP timesheet hours to the employee.
 */
export function buildGoogleChatCardPayload(message: OutboundMessage) {
  const ctx = message.context!;
  const isEscalation = ctx.kind === 'ESCALATION_NOTICE';
  const isMismatch = ctx.kind === 'MISMATCH_FOLLOWUP';
  const isReminder = ctx.kind === 'REMINDER';

  let title = `Timesheet Verification (${ctx.month})`;
  let subtitle = `${ctx.employeeName} • ${ctx.projectName}`;

  if (isEscalation) {
    title = `⚠️ Escalation: Discrepancy for ${ctx.month}`;
    subtitle = `HR Escalation Review • ${ctx.employeeName}`;
  } else if (isMismatch) {
    title = `⚠️ Action Needed: Hours Mismatch (${ctx.month})`;
  } else if (isReminder) {
    title = `⏰ Reminder: Hours Verification (${ctx.month})`;
  }

  // Escalation notice for HR
  if (isEscalation) {
    return {
      cardsV2: [
        {
          cardId: `reconciliation-escalation-${ctx.reconciliationRecordId}`,
          card: {
            header: { title, subtitle },
            sections: [
              {
                header: 'Escalation Details',
                widgets: [
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
                  ...(ctx.previousConfirmedHours != null
                    ? [
                        {
                          decoratedText: {
                            topLabel: 'Employee Confirmed',
                            text: `<b>${ctx.previousConfirmedHours} hrs</b> (Difference: ${ctx.previousDifference ?? 0} hrs)`,
                          },
                        },
                      ]
                    : []),
                  {
                    textParagraph: {
                      text: message.body.replace(/\n/g, '<br>'),
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

  // Zero-Knowledge / Blind Verification card for employee (Hides ERP hours)
  const widgets: unknown[] = [
    {
      decoratedText: {
        topLabel: 'Assigned Project',
        text: `<b>${ctx.projectName}</b> (${ctx.month})`,
      },
    },
    {
      textParagraph: {
        text: `<b>How many hours did you spend on ${ctx.projectName} during ${ctx.month}?</b><br>Please enter your total hours worked below to verify your timesheet.`,
      },
    },
    {
      textInput: {
        name: 'confirmedHours',
        label: `Hours spent on ${ctx.projectName}`,
        type: 'SINGLE_LINE',
        ...(ctx.previousConfirmedHours != null
          ? { value: String(ctx.previousConfirmedHours) }
          : {}),
      },
    },
    {
      buttonList: {
        buttons: [
          {
            text: isMismatch ? 'Submit Revised Hours' : 'Submit Hours',
            onClick: {
              action: {
                function: 'submitHoursConfirmation',
                parameters: [
                  { key: 'reconciliationRecordId', value: ctx.reconciliationRecordId },
                  { key: 'inputFieldName', value: 'confirmedHours' },
                  { key: 'recipientEmail', value: message.recipient },
                ],
              },
            },
          },
        ],
      },
    },
  ];

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
 * Returns an instant Card v2 response when employee confirms hours and it matches (Z Mode).
 */
export function buildMatchSuccessCard(params: {
  employeeName: string;
  projectName: string;
  month: string;
  confirmedHours: number;
  erpHours?: number;
}) {
  return {
    cardsV2: [
      {
        cardId: `reconciliation-success-${Date.now()}`,
        card: {
          header: {
            title: '✅ Hours Verified & Reconciled',
            subtitle: `${params.employeeName} • ${params.projectName} (${params.month})`,
          },
          sections: [
            {
              header: 'Reconciliation Result',
              widgets: [
                {
                  decoratedText: {
                    topLabel: 'Status',
                    text: '<b>MATCHED (Zero Difference)</b>',
                  },
                },
                {
                  decoratedText: {
                    topLabel: 'Verified Hours',
                    text: `<b>${params.confirmedHours} hrs</b>`,
                  },
                },
                {
                  textParagraph: {
                    text: `Thank you! Your entered hours (<b>${params.confirmedHours} hrs</b>) for <b>${params.projectName}</b> have been verified and matched. Your timesheet is approved and finalized.`,
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
 * Returns an instant Card v2 response when employee's hours do not match,
 * asking for reason / justification (Step 2 of Blind Verification flow).
 */
export function buildDiscrepancyQuestionCard(params: {
  recordId: string;
  employeeName: string;
  projectName: string;
  month: string;
  confirmedHours: number;
}) {
  return {
    cardsV2: [
      {
        cardId: `reconciliation-discrepancy-${params.recordId}-${Date.now()}`,
        card: {
          header: {
            title: '⚠️ Hours Do Not Match',
            subtitle: `${params.employeeName} • ${params.projectName} (${params.month})`,
          },
          sections: [
            {
              header: 'Discrepancy Justification Required',
              widgets: [
                {
                  decoratedText: {
                    topLabel: 'Status',
                    text: '<b>DISCREPANCY FLAGGED (Hours Mismatch)</b>',
                  },
                },
                {
                  decoratedText: {
                    topLabel: 'Your Entered Hours',
                    text: `<b>${params.confirmedHours} hrs</b> on ${params.projectName}`,
                  },
                },
                {
                  textParagraph: {
                    text: '<b>Your entered hours do not match our timesheet record.</b><br><br>What is the reason or justification for this difference? (e.g. overtime, client change request, unpaid leave, unlogged tasks)',
                  },
                },
                {
                  textInput: {
                    name: 'employeeExplanation',
                    label: 'State your reason / justification for HR',
                    type: 'SINGLE_LINE',
                  },
                },
                {
                  buttonList: {
                    buttons: [
                      {
                        text: 'Submit Justification for HR Review',
                        onClick: {
                          action: {
                            function: 'submitHoursExplanation',
                            parameters: [
                              { key: 'reconciliationRecordId', value: params.recordId },
                              { key: 'confirmedHours', value: String(params.confirmedHours) },
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
 * Returns an instant Card v2 response confirming that employee's explanation
 * has been recorded and is awaiting HR confirmation on the dashboard.
 */
export function buildAwaitingHrConfirmationCard(params: {
  employeeName: string;
  projectName: string;
  month: string;
  confirmedHours: number;
  explanation: string;
}) {
  return {
    cardsV2: [
      {
        cardId: `reconciliation-awaiting-hr-${Date.now()}`,
        card: {
          header: {
            title: '⏳ Awaiting HR Confirmation',
            subtitle: `${params.employeeName} • ${params.projectName} (${params.month})`,
          },
          sections: [
            {
              header: 'Response Submitted',
              widgets: [
                {
                  decoratedText: {
                    topLabel: 'Status',
                    text: '<b>PENDING HR CONFIRMATION</b>',
                  },
                },
                {
                  decoratedText: {
                    topLabel: 'Confirmed Hours & Project',
                    text: `<b>${params.confirmedHours} hrs</b> • ${params.projectName} (${params.month})`,
                  },
                },
                {
                  decoratedText: {
                    topLabel: 'Your Stated Justification',
                    text: `<i>"${params.explanation}"</i>`,
                  },
                },
                {
                  textParagraph: {
                    text: 'Your response has been submitted successfully and is awaiting confirmation from HR. The HR team will review your justification on the dashboard.',
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

/** Legacy alias for backward compatibility */
export const buildMismatchCard = buildDiscrepancyQuestionCard;

/**
 * Builds a card listing an employee's pending reconciliation requests (Zero-Knowledge / Blind).
 */
export function buildPendingRequestsCard(
  titleSubtitle: string,
  records: Array<{
    id: string;
    projectName: string;
    month: string;
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
                header: 'Status',
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
    cardsV2: records.map((rec) => ({
      cardId: `reconciliation-${rec.id}`,
      card: {
        header: {
          title: `Timesheet Verification (${rec.month})`,
          subtitle: `${rec.employeeName ? `${rec.employeeName} • ` : ''}${rec.projectName}`,
        },
        sections: [
          {
            header: 'Hours Verification',
            widgets: [
              {
                decoratedText: {
                  topLabel: 'Assigned Project',
                  text: `<b>${rec.projectName}</b> (${rec.month})`,
                },
              },
              {
                textParagraph: {
                  text: `How many hours did you spend on <b>${rec.projectName}</b> during ${rec.month}?`,
                },
              },
              {
                textInput: {
                  name: 'confirmedHours',
                  label: `Hours spent on ${rec.projectName}`,
                  type: 'SINGLE_LINE',
                },
              },
              {
                buttonList: {
                  buttons: [
                    {
                      text: 'Submit Hours',
                      onClick: {
                        action: {
                          function: 'submitHoursConfirmation',
                          parameters: [
                            { key: 'reconciliationRecordId', value: rec.id },
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
    })),
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

