import type { AdminConfig } from './admin.types';
import { generateTVBoxToken } from './tvbox-token.ts';

type TVBoxUser = AdminConfig['UserConfig']['Users'][number];

export function resolveTVBoxUser(
  config: AdminConfig,
  token: string | null,
): TVBoxUser | null {
  if (!token) return null;

  return (
    config.UserConfig.Users.find(
      (candidate) => candidate.tvboxToken === token && !candidate.banned,
    ) || null
  );
}

export function ensureTVBoxTokens(
  users: TVBoxUser[],
  createToken: () => string = generateTVBoxToken,
): boolean {
  const assignedTokens = new Set(
    users.map((user) => user.tvboxToken).filter(Boolean),
  );
  let changed = false;

  for (const user of users) {
    if (user.tvboxToken) continue;

    let token: string;
    do {
      token = createToken();
    } while (!token || assignedTokens.has(token));

    user.tvboxToken = token;
    assignedTokens.add(token);
    changed = true;
  }

  return changed;
}
