import nodemailer from 'nodemailer';
import type { MessagingAdapter, OutboundMessage, SendResult } from './types';

/**
 * Email messaging adapter.
 *
 * Mode is controlled by EMAIL_MODE:
 *  - "mock" (default, no credentials required): nothing is actually sent.
 *    The message is printed to the server console and always saved to
 *    MessageLog by the caller. Use this for local development and demos.
 *  - "smtp": sends real email via nodemailer using SMTP_HOST/PORT/USER/PASSWORD.
 *
 * See .env.example for the exact variables.
 */
export class EmailAdapter implements MessagingAdapter {
  readonly channel = 'EMAIL';

  private mode: 'mock' | 'smtp';

  constructor() {
    this.mode = (process.env.EMAIL_MODE === 'smtp' ? 'smtp' : 'mock');
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    if (this.mode === 'mock') {
      // eslint-disable-next-line no-console
      console.log(
        `\n[MOCK EMAIL] To: ${message.recipient}\nSubject: ${message.subject ?? '(none)'}\n---\n${message.body}\n---\n`
      );
      return { mocked: true };
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
    });

    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM ?? 'HR Reconciliation <hr@example.com>',
      to: message.recipient,
      subject: message.subject,
      text: message.body,
    });

    return { mocked: false, providerMessageId: info.messageId };
  }
}
