import type { NextRequest } from 'next/server';

import type { AdminConfig } from '@/lib/admin.types';
import {
  type AuthRole,
  getAuthInfoFromCookie,
  isValidLocalStorageSession,
  isValidUserSession,
} from '@/lib/auth';
import { loadConfig } from '@/lib/config';

export interface RequestAuthContext {
  config: AdminConfig;
  username: string;
  role: AuthRole;
  via: 'session' | 'tvbox-token';
}

function getBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization');
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || null;
}

export async function authenticateRequest(
  request: NextRequest,
): Promise<RequestAuthContext | null> {
  const config = await loadConfig();
  const token =
    request.nextUrl.searchParams.get('token') || getBearerToken(request);

  if (token) {
    const user = config.UserConfig.Users.find(
      (candidate) => candidate.tvboxToken === token && !candidate.banned,
    );
    if (user) {
      return {
        config,
        username: user.username,
        role: user.role,
        via: 'tvbox-token',
      };
    }
  }

  const authInfo = getAuthInfoFromCookie(request);
  const secret = process.env.PASSWORD;
  if (!authInfo || !secret) return null;

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    if (!(await isValidLocalStorageSession(authInfo, secret))) return null;
    return {
      config,
      username: process.env.USERNAME || 'localstorage-owner',
      role: 'owner',
      via: 'session',
    };
  }

  if (!(await isValidUserSession(authInfo, secret)) || !authInfo.username) {
    return null;
  }
  if (authInfo.username === process.env.USERNAME) {
    return {
      config,
      username: authInfo.username,
      role: 'owner',
      via: 'session',
    };
  }

  const user = config.UserConfig.Users.find(
    (candidate) =>
      candidate.username === authInfo.username && !candidate.banned,
  );
  if (!user) return null;
  return {
    config,
    username: user.username,
    role: user.role,
    via: 'session',
  };
}
