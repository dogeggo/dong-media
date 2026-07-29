import type { AdminConfig } from './admin.types.ts';

type UserConfig = AdminConfig['UserConfig']['Users'][number];

/**
 * 返回用户实际生效的用户组。
 *
 * 普通用户未显式分组时继承默认用户组；管理员和站长不会因为默认用户组
 * 被意外限制，但仍可通过显式 tags 使用用户组权限。
 */
export function getEffectiveUserTags(
  config: AdminConfig,
  user: UserConfig,
): string[] {
  if (user.tags?.length) {
    return [...new Set(user.tags)];
  }

  if (user.role === 'user' && config.SiteConfig.DefaultUserTags?.length) {
    return [...new Set(config.SiteConfig.DefaultUserTags)];
  }

  return [];
}

/**
 * 返回账号允许访问的源 key。null 表示未设置源限制。
 *
 * 权限优先级与站内账号一致：用户 enabledApis > 有效用户组 > 不限制。
 * 用户组中没有配置任何源时沿用原有语义，视为不限制。
 */
export function getAllowedSourceKeys(
  config: AdminConfig,
  user: UserConfig,
): string[] | null {
  if (user.enabledApis?.length) {
    return [...new Set(user.enabledApis)];
  }

  const effectiveTags = getEffectiveUserTags(config, user);
  if (!effectiveTags.length || !config.UserConfig.Tags?.length) {
    return null;
  }

  const allowedKeys = new Set<string>();
  for (const tagName of effectiveTags) {
    const tag = config.UserConfig.Tags.find(
      (candidate) => candidate.name === tagName,
    );
    tag?.enabledApis?.forEach((key) => allowedKeys.add(key));
  }

  return allowedKeys.size ? [...allowedKeys] : null;
}

/** 返回用户组对成人内容的显式覆盖；undefined 表示沿用站点级设置。 */
export function getAdultContentPreference(
  config: AdminConfig,
  user: UserConfig,
): boolean | undefined {
  const effectiveTags = getEffectiveUserTags(config, user);
  if (!effectiveTags.length || !config.UserConfig.Tags?.length) {
    return undefined;
  }

  const preferences = effectiveTags
    .map((tagName) =>
      config.UserConfig.Tags?.find((candidate) => candidate.name === tagName),
    )
    .map((tag) => tag?.showAdultContent)
    .filter((value): value is boolean => value !== undefined);

  if (preferences.includes(true)) return true;
  if (preferences.includes(false)) return false;
  return undefined;
}
