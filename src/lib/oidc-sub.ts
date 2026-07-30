export function createOidcSub(
  providerId: string,
  providerSubject: string | number,
): string {
  const normalizedProviderId = providerId.trim();
  const normalizedSubject = String(providerSubject);

  if (!normalizedProviderId || normalizedProviderId.includes(':')) {
    throw new Error('OIDC Provider ID 无效');
  }
  if (!normalizedSubject) {
    throw new Error('OIDC 用户标识无效');
  }

  return `${normalizedProviderId}:${normalizedSubject}`;
}

export function isNamespacedOidcSub(oidcSub: string): boolean {
  const separatorIndex = oidcSub.indexOf(':');
  return separatorIndex > 0 && separatorIndex < oidcSub.length - 1;
}

export function assertNamespacedOidcSub(oidcSub: string): string {
  if (!isNamespacedOidcSub(oidcSub)) {
    throw new Error('OIDC 用户标识必须包含 Provider 前缀');
  }
  return oidcSub;
}
