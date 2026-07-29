import assert from 'node:assert/strict';
import test from 'node:test';

import type { AdminConfig } from './admin.types.ts';
import { ensureTVBoxTokens, resolveTVBoxUser } from './tvbox-auth.ts';

function createConfig(): AdminConfig {
  return {
    ConfigSubscribtion: { URL: '', AutoUpdate: false, LastCheck: '' },
    ConfigFile: '',
    SiteConfig: {
      SiteName: 'Test',
      Announcement: '',
      SearchDownstreamMaxPage: 5,
      ShowAdultContent: false,
      FluidSearch: true,
    },
    UserConfig: {
      Users: [
        {
          username: 'owner',
          role: 'owner',
          banned: false,
        },
        {
          username: 'alice',
          role: 'user',
          banned: false,
          tvboxToken: 'alice-token',
        },
        {
          username: 'blocked',
          role: 'user',
          banned: true,
          tvboxToken: 'blocked-token',
        },
      ],
    },
    SourceConfig: [],
    CustomCategories: [],
    LiveConfig: [],
  };
}

test('resolves a personal token to its active user', () => {
  const user = resolveTVBoxUser(createConfig(), 'alice-token');

  assert.equal(user?.username, 'alice');
});

test('rejects unknown and banned user tokens', () => {
  const config = createConfig();

  assert.equal(resolveTVBoxUser(config, null), null);
  assert.equal(resolveTVBoxUser(config, 'unknown-token'), null);
  assert.equal(resolveTVBoxUser(config, 'blocked-token'), null);
});

test('assigns missing user tokens while preserving existing tokens', () => {
  const config = createConfig();
  const generatedTokens = ['owner-token'];

  assert.equal(
    ensureTVBoxTokens(config.UserConfig.Users, () => generatedTokens.shift()!),
    true,
  );
  assert.equal(config.UserConfig.Users[0].tvboxToken, 'owner-token');
  assert.equal(config.UserConfig.Users[1].tvboxToken, 'alice-token');
  assert.equal(
    ensureTVBoxTokens(config.UserConfig.Users, () => 'unused-token'),
    false,
  );
});
