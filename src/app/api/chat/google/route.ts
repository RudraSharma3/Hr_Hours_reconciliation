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
import { formatChatResponse } from '@/lib/adapters/messaging/googleChatResponse';

export const dynamic = 'force-dynamic';

/**
 * Google Chat / Workspace Add-on clients are picky about HTTP framing.
 * Prefer a single buffered JSON body with Content-Length (no chunked encoding,
 * no Next.js RSC vary headers) so Google can parse the Add-on envelope reliably.
 */
function chatJson(payload: unknown, status = 200): NextResponse {
  const body = JSON.stringify(payload);
  return new NextResponse(body, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(body, 'utf8')),
    },
  });
}

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
      return chatJson(resp);
    }

    // 2. CARD_CLICKED Event: Interactive card submission (Step 1: Hours, Step 2: Explanation)
    if (eventType === 'CARD_CLICKED') {
      return await handleCardClick(event, isAddOn);
    }

    // 3. MESSAGE Event: Direct chat or queries
    if (eventType === 'MESSAGE') {
      return await handleChatMessage(text, userEmail, userName, isAddOn);
    }

    return chatJson(formatChatResponse({ text: 'Event received successfully.' }, { isAddOn }));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Unhandled error processing Google Chat event:', err);
    return chatJson(
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
 * Handles interactive Form submit button clicks on Google Chat Cards v2.
 * Step 1: Employee submits blind hours (submitHoursConfirmation).
 *   - If Exact Match: returns Match Success card.
 *   - If Discrepancy: returns Discrepancy Question card (asking for reason/justification).
 * Step 2: Employee submits justification (submitHoursExplanation).
 *   - Updates record with justification and returns Awaiting HR Confirmation card.
 */
async function handleCardClick(event: any, isAddOn: boolean = true) {
  // eslint-disable-next-line no-console
  console.log('[handleCardClick] Raw Event:', JSON.stringify(event, null, 2));

  const paramsMap: Record<string, string> = {};

  const parseParams = (source: any) => {
    if (!source) return;
    if (Array.isArray(source)) {
      for (const item of source) {
        if (!item) continue;
        if (Array.isArray(item) && item.length >= 2) {
          paramsMap[String(item[0])] = String(item[1]);
        } else if (typeof item === 'object') {
          if (item.key != null && item.value != null) {
            paramsMap[String(item.key)] = String(item.value);
          } else {
            for (const [k, v] of Object.entries(item)) {
              if (v != null) paramsMap[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
            }
          }
        }
      }
    } else if (typeof source === 'object') {
      if (source.key != null && source.value != null) {
        paramsMap[String(source.key)] = String(source.value);
      } else {
        for (const [k, v] of Object.entries(source)) {
          if (v != null) paramsMap[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
        }
      }
    }
  };

  parseParams(event.commonEventObject?.parameters);
  parseParams(event.action?.parameters);
  parseParams(event.chat?.buttonClickedPayload?.action?.parameters);
  parseParams(event.buttonClickedPayload?.action?.parameters);
  parseParams(event.parameters);

  let invokedFunction =
    paramsMap.actionName ??
    event.commonEventObject?.invokedFunction ??
    event.action?.function ??
    event.action?.actionMethodName ??
    event.chat?.buttonClickedPayload?.action?.actionMethodName ??
    event.chat?.buttonClickedPayload?.action?.function ??
    'submitHoursConfirmation';

  if (Array.isArray(invokedFunction) && invokedFunction.length > 0) {
    invokedFunction = String(invokedFunction[0]);
  }
  invokedFunction = String(invokedFunction);
  // When action.function is the HTTP URL, Google may echo that URL as invokedFunction.
  if (invokedFunction.includes('/api/chat/google') || invokedFunction.startsWith('http')) {
    invokedFunction = paramsMap.actionName || 'submitHoursConfirmation';
  }

  // Extract form inputs (supports Google Workspace Add-on commonEventObject & Google Chat form inputs)
  const formInputs =
    event.commonEventObject?.formInputs ??
    event.common?.formInputs ??
    event.action?.formInputs ??
    event.chat?.buttonClickedPayload?.action?.formInputs ??
    event.formInputs ??
    {};

  // eslint-disable-next-line no-console
  console.log('[handleCardClick] Parsed paramsMap:', paramsMap, 'invokedFunction:', invokedFunction, 'formInputs:', JSON.stringify(formInputs));

  let recordId = paramsMap.reconciliationRecordId;
  if (!recordId) {
    for (const [k, v] of Object.entries(paramsMap)) {
      if (k.toLowerCase().includes('reconciliation') || k.toLowerCase().includes('recordid')) {
        recordId = v;
        break;
      }
    }
  }

  if (!recordId) {
    const errorResp = formatChatResponse(
      { text: '⚠️ Error: Missing reconciliationRecordId in action parameters. Please type *pending* to refresh your timesheet list.' },
      { isCardAction: true, isAddOn }
    );
    // eslint-disable-next-line no-console
    console.warn('handleCardClick: missing recordId. Response:', JSON.stringify(errorResp, null, 2));
    return chatJson(errorResp);
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
    return chatJson(notFoundResp);
  }

  // Helper to extract string from diverse form input shapes
  const extractVal = (obj: any): string => {
    if (obj == null) return '';
    if (typeof obj === 'string') return obj;
    if (typeof obj === 'number') return String(obj);
    if (Array.isArray(obj)) return obj.length > 0 ? extractVal(obj[0]) : '';
    if (obj.stringInputs?.value) return extractVal(obj.stringInputs.value);
    if (obj.value != null) return extractVal(obj.value);
    if (typeof obj === 'object') {
      const entries = Object.entries(obj);
      for (const [, v] of entries) {
        const val = extractVal(v);
        if (val) return val;
      }
    }
    return '';
  };

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
    return chatJson(formatted);
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
    const cleanId = record.id.replace(/-/g, '').toLowerCase();
    for (const [k, v] of Object.entries(formInputs)) {
      const kLower = k.toLowerCase();
      if (kLower.includes(cleanId) || kLower.includes('hours') || kLower.includes('confirmed')) {
        const candidate = extractVal(v);
        if (candidate) {
          hoursRaw = candidate;
          break;
        }
      }
    }
  }
  if (!hoursRaw) {
    for (const [, v] of Object.entries(formInputs)) {
      const candidate = extractVal(v);
      if (candidate && !isNaN(parseFloat(candidate))) {
        hoursRaw = candidate;
        break;
      }
    }
  }

  // Parse entered hours — Chat text inputs always submit strings (e.g. "5").
  const parsedFloat = hoursRaw && hoursRaw.trim() !== '' ? Number(hoursRaw.trim()) : NaN;
  if (!Number.isFinite(parsedFloat) || parsedFloat < 0 || parsedFloat > 1000) {
    const invalidHoursResp = formatChatResponse(
      {
        text: '⚠️ Please enter a valid number of hours (0–1000) and click Submit Hours again.',
      },
      { isCardAction: true, isAddOn }
    );
    // eslint-disable-next-line no-console
    console.warn(
      `[handleCardClick] Invalid hours input for record ${recordId}. raw=${JSON.stringify(hoursRaw)}`
    );
    return chatJson(invalidHoursResp);
  }

  const confirmedHours: number = parsedFloat;
  const diff: number = Math.abs(confirmedHours - record.erpHours);
  const isExactMatch = diff === 0;

  // eslint-disable-next-line no-console
  console.log(
    `[handleCardClick] Parsed confirmedHours: ${confirmedHours} (type: ${typeof confirmedHours}), diff: ${diff}, erpHours: ${record.erpHours}, match: ${isExactMatch}`
  );

  // Persist confirmation. Skip outbound messaging so Chat can reply synchronously
  // with the match-success or discrepancy-justification card (Z Mode).
  await submitEmployeeConfirmation({
    recordId: record.id,
    confirmedHours,
    isCorrection: record.status === 'CORRECTION_REQUESTED',
    skipOutboundNotification: true,
  });

  if (isExactMatch) {
    const successCard = buildMatchSuccessCard({
      employeeName: record.employee.name,
      projectName: record.project.name,
      month: record.month,
      confirmedHours,
      erpHours: record.erpHours,
    });
    const formatted = formatChatResponse(successCard, { isCardAction: true, isAddOn });
    // eslint-disable-next-line no-console
    console.log(`[handleCardClick] Exact match for record ${recordId}. Responding with success card.`);
    return chatJson(formatted);
  }

  const discrepancyCard = buildDiscrepancyQuestionCard({
    recordId: record.id,
    employeeName: record.employee.name,
    projectName: record.project.name,
    month: record.month,
    confirmedHours,
  });
  const formatted = formatChatResponse(discrepancyCard, { isCardAction: true, isAddOn });
  // eslint-disable-next-line no-console
  console.log(
    `[handleCardClick] Discrepancy for record ${recordId}. Responding with justification card.`
  );
  return chatJson(formatted);
}

/**
 * Handles text queries sent to the bot (e.g. "pending", "status", "help").
 */
async function handleChatMessage(text: string, userEmail?: string, userName?: string, isAddOn: boolean = true) {
  if (text.includes('help') || text === 'hi' || text === 'hello' || !text) {
    return chatJson(
      formatChatResponse({
        text: `🤖 *Timesheet Reconciliation Bot*\n\nHello ${userName}! Here are your available commands:\n• Type *pending* to view and confirm your open monthly timesheet reconciliation requests.\n• Type *status* to check your current reconciliation status.\n\n_Zero-tolerance rule: If your confirmed hours differ from ERP, please provide an explanation._`,
        ...buildHelpCard(),
      }, { isAddOn })
    );
  }

  // 1. Check if the current sender is an authenticated Admin
  // eslint-disable-next-line no-console
  console.log(`[handleChatMessage] text="${text}", userEmail="${userEmail}", userName="${userName}", isAddOn=${isAddOn}`);

  const adminUser = userEmail
    ? await prisma.adminUser.findFirst({
      where: { email: { equals: userEmail, mode: 'insensitive' } },
    })
    : null;
  const isAdmin = Boolean(adminUser);

  // 2. Check if a specific employee query was requested (e.g. "pending Byte019" or "pending Pavana")
  const targetQuery = text.replace(/^pending\s*/i, '').replace(/^status\s*/i, '').trim();
  let matchingEmployeeIds: string[] = [];
  let empDisplayName = userName ?? 'Employee';

  if (targetQuery && targetQuery !== 'pending' && targetQuery !== 'status') {
    if (!isAdmin) {
      // Non-admin attempting to query someone else -> strictly block
      return chatJson(
      formatChatResponse({
          text: `🔒 *Access Restricted*\n\nYou can only view and reconcile your own timesheets. Querying other employees' records is restricted to administrators.\n\nType *pending* to view your own timesheet requests.`,
        }, { isAddOn })
      );
    }

    // Admin allowed to query specific employee
    const targetEmps = await prisma.employee.findMany({
      where: {
        OR: [
          { name: { contains: targetQuery, mode: 'insensitive' } },
          { employeeCode: { contains: targetQuery, mode: 'insensitive' } },
          { email: { contains: targetQuery, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true },
    });

    if (targetEmps.length === 0) {
      return chatJson(
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
          ...(userEmail ? [{ email: { equals: userEmail, mode: 'insensitive' as const } }] : []),
          ...(userName && userName !== 'Employee'
            ? [{ name: { equals: userName, mode: 'insensitive' as const } }]
            : []),
        ],
      },
      select: { id: true, name: true },
    });

    // eslint-disable-next-line no-console
    console.log(`[handleChatMessage] Found ${myEmps.length} employee profile(s) for ${userEmail || userName}`);

    if (myEmps.length === 0) {
      return chatJson(
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

  // eslint-disable-next-line no-console
  console.log(`[handleChatMessage] Found ${pendingRecords.length} pending record(s) for ${empDisplayName}`);

  const cardPayload = buildPendingRequestsCard(
    empDisplayName,
    pendingRecords.map((r) => ({
      id: r.id,
      projectName: r.project.name,
      month: r.month,
      status: r.status,
    }))
  );

  // Cards only inside createMessageAction (no root text) — Z Mode.
  const pendingResp = formatChatResponse({ ...cardPayload }, { isAddOn });
  // eslint-disable-next-line no-console
  console.log(
    '[handleChatMessage] Pending reply envelope:',
    JSON.stringify({
      keys: Object.keys(pendingResp),
      action: Object.keys((pendingResp as any).hostAppDataAction?.chatDataAction ?? {}),
    })
  );
  return chatJson(pendingResp);
}
