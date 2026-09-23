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

/**
 * For Google Workspace Add-on HTTP Chat apps, card `action.function` must be the
 * full HTTPS endpoint URL (not a bare name like `submitHoursConfirmation`).
 * A bare name makes Google look for a Cloud Function / Apps Script deployment
 * (`deploymentFunction` in Chat error logs) and the click never reaches ngrok.
 *
 * The real handler name is passed as parameter `actionName`.
 */
export function getChatActionFunctionUrl(): string {
  const explicit = process.env.GOOGLE_CHAT_HTTP_ENDPOINT?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const base = process.env.APP_BASE_URL?.trim().replace(/\/$/, '');
  if (base) return `${base}/api/chat/google`;
  return 'submitHoursConfirmation'; // legacy fallback (broken for HTTP add-ons)
}

function buildCardAction(
  actionName: string,
  parameters: Array<{ key: string; value: string }>
) {
  return {
    function: getChatActionFunctionUrl(),
    parameters: [{ key: 'actionName', value: actionName }, ...parameters],
  };
}

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
  const isHrRejection = ctx.kind === 'HR_REJECTION';
  const isHrApproval = ctx.kind === 'HR_APPROVAL';

  let title = `Timesheet Verification (${ctx.month})`;
  let subtitle = `${ctx.employeeName} • ${ctx.projectName}`;

  if (isEscalation) {
    title = `⚠️ Escalation: Discrepancy for ${ctx.month}`;
    subtitle = `HR Escalation Review • ${ctx.employeeName}`;
  } else if (isHrRejection) {
    title = `⚠️ HR Correction Requested (${ctx.month})`;
    subtitle = `${ctx.employeeName} • ${ctx.projectName}`;
  } else if (isHrApproval) {
    title = `✅ Timesheet Approved (${ctx.month})`;
    subtitle = `${ctx.employeeName} • ${ctx.projectName}`;
  } else if (isMismatch) {
    title = `⚠️ Action Needed: Hours Mismatch (${ctx.month})`;
  } else if (isReminder) {
    title = `⏰ Reminder: Hours Verification (${ctx.month})`;
  }

  // HR Approval notice for employee
  if (isHrApproval) {
    return {
      cardsV2: [
        {
          cardId: `reconciliation-approved-${ctx.reconciliationRecordId}`,
          card: {
            header: { title, subtitle },
            sections: [
              {
                header: 'Approval Details',
                widgets: [
                  {
                    decoratedText: {
                      topLabel: 'Status',
                      text: '<b>RESOLVED & APPROVED BY HR</b>',
                    },
                  },
                  {
                    decoratedText: {
                      topLabel: 'Final Reconciled Hours',
                      text: `<b>${ctx.previousConfirmedHours ?? ctx.erpHours} hrs</b> on ${ctx.projectName}`,
                    },
                  },
                  ...(ctx.hrNote
                    ? [
                        {
                          decoratedText: {
                            topLabel: 'HR Decision Note',
                            text: `<i>"${ctx.hrNote}"</i>`,
                          },
                        },
                      ]
                    : []),
                  {
                    textParagraph: {
                      text: `Your timesheet justification for <b>${ctx.projectName}</b> (${ctx.month}) has been reviewed and approved by HR. Your record is now finalized.`,
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

  // HR Rejection / Correction Requested notice for employee
  if (isHrRejection) {
    return {
      cardsV2: [
        {
          cardId: `reconciliation-rejected-${ctx.reconciliationRecordId}`,
          card: {
            header: { title, subtitle },
            sections: [
              {
                header: 'HR Review Feedback & Revision Required',
                widgets: [
                  {
                    decoratedText: {
                      topLabel: 'Status',
                      text: '<b>CORRECTION REQUESTED BY HR</b>',
                    },
                  },
                  {
                    decoratedText: {
                      topLabel: 'Note from HR',
                      text: `<b>"${ctx.hrNote || 'Please review and resubmit your hours.'}"</b>`,
                    },
                  },
                  ...(ctx.previousConfirmedHours != null
                    ? [
                        {
                          decoratedText: {
                            topLabel: 'Previously Submitted',
                            text: `<b>${ctx.previousConfirmedHours} hrs</b> on ${ctx.projectName}`,
                          },
                        },
                      ]
                    : []),
                  {
                    textParagraph: {
                      text: `HR has reviewed your justification for <b>${ctx.projectName}</b> and requested a revision.<br>Please enter your updated/corrected hours below.`,
                    },
                  },
                  {
                    textInput: {
                      name: 'confirmedHours',
                      label: `Revised hours for ${ctx.projectName}`,
                      type: 'SINGLE_LINE',
                    },
                  },
                  {
                    buttonList: {
                      buttons: [
                        {
                          text: 'Submit Revised Hours',
                          onClick: {
                            action: buildCardAction('submitHoursConfirmation', [
                              { key: 'reconciliationRecordId', value: String(ctx.reconciliationRecordId) },
                              { key: 'inputFieldName', value: 'confirmedHours' },
                              { key: 'recipientEmail', value: String(message.recipient) },
                            ]),
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
              action: buildCardAction('submitHoursConfirmation', [
                { key: 'reconciliationRecordId', value: String(ctx.reconciliationRecordId) },
                { key: 'inputFieldName', value: 'confirmedHours' },
                { key: 'recipientEmail', value: String(message.recipient) },
              ]),
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
                          action: buildCardAction('submitHoursExplanation', [
                            { key: 'reconciliationRecordId', value: String(params.recordId) },
                            { key: 'confirmedHours', value: String(params.confirmedHours) },
                          ]),
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
    hrNote?: string | null;
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
    cardsV2: [
      {
        cardId: 'pending-requests',
        card: {
          header: {
            title: `📋 Pending Timesheets (${records.length})`,
            subtitle: titleSubtitle,
          },
          sections: records.map((rec) => {
            const fieldName = `hours_${rec.id.replace(/-/g, '')}`;
            const isCorrection = rec.status === 'CORRECTION_REQUESTED';

            const widgets: unknown[] = [];

            if (isCorrection) {
              widgets.push({
                decoratedText: {
                  topLabel: 'Status',
                  text: '<b>⚠️ HR CORRECTION REQUESTED</b>',
                },
              });
              if (rec.hrNote) {
                widgets.push({
                  decoratedText: {
                    topLabel: 'HR Feedback / Note',
                    text: `<b>"${rec.hrNote}"</b>`,
                  },
                });
              }
              widgets.push({
                textParagraph: {
                  text: `Please enter your <b>revised hours</b> for <b>${rec.projectName}</b> (${rec.month}):`,
                },
              });
            } else {
              widgets.push({
                textParagraph: {
                  text: `How many hours did you spend on <b>${rec.projectName}</b> during ${rec.month}?`,
                },
              });
            }

            widgets.push({
              textInput: {
                name: fieldName,
                label: isCorrection ? `Revised hours for ${rec.projectName}` : `Hours spent on ${rec.projectName}`,
                type: 'SINGLE_LINE',
              },
            });

            widgets.push({
              buttonList: {
                buttons: [
                  {
                    text: isCorrection ? 'Submit Revised Hours' : 'Submit Hours',
                    onClick: {
                      action: buildCardAction('submitHoursConfirmation', [
                        { key: 'reconciliationRecordId', value: String(rec.id) },
                        { key: 'inputFieldName', value: String(fieldName) },
                      ]),
                    },
                  },
                ],
              },
            });

            return {
              header: `${rec.employeeName ? `${rec.employeeName} • ` : ''}${rec.projectName} • ${rec.month}`,
              widgets,
            };
          }),
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

/**
 * Google Chat response envelope helpers (Z Mode / classic Chat API).
 *
 * Workspace Add-on deployments MUST return a pure hostAppDataAction envelope
 * with no conflicting root fields (actionResponse / text / cardsV2). Mixing
 * those shapes causes Chat log error code 3: "Can't post a reply… response was invalid."
 */

export function formatChatResponse(
  payload: {
    cardsV2?: unknown[];
    text?: string;
    title?: string;
  },
  options: { isCardAction?: boolean; isAddOn?: boolean } = {}
) {
  const isCardAction = options.isCardAction ?? false;
  const isAddOn = options.isAddOn ?? true; // Google Workspace Add-on default
  const cardsV2 = payload.cardsV2;
  const text = payload.text;

  const fallbackCardsV2 = cardsV2 ?? [
    {
      cardId: `reconciliation-action-fallback-${Date.now()}`,
      card: {
        header: { title: payload.title ?? 'Hours Reconciliation' },
        sections: [
          {
            widgets: [
              {
                textParagraph: {
                  text: text ?? 'Updated successfully.',
                },
              },
            ],
          },
        ],
      },
    },
  ];

  const resolvedCards = cardsV2 ?? (isCardAction ? fallbackCardsV2 : undefined);

  if (isAddOn) {
    // Pure Google Workspace Add-on (Z Mode) response — no conflicting root fields.
    // Card clicks must use updateMessageAction (verified working envelope).
    // New messages (pending/help) use createMessageAction.
    const message = resolvedCards
      ? { cardsV2: resolvedCards }
      : { text: text ?? (isCardAction ? 'Updated successfully.' : 'Message received.') };

    return {
      hostAppDataAction: {
        chatDataAction: isCardAction
          ? { updateMessageAction: { message } }
          : { createMessageAction: { message } },
      },
    };
  }

  // Pure Standard Google Chat API response
  return {
    actionResponse: {
      type: 'NEW_MESSAGE',
    },
    ...(resolvedCards ? { cardsV2: resolvedCards } : { text }),
  };
}
