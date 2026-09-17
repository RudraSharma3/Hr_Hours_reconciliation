import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { submitEmployeeConfirmation } from '@/lib/reconciliationService';
import {
  buildMatchSuccessCard,
  buildMismatchCard,
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
 * 1. CARD_CLICKED: Form submissions from interactive Cards v2 (employee submits hours).
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

  const isAddon = Boolean(
    event.commonEventObject ||
    event.chat ||
    req.headers.get('user-agent')?.includes('Google-gsuiteaddons')
  );

  try {
    // 1. ADDED_TO_SPACE Event: Onboarding card
    if (eventType === 'ADDED_TO_SPACE') {
      const resp = formatChatResponse(
        {
          text: '🤖 *Welcome to the Hours Reconciliation Bot!*\n\nType *pending* to view and confirm your open timesheets.\nType *help* for more information.',
          ...buildHelpCard(),
        },
        { isCardAction: false, isAddon }
      );
      // eslint-disable-next-line no-console
      console.log('Responding ADDED_TO_SPACE:', JSON.stringify(resp, null, 2));
      return NextResponse.json(resp);
    }

    // 2. CARD_CLICKED Event: Interactive card submission
    if (eventType === 'CARD_CLICKED') {
      return await handleCardClick(event, isAddon);
    }

    // 3. MESSAGE Event: Direct chat or slash commands
    if (eventType === 'MESSAGE') {
      return await handleChatMessage(text, userEmail, userName, isAddon);
    }

    return NextResponse.json(
      formatChatResponse({ text: 'Event received successfully.' }, { isAddon })
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Unhandled error processing Google Chat event:', err);
    return NextResponse.json(
      formatChatResponse(
        { text: `⚠️ Error processing request: ${err instanceof Error ? err.message : String(err)}` },
        { isCardAction: eventType === 'CARD_CLICKED', isAddon }
      )
    );
  }
}

/**
 * Strict response formatter supporting both Google Workspace Add-on runtime (isAddon: true)
 * and standard Google Chat API HTTP interactive endpoints (isAddon: false).
 */
function formatChatResponse(
  payload: any,
  options: { isCardAction?: boolean; isAddon?: boolean } = {}
) {
  const { actionResponse, hostAppDataAction, ...cleanPayload } = payload;
  const isCardAction = options.isCardAction ?? false;
  const isAddon = options.isAddon ?? false;

  const responseMessage = {
    ...(cleanPayload.text ? { text: cleanPayload.text } : {}),
    ...(cleanPayload.cardsV2 ? { cardsV2: cleanPayload.cardsV2 } : {}),
  };

  // Google Workspace Add-on runtime expects strictly hostAppDataAction
  if (isAddon) {
    return {
      hostAppDataAction: {
        chatDataAction: {
          createMessageAction: {
            message: responseMessage,
          },
        },
      },
    };
  }

  // Standard Google Chat API HTTP interactive endpoints
  if (isCardAction) {
    const actResp = actionResponse ?? { type: 'NEW_MESSAGE' };
    return {
      actionResponse: actResp,
      ...cleanPayload,
    };
  }

  return {
    ...cleanPayload,
  };
}


/**
 * Handles interactive Form submit button clicks on Google Chat Cards v2.
 */
async function handleCardClick(event: any, isAddon: boolean = false) {
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
      { isCardAction: true, isAddon }
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
      { text: '⚠️ Reconciliation record not found or already archived. Please type *pending* to refresh your timesheet list.' },
      { isCardAction: true, isAddon }
    );
    return NextResponse.json(notFoundResp);
  }

  // Extract form inputs (supports Google Workspace Add-on commonEventObject & Google Chat common.formInputs & action.formInputs)
  const formInputs =
    event.commonEventObject?.formInputs ??
    event.common?.formInputs ??
    event.action?.formInputs ??
    event.chat?.buttonClickedPayload?.action?.formInputs ??
    event.formInputs ??
    {};

  const inputFieldName = paramsMap.inputFieldName ?? `confirmedHours_${record.id}`;

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

  // If user clicked confirm with an empty box, default to confirming their erpHours
  let confirmedHours = record.erpHours;
  if (hoursRaw && hoursRaw.trim() !== '') {
    const parsed = parseFloat(hoursRaw.trim());
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1000) {
      confirmedHours = parsed;
    }
  }

  const rawExplanation = extractVal(formInputs.explanation);
  const explanation = rawExplanation.trim() ? rawExplanation.trim() : undefined;

  const isCorrection =
    record.status === 'CORRECTION_REQUESTED' || record.status === 'FLAGGED';

  // Execute reconciliation submission & zero-tolerance matching rule
  try {
    await submitEmployeeConfirmation({
      recordId: record.id,
      confirmedHours,
      explanation,
      isCorrection,
      skipOutboundNotification: true,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error in submitEmployeeConfirmation:', err);
  }

  // Re-fetch updated record to render appropriate instant response card
  const updated = await prisma.reconciliationRecord.findUniqueOrThrow({
    where: { id: record.id },
    include: { employee: true, project: true },
  });

  let cardPayload: any;
  if (updated.status === 'MATCHED') {
    cardPayload = buildMatchSuccessCard({
      employeeName: updated.employee.name,
      projectName: updated.project.name,
      month: updated.month,
      confirmedHours,
      erpHours: updated.erpHours,
    });
  } else {
    cardPayload = buildMismatchCard({
      recordId: updated.id,
      employeeName: updated.employee.name,
      projectName: updated.project.name,
      month: updated.month,
      confirmedHours,
      erpHours: updated.erpHours,
      difference: updated.difference ?? Math.abs(confirmedHours - updated.erpHours),
      explanation,
    });
  }

  const formatted = formatChatResponse(cardPayload, { isCardAction: true, isAddon });
  // eslint-disable-next-line no-console
  console.log(`[handleCardClick] Responding for record ${recordId} (${updated.status}):\n`, JSON.stringify(formatted, null, 2));
  return NextResponse.json(formatted);
}

/**
 * Handles text queries sent to the bot (e.g. "pending", "status", "help").
 */
async function handleChatMessage(text: string, userEmail?: string, userName?: string, isAddon: boolean = false) {
  if (text.includes('help') || text === 'hi' || text === 'hello' || !text) {
    return NextResponse.json(
      formatChatResponse(
        {
          text: `🤖 *Timesheet Reconciliation Bot*\n\nHello ${userName}! Here are your available commands:\n• Type *pending* to view and confirm your open monthly timesheet reconciliation requests.\n• Type *status* to check your current reconciliation status.\n\n_Zero-tolerance rule: If your confirmed hours differ from ERP, please provide an explanation._`,
          ...buildHelpCard(),
        },
        { isCardAction: false, isAddon }
      )
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
        formatChatResponse(
          {
            text: `🔒 *Access Restricted*\n\nYou can only view and reconcile your own timesheets. Querying other employees' records is restricted to administrators.\n\nType *pending* to view your own timesheet requests.`,
          },
          { isCardAction: false, isAddon }
        )
      );
    }

    // Admin allowed to query specific employee
    const targetEmps = await prisma.employee.findMany({
      where: {
        OR: [
          { name: { contains: targetQuery, mode: 'insensitive' as const } },
          { employeeCode: { contains: targetQuery, mode: 'insensitive' as const } },
          { email: { contains: targetQuery, mode: 'insensitive' as const } },
        ],
      },
      select: { id: true, name: true },
    });

    if (targetEmps.length === 0) {
      return NextResponse.json(
        formatChatResponse(
          {
            text: `🔍 No employee found matching query: *${targetQuery}*.`,
          },
          { isCardAction: false, isAddon }
        )
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

    if (myEmps.length === 0) {
      return NextResponse.json(
        formatChatResponse(
          {
            text: `⚠️ No timesheet profile found for *${userName}* (${userEmail || 'unknown email'}).\n\nPlease ensure your email or name matches your ERP timesheet profile.`,
            ...buildPendingRequestsCard(userName ?? 'Employee', []),
          },
          { isCardAction: false, isAddon }
        )
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
    formatChatResponse(
      {
        text: `📋 Found ${pendingRecords.length} pending timesheet(s) for *${empDisplayName}*.`,
        ...cardPayload,
      },
      { isCardAction: false, isAddon }
    )
  );
}
