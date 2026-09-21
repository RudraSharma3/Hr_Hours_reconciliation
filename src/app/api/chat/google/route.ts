import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { submitEmployeeConfirmation } from '@/lib/reconciliationService';
import {
  buildMatchSuccessCard,
  buildDiscrepancyQuestionCard,
  buildAwaitingHrConfirmationCard,
  buildPendingRequestsCard,
  buildHelpCard,
} from '@/lib/adapters/messaging/googleChatAdapter';

export const dynamic = 'force-dynamic';

/**
 * Inbound Google Chat App Webhook handler.
 *
 * Configured in Google Cloud Console > Google Chat API as the Interactive Endpoint URL:
 * https://<your-domain>/api/chat/google
 *
 * Processes:
 * 1. CARD_CLICKED: Form submissions from interactive Cards v2 (employee submits hours / justification).
 * 2. MESSAGE: Text queries from employees (e.g. "pending", "status", "help").
 * 3. ADDED_TO_SPACE: Onboarding welcome card.
 */

interface GoogleChatEvent {
  type?: 'CARD_CLICKED' | 'MESSAGE' | 'ADDED_TO_SPACE' | 'REMOVED_FROM_SPACE';
  token?: string;
  user?: {
    name?: string;
    displayName?: string;
    email?: string;
    type?: string;
  };
  space?: {
    name?: string;
    type?: string;
    displayName?: string;
  };
  message?: {
    text?: string;
    name?: string;
  };
  action?: {
    actionMethodName?: string;
    function?: string;
    parameters?: Array<{ key: string; value: string }>;
  };
  common?: {
    formInputs?: Record<string, { stringInputs?: { value?: string[] } }>;
  };
  // Fallback for different payload shapes
  formInputs?: Record<string, { stringInputs?: { value?: string[] } }>;
}

