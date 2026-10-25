import nodemailer from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Sends email. SMTP in production (any KSA-hosted or international provider); a log in development and tests. */
export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

/** Keeps messages in memory (tests read `sent`) and prints a one-line note. */
export class LogMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  constructor(private readonly quiet = false) {}
  async send(msg: MailMessage) {
    this.sent.push(msg);
    if (!this.quiet) console.log(`[mail] to ${msg.to}: ${msg.subject}`);
  }
}

export class SmtpMailer implements Mailer {
  private transport;
  constructor(url: string, private readonly from: string) {
    this.transport = nodemailer.createTransport(url);
  }
  async send(msg: MailMessage) {
    await this.transport.sendMail({ from: this.from, ...msg });
  }
}

export function createMailer(smtpUrl: string | null, from: string): Mailer {
  return smtpUrl ? new SmtpMailer(smtpUrl, from) : new LogMailer();
}
