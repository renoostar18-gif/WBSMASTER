import { timingSafeEqual } from 'node:crypto';

/**
 * Moyasar, the Saudi payment gateway (mada, Visa, Mastercard, Apple Pay), through its hosted invoice
 * page: we create an invoice, send the customer to its `url`, and only trust what GET /invoices/:id says.
 *
 * Everything that depends on Moyasar's API is in this file. Checked against docs.moyasar.com:
 * POST /v1/invoices with `amount` (halalas, at least 100), `currency`, `description`; HTTP basic auth
 * with the secret key as the user name and no password. To confirm with test keys before going live:
 * the names `url`, `success_url`, `back_url`, `callback_url`, `expired_at`, `metadata`, the status
 * values below, PUT /invoices/:id/cancel, and the webhook body (`secret_token`, `data.invoice_id`).
 */
export interface MoyasarInvoice {
  id: string;
  /** initiated, paid, failed, refunded, canceled, on_hold, expired */
  status: string;
  amount: number;
  currency: string;
  url: string;
  metadata?: Record<string, string> | null;
}

export interface NewMoyasarInvoice {
  amount: number;
  currency: 'SAR';
  description: string;
  /** Moyasar POSTs here when the invoice is paid. */
  callbackUrl: string;
  /** Where the customer goes after paying, and the page's "back" link. */
  successUrl: string;
  backUrl: string;
  expiredAt: Date;
  metadata: Record<string, string>;
}

export class MoyasarError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface PaymentGateway {
  createInvoice(inv: NewMoyasarInvoice): Promise<MoyasarInvoice>;
  getInvoice(id: string): Promise<MoyasarInvoice>;
  cancelInvoice(id: string): Promise<void>;
}

export class Moyasar implements PaymentGateway {
  private readonly auth: string;
  constructor(secretKey: string, private readonly apiUrl = 'https://api.moyasar.com/v1', private readonly fetchFn: typeof fetch = fetch) {
    this.auth = `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`;
  }

  async createInvoice(inv: NewMoyasarInvoice): Promise<MoyasarInvoice> {
    return this.call('POST', '/invoices', {
      amount: inv.amount, currency: inv.currency, description: inv.description,
      callback_url: inv.callbackUrl, success_url: inv.successUrl, back_url: inv.backUrl,
      expired_at: inv.expiredAt.toISOString(), metadata: inv.metadata,
    });
  }

  async getInvoice(id: string): Promise<MoyasarInvoice> {
    return this.call('GET', `/invoices/${encodeURIComponent(id)}`);
  }

  async cancelInvoice(id: string): Promise<void> {
    await this.call('PUT', `/invoices/${encodeURIComponent(id)}/cancel`);
  }

  private async call(method: string, path: string, body?: unknown): Promise<MoyasarInvoice> {
    const res = await this.fetchFn(`${this.apiUrl}${path}`, {
      method,
      headers: { authorization: this.auth, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) throw new MoyasarError(res.status, `Moyasar ${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
    return JSON.parse(text) as MoyasarInvoice;
  }
}

/** Moyasar ids a notification mentions: a webhook's payment (`data.invoice_id`), or an invoice callback (`id`). */
export function invoiceIdsIn(body: unknown): string[] {
  const b = (body ?? {}) as Record<string, unknown>;
  const data = (b.data ?? {}) as Record<string, unknown>;
  return [data.invoice_id, b.invoice_id, b.id, data.id].filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 100);
}

/** The webhook's shared secret, compared in constant time. */
export function secretMatches(body: unknown, expected: string): boolean {
  const got = (body as { secret_token?: unknown } | null)?.secret_token;
  if (typeof got !== 'string') return false;
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
