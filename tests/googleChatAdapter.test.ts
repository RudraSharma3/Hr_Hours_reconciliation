import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  GoogleChatAdapter,
  buildGoogleChatCardPayload,
  buildMatchSuccessCard,
  buildMismatchCard,
  buildPendingRequestsCard,
  buildHelpCard,
} from '../src/lib/adapters/messaging/googleChatAdapter';
import { getMessagingAdapter } from '../src/lib/adapters/messaging';
import type { OutboundMessage } from '../src/lib/adapters/messaging/types';

describe('GoogleChatAdapter & Cards v2', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('buildGoogleChatCardPayload generates interactive card for initial request', () => {
    const msg: OutboundMessage = {
      recipient: 'employee@company.local',
      subject: 'Please confirm your hours for 2026-08',
      body: 'Hi Alice, please confirm your 76 hours on Project Apollo.',
      template: 'INITIAL_REQUEST',
      context: {
        reconciliationRecordId: 'rec-123',
        employeeName: 'Alice',
        projectName: 'Project Apollo',
        month: '2026-08',
        erpHours: 76,
        kind: 'INITIAL_REQUEST',
      },
    };

    const payload = buildGoogleChatCardPayload(msg);
    expect(payload.cardsV2).toBeDefined();
    expect(payload.cardsV2.length).toBe(1);

    const card = payload.cardsV2[0].card;
    expect(card.header.title).toContain('2026-08');
    expect(card.header.subtitle).toContain('Alice');

    // Verify sections and input widgets
    const widgets = card.sections[0].widgets;
    const textInputWidget = widgets.find((w: any) => w.textInput && w.textInput.name === 'confirmedHours');
    expect(textInputWidget).toBeDefined();

    const buttonWidget = widgets.find((w: any) => w.buttonList);
    expect(buttonWidget).toBeDefined();
    const button = (buttonWidget as any).buttonList.buttons[0];
    expect(button.onClick.action.parameters).toContainEqual({
      key: 'reconciliationRecordId',
      value: 'rec-123',
    });
  });

  it('buildGoogleChatCardPayload generates mismatch follow-up card with previous values', () => {
    const msg: OutboundMessage = {
      recipient: 'employee@company.local',
      subject: 'Action needed: hours mismatch for 2026-08',
      body: 'Difference detected between your submission and ERP.',
      template: 'MISMATCH_FOLLOWUP',
      context: {
        reconciliationRecordId: 'rec-456',
        employeeName: 'Bob',
        projectName: 'Project Orion',
        month: '2026-08',
        erpHours: 76,
        previousConfirmedHours: 60,
        previousDifference: 16,
        kind: 'MISMATCH_FOLLOWUP',
      },
    };

    const payload = buildGoogleChatCardPayload(msg);
    const card = payload.cardsV2[0].card;
    expect(card.header.title).toContain('Mismatch');

    const widgets = card.sections[0].widgets;
    const previousInfo = widgets.find(
      (w: any) => w.decoratedText && w.decoratedText.text.includes('60 hrs')
    );
    expect(previousInfo).toBeDefined();
  });

  it('buildGoogleChatCardPayload omits input widgets for escalation notice', () => {
    const msg: OutboundMessage = {
      recipient: 'hr-escalations@example.com',
      subject: 'Escalation Notice',
      body: 'Unresolved timesheet discrepancy.',
      template: 'ESCALATION_NOTICE',
      context: {
        reconciliationRecordId: 'rec-789',
        employeeName: 'Charlie',
        projectName: 'Project Apollo',
        month: '2026-08',
        erpHours: 76,
        kind: 'ESCALATION_NOTICE',
      },
    };

    const payload = buildGoogleChatCardPayload(msg);
    const widgets = payload.cardsV2[0].card.sections[0].widgets;
    const textInput = widgets.find((w: any) => w.textInput);
    expect(textInput).toBeUndefined();
  });

  it('buildMatchSuccessCard returns instant matching confirmation card', () => {
    const card = buildMatchSuccessCard({
      employeeName: 'Neha Rao',
      projectName: 'Apollo',
      month: '2026-08',
      confirmedHours: 76,
      erpHours: 76,
    });

    expect(card.actionResponse.type).toBe('UPDATE_MESSAGE');
    expect(card.cardsV2[0].card.header.title).toContain('Reconciled Successfully');
    const statusWidget = card.cardsV2[0].card.sections[0].widgets[0] as any;
    expect(statusWidget.decoratedText.text).toContain('MATCHED');
  });

  it('buildMismatchCard returns instant discrepancy flagged card with re-submit button', () => {
    const card = buildMismatchCard({
      recordId: 'rec-test',
      employeeName: 'Amit Shah',
      projectName: 'Apollo',
      month: '2026-08',
      confirmedHours: 60,
      erpHours: 76,
      difference: 16,
      explanation: 'Sick leave on Friday',
    });

    expect(card.actionResponse.type).toBe('UPDATE_MESSAGE');
    expect(card.cardsV2[0].card.header.title).toContain('Difference Flagged');
    const comparisonWidget = card.cardsV2[0].card.sections[0].widgets[1] as any;
    expect(comparisonWidget.decoratedText.text).toContain('60 hrs');
    expect(comparisonWidget.decoratedText.text).toContain('16 hrs');
  });

  it('buildPendingRequestsCard formats empty and non-empty lists appropriately', () => {
    const emptyCard = buildPendingRequestsCard('Dave', []);
    expect(emptyCard.cardsV2[0].card.header.title).toContain('All Caught Up');

    const activeCard = buildPendingRequestsCard('Dave', [
      { id: 'rec-1', projectName: 'Alpha', month: '2026-08', erpHours: 40, status: 'AWAITING_RESPONSE' },
      { id: 'rec-2', projectName: 'Beta', month: '2026-08', erpHours: 36, status: 'FLAGGED' },
    ]);
    expect(activeCard.cardsV2[0].card.sections.length).toBe(2);
  });

  it('buildHelpCard returns available commands', () => {
    const helpCard = buildHelpCard();
    expect(helpCard.cardsV2[0].card.header.title).toContain('Reconciliation Bot');
  });

  it('GoogleChatAdapter runs in mock mode when credentials are unset', async () => {
    delete process.env.GOOGLE_CHAT_WEBHOOK_URL;
    delete process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_KEY;

    const adapter = new GoogleChatAdapter();
    const result = await adapter.send({
      recipient: 'test@example.com',
      body: 'Test body',
      template: 'INITIAL_REQUEST',
    });

    expect(result.mocked).toBe(true);
  });

  it('getMessagingAdapter activates GoogleChatAdapter when MESSAGING_CHANNEL is google_chat', () => {
    process.env.MESSAGING_CHANNEL = 'google_chat';
    const adapter = getMessagingAdapter();
    expect(adapter.channel).toBe('GOOGLE_CHAT');
    expect(adapter).toBeInstanceOf(GoogleChatAdapter);
  });
});
