#!/usr/bin/env node

const { createClient } = require('redis');

const LEGACY_SHORT_ID_MAX_LENGTH = 10;
const BACKUP_TTL_SECONDS = 30 * 24 * 60 * 60;
const CACHE_ENVIRONMENT = (process.env.CACHE_ENVIRONMENT || 'production')
  .toLowerCase()
  .replace(/[^a-z0-9_-]/g, '-');
const CONFIG_GENERATION_KEYS = [
  `dm:gen:${CACHE_ENVIRONMENT}:config.server`,
  `dm:gen:${CACHE_ENVIRONMENT}:config.public`,
];

function targetOidcSub(legacySub) {
  if (!/^\d+$/.test(legacySub)) {
    throw new Error(`无法迁移非数字旧 OIDC ID: ${legacySub}`);
  }
  const provider =
    legacySub.length <= LEGACY_SHORT_ID_MAX_LENGTH ? 'linuxdo' : 'google';
  return `${provider}:${legacySub}`;
}

function storedBinding(record) {
  return Object.prototype.hasOwnProperty.call(record, 'oidcSub')
    ? { exists: true, value: record.oidcSub }
    : { exists: false };
}

async function scanKeys(client, pattern) {
  const keys = [];
  for await (const page of client.scanIterator({
    MATCH: pattern,
    COUNT: 500,
  })) {
    const pageKeys = Array.isArray(page) ? page : [page];
    keys.push(...pageKeys.map(String));
  }
  return keys;
}

async function createMigrationPlan(client) {
  const adminConfigRaw = await client.get('admin:config');
  if (!adminConfigRaw) throw new Error('admin:config 不存在');

  const adminConfig = JSON.parse(adminConfigRaw);
  const configUsers = adminConfig.UserConfig?.Users;
  if (!Array.isArray(configUsers)) {
    throw new Error('admin:config.UserConfig.Users 无效');
  }

  const records = [];
  const canonicalConfigUpdates = [];
  const plannedSourceKeys = new Set();
  const userInfoKeys = await scanKeys(client, 'u:*:info');
  for (const userKey of userInfoKeys) {
    const legacySub = await client.hGet(userKey, 'oidcSub');
    if (!legacySub) continue;

    const username = userKey.slice(2, -5);
    if (legacySub.includes(':')) {
      const configUser = configUsers.find((user) => user.username === username);
      if (configUser && configUser.oidcSub !== legacySub) {
        canonicalConfigUpdates.push({ username, targetSub: legacySub });
      }
      continue;
    }

    const targetSub = targetOidcSub(legacySub);
    const sourceKey = `oidc:sub:${legacySub}`;
    const targetKey = `oidc:sub:${targetSub}`;
    const sourceOwner = await client.get(sourceKey);
    const targetOwner = await client.get(targetKey);

    records.push({
      username,
      userKey,
      legacySub,
      targetSub,
      sourceKey,
      targetKey,
      sourceOwner,
      targetOwner,
    });
    plannedSourceKeys.add(sourceKey);
  }

  const oidcMappingKeys = await scanKeys(client, 'oidc:sub:*');
  for (const sourceKey of oidcMappingKeys) {
    const legacySub = sourceKey.slice('oidc:sub:'.length);
    if (legacySub.includes(':') || plannedSourceKeys.has(sourceKey)) continue;

    const sourceOwner = await client.get(sourceKey);
    if (!sourceOwner) continue;
    const targetSub = targetOidcSub(legacySub);
    const targetKey = `oidc:sub:${targetSub}`;
    records.push({
      username: sourceOwner,
      userKey: null,
      legacySub,
      targetSub,
      sourceKey,
      targetKey,
      sourceOwner,
      targetOwner: await client.get(targetKey),
    });
  }

  const uniqueTargets = new Set(records.map((record) => record.targetSub));
  if (uniqueTargets.size !== records.length) {
    throw new Error('旧 OIDC 数据中存在重复目标，无法安全迁移');
  }

  const displacedUsernames = [
    ...new Set(
      records
        .filter(
          (record) =>
            record.targetOwner && record.targetOwner !== record.username,
        )
        .map((record) => record.targetOwner),
    ),
  ];
  const affectedUsernames = [
    ...new Set([
      ...records.map((record) => record.username),
      ...displacedUsernames,
      ...canonicalConfigUpdates.map((update) => update.username),
    ]),
  ];

  const userBindings = [];
  const configBindings = [];
  for (const username of affectedUsernames) {
    const userKey = `u:${username}:info`;
    const userInfo = await client.hGetAll(userKey);
    userBindings.push({
      username,
      userKey,
      binding: storedBinding(userInfo),
    });

    const configUser = configUsers.find((user) => user.username === username);
    if (configUser) {
      configBindings.push({
        username,
        binding: storedBinding(configUser),
      });
    }
  }

  return {
    adminConfig,
    records,
    canonicalConfigUpdates,
    displacedUsernames,
    userBindings,
    configBindings,
  };
}

function migrationSummary(plan) {
  const conflicts = plan.records
    .filter(
      (record) => record.targetOwner && record.targetOwner !== record.username,
    )
    .map((record) => ({
      targetSub: record.targetSub,
      previousOwner: record.targetOwner,
      migratedOwner: record.username,
    }));

  return {
    total: plan.records.length,
    linuxdo: plan.records.filter((record) =>
      record.targetSub.startsWith('linuxdo:'),
    ).length,
    google: plan.records.filter((record) =>
      record.targetSub.startsWith('google:'),
    ).length,
    mappingOnly: plan.records.filter((record) => !record.userKey).length,
    configUpdates: plan.canonicalConfigUpdates.length,
    conflicts,
  };
}