export async function POST(req: NextRequest) {
  // eslint-disable-next-line no-console
  console.log(`\n📥 [GOOGLE CHAT WEBHOOK RECEIVED] ${new Date().toISOString()}`);

  const verificationToken = process.env.GOOGLE_CHAT_VERIFICATION_TOKEN;
  const rawBody = await req.text();
  let event: any;

  try {
    event = JSON.parse(rawBody);
    // eslint-disable-next-line no-console
    console.log('Incoming Google Chat Event Payload:', JSON.stringify(event, null, 2));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Invalid JSON from Google Chat:', err);
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  if (verificationToken && event.token && event.token !== verificationToken) {
    // eslint-disable-next-line no-console
    console.warn('Google Chat verification token mismatch');
    return NextResponse.json({ error: 'Invalid Google Chat verification token' }, { status: 401 });
  }

  // 1. Determine Event Type (supports standard Chat API & Google Workspace Add-on format)
  let eventType: string = 'MESSAGE';
  if (event.type) {
    eventType = event.type;
  } else if (event.chat?.buttonClickedPayload || event.commonEventObject?.invokedFunction || event.action) {
    eventType = 'CARD_CLICKED';
  } else if (event.chat?.addedToSpacePayload) {
    eventType = 'ADDED_TO_SPACE';
  } else if (event.chat?.messagePayload) {
    eventType = 'MESSAGE';
  }

  // 2. Extract User Identity
  const userEmail =
    event.chat?.user?.email ??
    event.user?.email ??
    event.chat?.messagePayload?.message?.sender?.email ??
    event.message?.sender?.email ??
    event.sender?.email;

  const userName =
    event.chat?.user?.displayName ??
    event.user?.displayName ??
    event.chat?.messagePayload?.message?.sender?.displayName ??
    event.message?.sender?.displayName ??
    userEmail ??
    'Employee';

  // 3. Extract Message Text
  const rawText =
    event.chat?.messagePayload?.message?.argumentText ??
    event.message?.argumentText ??
    event.chat?.messagePayload?.message?.text ??
    event.message?.text ??
    '';
  const cleanRaw = rawText
    .replace(/^<users\/[^>]+>\s*/i, '')
    .replace(/^@[\w\s.-]+\s*/i, '')
    .trim();
  const text = (cleanRaw || rawText).trim().toLowerCase();

  const isAddOn = Boolean(
    event.commonEventObject ||
    event.chat ||
    event.authorizationEventObject ||
    !event.type
  );

  try {
    // 1. ADDED_TO_SPACE Event: Onboarding card
    if (eventType === 'ADDED_TO_SPACE') {
      const resp = formatChatResponse({
        text: '🤖 *Welcome to the Hours Reconciliation Bot!*\n\nI will automatically notify you when new timesheets are imported from ERP for verification.\nType *pending* to view any open timesheets.',
        ...buildHelpCard(),
      }, { isAddOn });
      // eslint-disable-next-line no-console
      console.log('Responding ADDED_TO_SPACE:', JSON.stringify(resp, null, 2));
      return NextResponse.json(resp);
    }

    // 2. CARD_CLICKED Event: Interactive card submission (Step 1: Hours, Step 2: Explanation)
    if (eventType === 'CARD_CLICKED') {
      return await handleCardClick(event, isAddOn);
    }

    // 3. MESSAGE Event: Direct chat or queries
    if (eventType === 'MESSAGE') {
      return await handleChatMessage(text, userEmail, userName, isAddOn);
    }

    return NextResponse.json({ text: 'Event received successfully.' });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Unhandled error processing Google Chat event:', err);
    return NextResponse.json(
      formatChatResponse(
        {
          text: `⚠️ Error processing request: ${err instanceof Error ? err.message : String(err)}`,
        },
        { isCardAction: eventType === 'CARD_CLICKED', isAddOn }
      )
    );
  }
}

/**
 * Clean response formatter for Google Chat.
 * Supports:
 * 1. Google Workspace Add-on (Z Mode): returns hostAppDataAction without conflicting root properties.
 * 2. Standard Google Chat API: returns actionResponse and cardsV2 at root.
 */
function formatChatResponse(
  payload: any,
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
    // Pure Google Workspace Add-on (Z Mode) response
    if (isCardAction) {
      return {
        hostAppDataAction: {
          chatDataAction: {
            updateMessageAction: {
              message: {
                ...(text ? { text } : {}),
                ...(resolvedCards ? { cardsV2: resolvedCards } : {}),
              },
            },
          },
        },
      };
    }

    return {
      hostAppDataAction: {
        chatDataAction: {
          createMessageAction: {
            message: {
              ...(text ? { text } : {}),
              ...(resolvedCards ? { cardsV2: resolvedCards } : {}),
            },
          },
        },
      },
    };
  }

  // Pure Standard Google Chat API response
  return {
    actionResponse: {
      type: isCardAction ? 'UPDATE_MESSAGE' : 'NEW_MESSAGE',
    },
    ...(text ? { text } : {}),
    ...(resolvedCards ? { cardsV2: resolvedCards } : {}),
  };
}

/**
 * Handles interactive Form submit button clicks on Google Chat Cards v2.
 * Step 1: Employee submits blind hours (submitHoursConfirmation).
 *   - If Exact Match: returns Match Success card.
 *   - If Discrepancy: returns Discrepancy Question card (asking for reason/justification).
 * Step 2: Employee submits justification (submitHoursExplanation).
 *   - Updates record with justification and returns Awaiting HR Confirmation card.
 */
