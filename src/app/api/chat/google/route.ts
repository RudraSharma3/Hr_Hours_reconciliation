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
    event.chat?.messagePayload?.message?.text ??
    event.chat?.messagePayload?.message?.argumentText ??
    event.message?.text ??
    event.message?.argumentText ??
    '';
  const text = rawText.trim().toLowerCase();

  const isAddon = Boolean(event.commonEventObject || event.chat);

  try {
    // 1. ADDED_TO_SPACE Event: Onboarding card
    if (eventType === 'ADDED_TO_SPACE') {
      const resp = formatChatResponse(
        {
          text: '🤖 *Welcome to the Hours Reconciliation Bot!*\n\nType *pending* to view and confirm your open timesheets.\nType *help* for more information.',
          ...buildHelpCard(),
        },
        isAddon
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

    return NextResponse.json({ text: 'Event received successfully.' });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Unhandled error processing Google Chat event:', err);
    return NextResponse.json(
      formatChatResponse(
        { text: `⚠️ Error processing request: ${err instanceof Error ? err.message : String(err)}` },
        isAddon
      )
    );
  }
}

/**
 * Dual-format response wrapper supporting both standard Chat API and Google Workspace Add-ons.
 */
function formatChatResponse(payload: any, isAddon: boolean) {
  if (isAddon) {
    // Strip actionResponse so message contains only valid Message schema
    const { actionResponse, ...cleanPayload } = payload;
    const actionKey =
      actionResponse?.type === 'UPDATE_MESSAGE' ? 'updateMessageAction' : 'createMessageAction';

    return {
      hostAppDataAction: {
        chatDataAction: {
          [actionKey]: {
            message: cleanPayload,
          },
        },
      },
    };
  }

  return payload;
}


/**
 * Handles interactive Form submit button clicks on Google Chat Cards v2.
 */
async function handleCardClick(event: any, isAddon: boolean) {
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
  for (const p of event.action?.parameters ?? []) {
    paramsMap[p.key] = p.value;
  }

  const recordId = paramsMap.reconciliationRecordId;
  if (!recordId) {
    const errorResp = formatChatResponse(
      { text: '⚠️ Error: Missing reconciliationRecordId in action parameters.' },
      isAddon
    );
    // eslint-disable-next-line no-console
    console.warn('handleCardClick: missing recordId. Response:', JSON.stringify(errorResp, null, 2));
    return NextResponse.json(errorResp);
  }

  // Extract form inputs (supports Google Workspace Add-on commonEventObject & Google Chat common.formInputs)
  const formInputs =
    event.commonEventObject?.formInputs ??
    event.common?.formInputs ??
    event.formInputs ??
    {};

  const inputFieldName = paramsMap.inputFieldName ?? 'confirmedHours';
  const rawInput =
    formInputs[inputFieldName]?.stringInputs?.value?.[0] ??
    formInputs[inputFieldName]?.value?.[0] ??
    formInputs[inputFieldName]?.value ??
    formInputs[inputFieldName] ??
    formInputs.confirmedHours?.stringInputs?.value?.[0] ??
    formInputs.confirmedHours?.value?.[0] ??
    formInputs.confirmedHours ??
    '';

  const hoursRaw = typeof rawInput === 'string' ? rawInput : (Array.isArray(rawInput) ? rawInput[0] : String(rawInput || ''));

  const rawExplanation =
    formInputs.explanation?.stringInputs?.value?.[0] ??
    formInputs.explanation?.value?.[0] ??
    formInputs.explanation ??
    undefined;
  const explanation = typeof rawExplanation === 'string' ? rawExplanation : undefined;

  const confirmedHours = parseFloat(hoursRaw);
  if (isNaN(confirmedHours) || confirmedHours < 0 || confirmedHours > 1000) {
    const invalidHoursResp = formatChatResponse(
      { text: '⚠️ Please enter a valid number of hours (e.g. 76 or 40.5).' },
      isAddon
    );
    return NextResponse.json(invalidHoursResp);
  }

  // Fetch target reconciliation record
  const record = await prisma.reconciliationRecord.findUnique({
    where: { id: recordId },
    include: { employee: true, project: true },
  });

  if (!record) {
    const notFoundResp = formatChatResponse(
      { text: '⚠️ Reconciliation record not found or already archived.' },
      isAddon
    );
    return NextResponse.json(notFoundResp);
  }

  const isCorrection =
    record.status === 'CORRECTION_REQUESTED' || record.status === 'FLAGGED';

  // Execute reconciliation submission & zero-tolerance matching rule
  await submitEmployeeConfirmation({
    recordId: record.id,
    confirmedHours,
    explanation,
    isCorrection,
  });

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

  const formatted = formatChatResponse(cardPayload, isAddon);
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
        isAddon
      )
    );
  }

  // 1. Try finding employee by Google Chat email
  let employee = userEmail
    ? await prisma.employee.findUnique({
        where: { email: userEmail },
      })
    : null;

  // 2. Try finding employee by displayName if testing
  if (!employee && userName && userName !== 'Employee') {
    employee = await prisma.employee.findFirst({
      where: { name: { contains: userName } },
    });
  }

  // 3. Fallback to any employee with pending records for local testing
  if (!employee) {
    employee = await prisma.employee.findFirst({
      where: {
        reconciliations: {
          some: { status: { in: ['AWAITING_RESPONSE', 'CORRECTION_REQUESTED', 'FLAGGED'] } },
        },
      },
    });
  }

  if (!employee) {
    return NextResponse.json(
      formatChatResponse(
        {
          text: `Hello ${userName}! No pending timesheet reconciliation records were found in the database.`,
          ...buildHelpCard(),
        },
        isAddon
      )
    );
  }

  const pendingRecords = await prisma.reconciliationRecord.findMany({
    where: {
      employeeId: employee.id,
      status: { in: ['AWAITING_RESPONSE', 'CORRECTION_REQUESTED', 'FLAGGED'] },
    },
    include: { project: true },
    orderBy: { month: 'desc' },
  });

  const cardPayload = buildPendingRequestsCard(
    employee.name,
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
        text: `📋 Found ${pendingRecords.length} pending timesheets for *${employee.name}*.`,
        ...cardPayload,
      },
      isAddon
    )
  );
}