async function applyMigration(client, plan) {
  if (plan.records.length === 0 && plan.canonicalConfigUpdates.length === 0) {
    return { backupKey: null, ...migrationSummary(plan) };
  }

  const createdAt = new Date().toISOString();
  const backupKey = `backup:oidc-migration:${createdAt.replaceAll(':', '-')}`;
  const backup = {
    version: 1,
    createdAt,
    shortIdMaxLength: LEGACY_SHORT_ID_MAX_LENGTH,
    records: plan.records,
    userBindings: plan.userBindings,
    configBindings: plan.configBindings,
  };
  await client.setEx(backupKey, BACKUP_TTL_SECONDS, JSON.stringify(backup));

  const nextAdminConfig = structuredClone(plan.adminConfig);
  const configUsers = nextAdminConfig.UserConfig.Users;
  const displacedTargets = new Map(
    plan.records
      .filter(
        (record) =>
          record.targetOwner && record.targetOwner !== record.username,
      )
      .map((record) => [record.targetOwner, record.targetSub]),
  );

  for (const configUser of configUsers) {
    const displacedTarget = displacedTargets.get(configUser.username);
    if (displacedTarget && configUser.oidcSub === displacedTarget) {
      delete configUser.oidcSub;
    }
  }
  for (const record of plan.records) {
    const configUser = configUsers.find(
      (user) => user.username === record.username,
    );
    if (!configUser && record.userKey) {
      throw new Error(`admin:config 中缺少用户 ${record.username}`);
    }
    if (configUser) configUser.oidcSub = record.targetSub;
  }
  for (const update of plan.canonicalConfigUpdates) {
    const configUser = configUsers.find(
      (user) => user.username === update.username,
    );
    if (configUser) configUser.oidcSub = update.targetSub;
  }

  const transaction = client.multi();
  for (const record of plan.records) {
    if (record.targetOwner && record.targetOwner !== record.username) {
      transaction.hDel(`u:${record.targetOwner}:info`, 'oidcSub');
    }
  }
  for (const record of plan.records) {
    if (record.userKey) {
      transaction.hSet(record.userKey, 'oidcSub', record.targetSub);
    }
    transaction.set(record.targetKey, record.username);
    transaction.del(record.sourceKey);
  }
  transaction.set('admin:config', JSON.stringify(nextAdminConfig));
  for (const generationKey of CONFIG_GENERATION_KEYS) {
    const currentGeneration = Number(await client.get(generationKey));
    transaction.set(
      generationKey,
      String(
        Number.isSafeInteger(currentGeneration) && currentGeneration > 0
          ? currentGeneration + 1
          : 2,
      ),
    );
  }
  await transaction.exec();

  return { backupKey, ...migrationSummary(plan) };
}

async function rollbackMigration(client, backupKey) {
  const backupRaw = await client.get(backupKey);
  if (!backupRaw) throw new Error(`迁移快照不存在或已过期: ${backupKey}`);
  const backup = JSON.parse(backupRaw);

  const adminConfigRaw = await client.get('admin:config');
  if (!adminConfigRaw) throw new Error('admin:config 不存在');
  const adminConfig = JSON.parse(adminConfigRaw);
  const configUsers = adminConfig.UserConfig?.Users;
  if (!Array.isArray(configUsers)) {
    throw new Error('admin:config.UserConfig.Users 无效');
  }

  for (const saved of backup.configBindings) {
    const configUser = configUsers.find(
      (user) => user.username === saved.username,
    );
    if (!configUser) continue;
    if (saved.binding.exists) configUser.oidcSub = saved.binding.value;
    else delete configUser.oidcSub;
  }

  const transaction = client.multi();
  for (const saved of backup.userBindings) {
    if (saved.binding.exists) {
      transaction.hSet(saved.userKey, 'oidcSub', saved.binding.value);
    } else {
      transaction.hDel(saved.userKey, 'oidcSub');
    }
  }
  for (const record of backup.records) {
    if (record.sourceOwner)
      transaction.set(record.sourceKey, record.sourceOwner);
    else transaction.del(record.sourceKey);
    if (record.targetOwner)
      transaction.set(record.targetKey, record.targetOwner);
    else transaction.del(record.targetKey);
  }
  transaction.set('admin:config', JSON.stringify(adminConfig));
  for (const generationKey of CONFIG_GENERATION_KEYS) {
    const currentGeneration = Number(await client.get(generationKey));
    transaction.set(
      generationKey,
      String(
        Number.isSafeInteger(currentGeneration) && currentGeneration > 0
          ? currentGeneration + 1
          : 2,
      ),
    );
  }
  await transaction.exec();

  return { rolledBack: backupKey, records: backup.records.length };
}

async function main() {
  if (!process.env.REDIS_URL) throw new Error('REDIS_URL 未配置');

  const client = createClient({ url: process.env.REDIS_URL });
  client.on('error', () => {});
  await client.connect();

  try {
    const rollbackArgument = process.argv.find((argument) =>
      argument.startsWith('--rollback='),
    );
    if (rollbackArgument) {
      const backupKey = rollbackArgument.slice('--rollback='.length);
      console.log(
        JSON.stringify(await rollbackMigration(client, backupKey), null, 2),
      );
      return;
    }

    const plan = await createMigrationPlan(client);
    if (!process.argv.includes('--apply')) {
      console.log(
        JSON.stringify(
          {
            dryRun: true,
            shortIdMaxLength: LEGACY_SHORT_ID_MAX_LENGTH,
            ...migrationSummary(plan),
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log(JSON.stringify(await applyMigration(client, plan), null, 2));
  } finally {
    await client.quit();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
