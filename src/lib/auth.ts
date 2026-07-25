import type { NextRequest } from 'next/server';

export type AuthRole = 'owner' | 'admin' | 'user';

export interface AuthInfo {
  username?: string;
  signature?: string;
  timestamp?: number;
  loginTime?: number;
  role?: AuthRole;
}

const LOCAL_STORAGE_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_CLOCK_SKEW_MS = 5 * 60 * 1000;

function isAuthRole(value: unknown): value is AuthRole {
  return value === 'owner' || value === 'admin' || value === 'user';
}

function normalizeAuthInfo(parsed: unknown): AuthInfo | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const data = parsed as Record<string, unknown>;
  return {
    ...(typeof data.username === 'string' ? { username: data.username } : {}),
    ...(typeof data.signature === 'string'
      ? { signature: data.signature }
      : {}),
    ...(typeof data.timestamp === 'number'
      ? { timestamp: data.timestamp }
      : {}),
    ...(typeof data.loginTime === 'number'
      ? { loginTime: data.loginTime }
      : {}),
    ...(isAuthRole(data.role) ? { role: data.role } : {}),
  };
}

function parseAuthInfo(cookieValue: string): AuthInfo | null {
  let candidate = cookieValue;

  // NextResponse may encode an already encoded cookie value. Try the raw,
  // once-decoded and twice-decoded forms so server and browser parsing agree.
  for (let decodeCount = 0; decodeCount <= 2; decodeCount += 1) {
    try {
      return normalizeAuthInfo(JSON.parse(candidate));
    } catch (_error) {
      // Decode one layer and try JSON parsing again.
    }

    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) return null;
      candidate = decoded;
    } catch (_error) {
      return null;
    }
  }

  return null;
}

export function localStorageSessionPayload(
  role: AuthRole,
  timestamp: number,
): string {
  return `localstorage:${role}:${timestamp}`;
}

export async function generateHmacSignature(
  data: string,
  secret: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyHmacSignature(
  data: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (!/^[a-f\d]{64}$/i.test(signature)) return false;

  const encoder = new TextEncoder();
  const signatureBytes = new Uint8Array(
    signature.match(/.{2}/g)?.map((byte) => parseInt(byte, 16)) || [],
  );

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    return await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      encoder.encode(data),
    );
  } catch (_error) {
    return false;
  }
}

export async function isValidLocalStorageSession(
  authInfo: AuthInfo,
  secret: string,
  now = Date.now(),
): Promise<boolean> {
  const { role, signature, timestamp } = authInfo;
  if (
    !role ||
    !signature ||
    !timestamp ||
    !Number.isSafeInteger(timestamp) ||
    timestamp <= 0
  ) {
    return false;
  }

  const sessionAge = now - timestamp;
  if (
    sessionAge < -SESSION_CLOCK_SKEW_MS ||
    sessionAge > LOCAL_STORAGE_SESSION_MAX_AGE_MS + SESSION_CLOCK_SKEW_MS
  ) {
    return false;
  }

  return verifyHmacSignature(
    localStorageSessionPayload(role, timestamp),
    signature,
    secret,
  );
}

// 从cookie获取认证信息 (服务端使用)
export function getAuthInfoFromCookie(request: NextRequest): AuthInfo | null {
  const authCookie = request.cookies.get('user_auth');

  if (!authCookie) {
    return null;
  }

  return parseAuthInfo(authCookie.value);
}

// 从cookie获取认证信息 (客户端使用)
export function getAuthInfoFromBrowserCookie(): AuthInfo | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    // 解析 document.cookie
    const cookies = document.cookie.split(';').reduce(
      (acc, cookie) => {
        const trimmed = cookie.trim();
        const firstEqualIndex = trimmed.indexOf('=');

        if (firstEqualIndex > 0) {
          const key = trimmed.substring(0, firstEqualIndex);
          const value = trimmed.substring(firstEqualIndex + 1);
          if (key && value) {
            acc[key] = value;
          }
        }

        return acc;
      },
      {} as Record<string, string>,
    );

    const authCookie = cookies['user_auth'];
    if (!authCookie) {
      return null;
    }

    return parseAuthInfo(authCookie);
  } catch (_error) {
    return null;
  }
}
