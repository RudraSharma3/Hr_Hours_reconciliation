import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  GoogleChatAdapter,
  buildGoogleChatCardPayload,
  buildMatchSuccessCard,
  buildDiscrepancyQuestionCard,
  buildAwaitingHrConfirmationCard,
  buildPendingRequestsCard,
  buildHelpCard,
} from '../src/lib/adapters/messaging/googleChatAdapter';
import { getMessagingAdapter } from '../src/lib/adapters/messaging';
import type { OutboundMessage } from '../src/lib/adapters/messaging/types';

describe('GoogleChatAdapter & Cards v2 (Zero-Knowledge & Discrepancy Flow)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('buildGoogleChatCardPayload generates zero-knowledge blind question card (hiding erpHours)', () => {
    const msg: OutboundMessage = {
      recipient: 'alice@company.local',
      subject: 'Please confirm your hours for 2026-08',
      body: 'Please confirm your hours on Project Apollo.',
      template: 'INITIAL_REQUEST',
      context: {
        reconciliationRecordId: 'rec-123',
        employeeName: 'Alice',
        projectName: 'Project Apollo',
        month: '2026-08',
        erpHours: 160,
        kind: 'INITIAL_REQUEST',
      },
    };

    const payload = buildGoogleChatCardPayload(msg);
    expect(payload.cardsV2).toBeDefined();
    expect(payload.cardsV2.length).toBe(1);

    const card = payload.cardsV2[0].card;
    expect(card.header.title).toContain('2026-08');
    expect(card.header.subtitle).toContain('Alice');

    // Verify widgets
    const widgets = card.sections[0].widgets;
    const allText = JSON.stringify(widgets);

    // CRITICAL: Ensure erpHours (160) is NOT rendered anywhere in the blind card widgets
    expect(allText).not.toContain('160 hrs');
    expect(allText).not.toContain('ERP Timesheet Hours');

    // Verify input widget exists
    const textInputWidget = widgets.find((w: any) => w.textInput && w.textInput.name === 'confirmedHours');
    expect(textInputWidget).toBeDefined();

    // Verify action parameters
    const buttonWidget = widgets.find((w: any) => w.buttonList);
    expect(buttonWidget).toBeDefined();
    const button = (buttonWidget as any).buttonList.buttons[0];
    expect(button.onClick.action.function).toBe('submitHoursConfirmation');
    expect(button.onClick.action.parameters).toContainEqual({
      key: 'reconciliationRecordId',
      value: 'rec-123',
    });
  });

  it('buildGoogleChatCardPayload renders escalation details for HR escalation notices', () => {
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
        erpHours: 160,
        kind: 'ESCALATION_NOTICE',
      },
    };

    const payload = buildGoogleChatCardPayload(msg);
    const widgets = payload.cardsV2[0].card.sections[0].widgets;
    const textInput = widgets.find((w: any) => w.textInput);
    expect(textInput).toBeUndefined();

    const erpWidget = widgets.find((w: any) => w.decoratedText?.text?.includes('160 hrs'));
    expect(erpWidget).toBeDefined();
  });

  it('buildMatchSuccessCard returns instant matching confirmation card', () => {
    const card = buildMatchSuccessCard({
      employeeName: 'Neha Rao',
      projectName: 'Apollo',
      month: '2026-08',
      confirmedHours: 160,
    });

    expect(card.cardsV2[0].card.header.title).toContain('Verified & Reconciled');
    const statusWidget = card.cardsV2[0].card.sections[0].widgets[0] as any;
    expect(statusWidget.decoratedText.text).toContain('MATCHED');
    const hoursWidget = card.cardsV2[0].card.sections[0].widgets[1] as any;
    expect(hoursWidget.decoratedText.text).toContain('160 hrs');
  });

  it('buildDiscrepancyQuestionCard returns follow-up card asking for reason / justification', () => {
    const card = buildDiscrepancyQuestionCard({
      recordId: 'rec-test',
      employeeName: 'Amit Shah',
      projectName: 'Apollo',
      month: '2026-08',
      confirmedHours: 140,
    });

    expect(card.cardsV2[0].card.header.title).toContain('Hours Do Not Match');
    const statusWidget = card.cardsV2[0].card.sections[0].widgets[0] as any;
    expect(statusWidget.decoratedText.text).toContain('DISCREPANCY FLAGGED');

    // Input for employee justification
    const explanationInput = card.cardsV2[0].card.sections[0].widgets.find(
      (w: any) => w.textInput && w.textInput.name === 'employeeExplanation'
    ) as any;
    expect(explanationInput).toBeDefined();

    // Button to submit justification
    const button = (card.cardsV2[0].card.sections[0].widgets.find((w: any) => w.buttonList) as any)
      .buttonList.buttons[0];
    expect(button.onClick.action.function).toBe('submitHoursExplanation');
    expect(button.onClick.action.parameters).toContainEqual({
      key: 'reconciliationRecordId',
      value: 'rec-test',
    });
  });

  it('buildAwaitingHrConfirmationCard returns confirmation that explanation was submitted for HR review', () => {
    const card = buildAwaitingHrConfirmationCard({
      employeeName: 'Amit Shah',
      projectName: 'Apollo',
      month: '2026-08',
      confirmedHours: 140,
      explanation: 'Overtime hours moved to next sprint',
    });

    expect(card.cardsV2[0].card.header.title).toContain('Awaiting HR Confirmation');
    const justificationWidget = card.cardsV2[0].card.sections[0].widgets[2] as any;
    expect(justificationWidget.decoratedText.text).toContain('Overtime hours moved to next sprint');
  });

  it('buildPendingRequestsCard formats blind question cards for all pending projects', () => {
    const emptyCard = buildPendingRequestsCard('Dave', []);
    expect(emptyCard.cardsV2[0].card.header.title).toContain('All Caught Up');

    const activeCard = buildPendingRequestsCard('Dave', [
      { id: 'rec-1', projectName: 'Alpha', month: '2026-08', status: 'AWAITING_RESPONSE' },
      { id: 'rec-2', projectName: 'Beta', month: '2026-08', status: 'FLAGGED' },
    ]);
    expect(activeCard.cardsV2.length).toBe(1);
    expect(activeCard.cardsV2[0].card.sections.length).toBe(2);
    // Ensure no ERP hours are leaked in pending card
    expect(JSON.stringify(activeCard)).not.toContain('ERP Hours');
  });

  it('buildHelpCard returns available instructions', () => {
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

  it('buildPendingRequestsCard generates valid action parameters for each section', () => {
    const card = buildPendingRequestsCard('Dave', [
      { id: 'rec-xyz-123', projectName: 'Alpha', month: '2026-08', status: 'AWAITING_RESPONSE' },
    ]);
    const button = (card.cardsV2[0].card.sections[0].widgets.find((w: any) => w.buttonList) as any)
      .buttonList.buttons[0];
    expect(button.onClick.action.function).toBe('submitHoursConfirmation');
    expect(button.onClick.action.parameters).toEqual([
      { key: 'reconciliationRecordId', value: 'rec-xyz-123' },
      { key: 'inputFieldName', value: 'hours_recxyz123' },
    ]);
  });

  it('getMessagingAdapter activates GoogleChatAdapter when MESSAGING_CHANNEL is google_chat', () => {
    process.env.MESSAGING_CHANNEL = 'google_chat';
    const adapter = getMessagingAdapter();
    expect(adapter.channel).toBe('GOOGLE_CHAT');
    expect(adapter).toBeInstanceOf(GoogleChatAdapter);
  });
});
