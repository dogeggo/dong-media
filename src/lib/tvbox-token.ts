import { randomBytes } from 'node:crypto';

const TOKEN_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function generateTVBoxToken(length = 32): string {
  if (!Number.isSafeInteger(length) || length < 1) {
    throw new TypeError('TVBox token length must be a positive integer');
  }

  let token = '';
  while (token.length < length) {
    const bytes = randomBytes(length - token.length);
    for (const byte of bytes) {
      // Ignore the uneven tail so every alphabet character has equal odds.
      if (byte >= 248) continue;
      token += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
      if (token.length === length) break;
    }
  }
  return token;
}
