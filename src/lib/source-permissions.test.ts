import assert from 'node:assert/strict';
import test from 'node:test';

import type { AdminConfig } from './admin.types.ts';
import {
  getAdultContentPreference,
  getAllowedSourceKeys,
  getEffectiveUserTags,
} from './source-permissions.ts';

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
      DefaultUserTags: ['default-a', 'default-b'],
    },
    UserConfig: {
      Users: [],
      Tags: [
        {
          name: 'default-a',
          enabledApis: ['source-a'],
          showAdultContent: false,
        },
        {
          name: 'default-b',
          enabledApis: ['source-b', 'source-a'],
          showAdultContent: true,
        },
        { name: 'explicit', enabledApis: ['source-c'] },
      ],
    },
    SourceConfig: [],
    CustomCategories: [],
    LiveConfig: [],
  };
}

test('explicit enabledApis override explicit and default user groups', () => {
  const config = createConfig();
  const user = {
    username: 'alice',
    role: 'user' as const,
    enabledApis: ['source-user'],
    tags: ['explicit'],
  };

  assert.deepEqual(getAllowedSourceKeys(config, user), ['source-user']);
});

test('explicit user groups provide the union of their sources', () => {
  const config = createConfig();
  const user = {
    username: 'alice',
    role: 'user' as const,
    tags: ['explicit', 'default-a'],
  };

  assert.deepEqual(getEffectiveUserTags(config, user), [
    'explicit',
    'default-a',
  ]);
  assert.deepEqual(getAllowedSourceKeys(config, user), [
    'source-c',
    'source-a',
  ]);
});

test('ungrouped regular users inherit default user group permissions', () => {
  const config = createConfig();
  const user = { username: 'alice', role: 'user' as const };

  assert.deepEqual(getEffectiveUserTags(config, user), [
    'default-a',
    'default-b',
  ]);
  assert.deepEqual(getAllowedSourceKeys(config, user), [
    'source-a',
    'source-b',
  ]);
  assert.equal(getAdultContentPreference(config, user), true);
});

test('ungrouped admins and owners are not restricted by default groups', () => {
  const config = createConfig();

  for (const role of ['admin', 'owner'] as const) {
    const user = { username: role, role };
    assert.deepEqual(getEffectiveUserTags(config, user), []);
    assert.equal(getAllowedSourceKeys(config, user), null);
    assert.equal(getAdultContentPreference(config, user), undefined);
  }
});

test('empty user groups preserve unrestricted source access', () => {
  const config = createConfig();
  config.UserConfig.Tags = [{ name: 'empty', enabledApis: [] }];
  const user = {
    username: 'alice',
    role: 'user' as const,
    tags: ['empty'],
  };

  assert.equal(getAllowedSourceKeys(config, user), null);
});
