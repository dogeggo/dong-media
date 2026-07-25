import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

function sessionKey(secret: string, purpose: string) {
  return createHash('sha256')
    .update(`dong-media:${purpose}:`)
    .update(secret)
    .digest();
}

export function sealSession(
  value: unknown,
  purpose: string,
  secret: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sessionKey(secret, purpose), iv);
  cipher.setAAD(Buffer.from(purpose));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, encrypted, tag]
    .map((part) => part.toString('base64url'))
    .join('.');
}

export function unsealSession<T>(
  token: string,
  purpose: string,
  secret: string,
): T | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [iv, encrypted, tag] = parts.map((part) =>
      Buffer.from(part, 'base64url'),
    );
    if (iv.length !== 12 || tag.length !== 16) return null;

    const decipher = createDecipheriv(
      'aes-256-gcm',
      sessionKey(secret, purpose),
      iv,
    );
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(plaintext) as T;
  } catch {
    return null;
  }
}