async function handleCardClick(event: any, isAddOn: boolean = true) {
  const paramsMap: Record<string, string> = {};

  // 1. Google Workspace Add-on parameters
  if (event.commonEventObject?.parameters) {
    if (Array.isArray(event.commonEventObject.parameters)) {
      for (const p of event.commonEventObject.parameters) {
        if (p?.key && p?.value) paramsMap[p.key] = p.value;
      }
    } else if (typeof event.commonEventObject.parameters === 'object') {
      Object.assign(paramsMap, event.commonEventObject.parameters);
    }
  }

  // 2. Google Chat API action parameters
  const actionParams =
    event.action?.parameters ??
    event.chat?.buttonClickedPayload?.action?.parameters ??
    event.buttonClickedPayload?.action?.parameters ??
    [];
  for (const p of actionParams) {
    if (p?.key && p?.value) paramsMap[p.key] = p.value;
  }

  const recordId = paramsMap.reconciliationRecordId;
  if (!recordId) {
    const errorResp = formatChatResponse(
      { text: '⚠️ Error: Missing reconciliationRecordId in action parameters. Please type *pending* to refresh your timesheet list.' },
      { isCardAction: true, isAddOn }
    );
    // eslint-disable-next-line no-console
    console.warn('handleCardClick: missing recordId. Response:', JSON.stringify(errorResp, null, 2));
    return NextResponse.json(errorResp);
  }

  // Fetch target reconciliation record
  const record = await prisma.reconciliationRecord.findUnique({
    where: { id: recordId },
    include: { employee: true, project: true },
  });

  if (!record) {
    const notFoundResp = formatChatResponse(
      {
        cardsV2: [
          {
            cardId: `reconciliation-not-found-${Date.now()}`,
            card: {
              header: { title: '⚠️ Timesheet Already Processed' },
              sections: [
                {
                  widgets: [
                    {
                      textParagraph: {
                        text: 'This timesheet card has already been processed or updated. Type <b>pending</b> to refresh your active list.',
                      },
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
      { isCardAction: true, isAddOn }
    );
    return NextResponse.json(notFoundResp);
  }

  // Extract form inputs (supports Google Workspace Add-on commonEventObject & Google Chat form inputs)
  const formInputs =
    event.commonEventObject?.formInputs ??
    event.common?.formInputs ??
    event.action?.formInputs ??
    event.chat?.buttonClickedPayload?.action?.formInputs ??
    event.formInputs ??
    {};

  // Helper to extract string from diverse form input shapes
  const extractVal = (obj: any): string => {
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    if (typeof obj === 'number') return String(obj);
    if (Array.isArray(obj)) return obj[0] ? String(obj[0]) : '';
    if (obj.stringInputs?.value?.[0]) return String(obj.stringInputs.value[0]);
    if (obj.value?.[0]) return String(obj.value[0]);
    if (obj.value != null) return String(obj.value);
    return '';
  };

  const invokedFunction =
    event.commonEventObject?.invokedFunction ??
    event.action?.function ??
    event.action?.actionMethodName ??
    event.chat?.buttonClickedPayload?.action?.actionMethodName ??
    'submitHoursConfirmation';

  // ---------------------------------------------------------------------------
  // STEP 2: Employee Submits Reason / Justification for Mismatch
  // ---------------------------------------------------------------------------
  if (invokedFunction === 'submitHoursExplanation') {
    let explanationRaw =
      extractVal(formInputs.employeeExplanation) ||
      extractVal(formInputs.explanation) ||
      'Discrepancy noted by employee';

    const confirmedHours = paramsMap.confirmedHours
      ? parseFloat(paramsMap.confirmedHours)
      : record.employeeConfirmedHours ?? record.erpHours;

    await prisma.reconciliationRecord.update({
      where: { id: record.id },
      data: {
        employeeExplanation: explanationRaw.trim(),
        status: 'FLAGGED',
        result: 0,
      },
    });

    await prisma.auditEvent.create({
      data: {
        reconciliationRecordId: record.id,
        eventType: 'EMPLOYEE_JUSTIFICATION_SUBMITTED',
        actor: 'employee',
        details: JSON.stringify({
          explanation: explanationRaw.trim(),
          confirmedHours,
          erpHours: record.erpHours,
          difference: record.difference ?? Math.abs(confirmedHours - record.erpHours),
        }),
      },
    });

    const awaitingCard = buildAwaitingHrConfirmationCard({
      employeeName: record.employee.name,
      projectName: record.project.name,
      month: record.month,
      confirmedHours,
      explanation: explanationRaw.trim(),
    });

    const formatted = formatChatResponse(awaitingCard, { isCardAction: true, isAddOn });
    // eslint-disable-next-line no-console
    console.log(`[handleCardClick] Justification saved for record ${recordId}. Responding with awaiting card.`);
    return NextResponse.json(formatted);
  }

  // ---------------------------------------------------------------------------
  // STEP 1: Employee Submits Blind Confirmed Hours
  // ---------------------------------------------------------------------------
  const inputFieldName = paramsMap.inputFieldName ?? `confirmedHours_${record.id}`;

  let hoursRaw = extractVal(formInputs[inputFieldName]);
  if (!hoursRaw && formInputs.confirmedHours) {
    hoursRaw = extractVal(formInputs.confirmedHours);
  }
  if (!hoursRaw) {
    for (const [k, v] of Object.entries(formInputs)) {
      if (k.toLowerCase().includes('confirmedhours')) {
        const candidate = extractVal(v);
        if (candidate) {
          hoursRaw = candidate;
          break;
        }
      }
    }
  }

  // Parse entered hours
  let confirmedHours = record.erpHours;
  if (hoursRaw && hoursRaw.trim() !== '') {
    const parsed = parseFloat(hoursRaw.trim());
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1000) {
      confirmedHours = parsed;
    }
  }

  const diff = Math.abs(confirmedHours - record.erpHours);

  // Exact Match (Zero Difference)
  if (diff === 0) {
    await submitEmployeeConfirmation({
      recordId: record.id,
      confirmedHours,
      isCorrection: false,
      skipOutboundNotification: true,
    });

    const matchCard = buildMatchSuccessCard({
      employeeName: record.employee.name,
      projectName: record.project.name,
      month: record.month,
      confirmedHours,
      erpHours: record.erpHours,
    });

    const formatted = formatChatResponse(matchCard, { isCardAction: true, isAddOn });
    // eslint-disable-next-line no-console
    console.log(`[handleCardClick] Exact match for record ${recordId}. Responding with success card.`);
    return NextResponse.json(formatted);
  }

  // Discrepancy Flagged -> Prompt for Reason / Justification
  await prisma.reconciliationRecord.update({
    where: { id: record.id },
    data: {
      employeeConfirmedHours: confirmedHours,
      difference: diff,
      result: 0,
      status: 'FLAGGED',
    },
  });

  await prisma.auditEvent.create({
    data: {
      reconciliationRecordId: record.id,
      eventType: 'EMPLOYEE_SUBMITTED_MISMATCH',
      actor: 'employee',
      details: JSON.stringify({
        confirmedHours,
        erpHours: record.erpHours,
        difference: diff,
      }),
    },
  });

  const discrepancyCard = buildDiscrepancyQuestionCard({
    recordId: record.id,
    employeeName: record.employee.name,
    projectName: record.project.name,
    month: record.month,
    confirmedHours,
  });

  const formatted = formatChatResponse(discrepancyCard, { isCardAction: true, isAddOn });
  // eslint-disable-next-line no-console
  console.log(`[handleCardClick] Discrepancy flagged for record ${recordId} (diff: ${diff}). Responding with justification question card.`);
  return NextResponse.json(formatted);
}

/**
 * Handles text queries sent to the bot (e.g. "pending", "status", "help").
 */
async function handleChatMessage(text: string, userEmail?: string, userName?: string, isAddOn: boolean = true) {
  if (text.includes('help') || text === 'hi' || text === 'hello' || !text) {
    return NextResponse.json(
      formatChatResponse({
        text: `🤖 *Timesheet Reconciliation Bot*\n\nHello ${userName}! Here are your available commands:\n• Type *pending* to view and confirm your open monthly timesheet reconciliation requests.\n• Type *status* to check your current reconciliation status.\n\n_Zero-tolerance rule: If your confirmed hours differ from ERP, please provide an explanation._`,
        ...buildHelpCard(),
      }, { isAddOn })
    );
  }

  // 1. Check if the current sender is an authenticated Admin
  const adminUser = userEmail
    ? await prisma.adminUser.findUnique({ where: { email: userEmail } })
    : null;
  const isAdmin = Boolean(adminUser);

  // 2. Check if a specific employee query was requested (e.g. "pending Byte019" or "pending Pavana")
  const targetQuery = text.replace(/^pending\s*/i, '').replace(/^status\s*/i, '').trim();
  let matchingEmployeeIds: string[] = [];
  let empDisplayName = userName ?? 'Employee';

  if (targetQuery && targetQuery !== 'pending' && targetQuery !== 'status') {
    if (!isAdmin) {
      // Non-admin attempting to query someone else -> strictly block
      return NextResponse.json(
        formatChatResponse({
          text: `🔒 *Access Restricted*\n\nYou can only view and reconcile your own timesheets. Querying other employees' records is restricted to administrators.\n\nType *pending* to view your own timesheet requests.`,
        }, { isAddOn })
      );
    }

    // Admin allowed to query specific employee
    const targetEmps = await prisma.employee.findMany({
      where: {
        OR: [
          { name: { contains: targetQuery } },
          { employeeCode: { contains: targetQuery } },
          { email: { contains: targetQuery } },
        ],
      },
      select: { id: true, name: true },
    });

    if (targetEmps.length === 0) {
      return NextResponse.json(
        formatChatResponse({
          text: `🔍 No employee found matching query: *${targetQuery}*.`,
        }, { isAddOn })
      );
    }

    matchingEmployeeIds = targetEmps.map((e) => e.id);
    empDisplayName = targetEmps[0].name;
  } else {
    // 3. Regular employee querying their own pending records across all their profile IDs
    const myEmps = await prisma.employee.findMany({
      where: {
        OR: [
          ...(userEmail ? [{ email: { equals: userEmail } }] : []),
          ...(userName && userName !== 'Employee'
            ? [{ name: { equals: userName } }]
            : []),
        ],
      },
      select: { id: true, name: true },
    });

    if (myEmps.length === 0) {
      return NextResponse.json(
        formatChatResponse({
          text: `⚠️ No timesheet profile found for *${userName}* (${userEmail || 'unknown email'}).\n\nPlease ensure your email or name matches your ERP timesheet profile.`,
          ...buildPendingRequestsCard(userName ?? 'Employee', []),
        }, { isAddOn })
      );
    }

    matchingEmployeeIds = myEmps.map((e) => e.id);
    empDisplayName = myEmps[0].name ?? userName ?? 'Employee';
  }

  // Strictly query pending records for this user's matching employee IDs
  const pendingRecords = await prisma.reconciliationRecord.findMany({
    where: {
      employeeId: { in: matchingEmployeeIds },
      status: { in: ['AWAITING_RESPONSE', 'CORRECTION_REQUESTED', 'FLAGGED'] },
    },
    include: { project: true, employee: true },
    orderBy: [{ month: 'desc' }, { createdAt: 'desc' }],
  });

  const cardPayload = buildPendingRequestsCard(
    empDisplayName,
    pendingRecords.map((r) => ({
      id: r.id,
      projectName: r.project.name,
      month: r.month,
      erpHours: r.erpHours,
      status: r.status,
    }))
  );

  return NextResponse.json(
    formatChatResponse({
      text: `📋 Found ${pendingRecords.length} pending timesheet(s) for *${empDisplayName}*.`,
      ...cardPayload,
    }, { isAddOn })
  );
}
