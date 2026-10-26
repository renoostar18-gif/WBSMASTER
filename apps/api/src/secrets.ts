import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Encrypts small secrets kept in the database (SSO client secrets) with AES-256-GCM and the
 * server's SECRET_KEY, so a copy of the database alone does not reveal them.
 */
export class Sealer {
  private readonly key: Buffer;
  constructor(secretKey: string) {
    this.key = createHash('sha256').update(secretKey).digest();
  }
  seal(text: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([c.update(text, 'utf8'), c.final()]);
    return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), body.toString('base64')].join('.');
  }
  open(sealed: string): string {
    const [v, iv, tag, body] = sealed.split('.');
    if (v !== 'v1' || !iv || !tag || !body) throw new Error('unreadable secret');
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8');
  }
}
