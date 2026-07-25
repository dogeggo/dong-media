export const LOGIN_RETURN_TO_COOKIE = 'dong_media_return_to';

const DEFAULT_REDIRECT = '/';
const MAX_REDIRECT_LENGTH = 2048;
const INTERNAL_ORIGIN = 'https://dong-media.invalid';
const PLAY_QUERY_KEYS = [
  'douban_id',
  'stype',
  'stitle',
  'source',
  'id',
  'index',
] as const;

type SearchParamsReader = Pick<URLSearchParams, 'get'>;

function redirectCandidates(value: string): string[] {
  const candidates = [value];

  try {
    const decoded = decodeURIComponent(value);
    if (decoded !== value) candidates.push(decoded);
  } catch {
    // Invalid percent encoding is rejected by the normal validation below.
  }

  return candidates;
}

/**
 * Only allow same-site, absolute-path redirects.
 *
 * This prevents login URLs such as `?redirect=https://example.com` or
 * `?redirect=//example.com` from becoming open redirects after authentication.
 */
export function sanitizeInternalRedirect(
  value: string | null | undefined,
): string {
  if (!value || value.length > MAX_REDIRECT_LENGTH) return DEFAULT_REDIRECT;
  if (/[\u0000-\u001f\u007f]/.test(value)) return DEFAULT_REDIRECT;

  for (const candidate of redirectCandidates(value.trim())) {
    if (!candidate.startsWith('/') || candidate.startsWith('//')) continue;
    if (candidate.includes('\\')) continue;

    try {
      const parsed = new URL(candidate, INTERNAL_ORIGIN);
      if (parsed.origin !== INTERNAL_ORIGIN) continue;

      const pathname = parsed.pathname;
      if (
        pathname.startsWith('/api') ||
        pathname.startsWith('/_next') ||
        pathname.startsWith('/login') ||
        pathname.startsWith('/register') ||
        pathname.startsWith('/oidc-register') ||
        pathname.startsWith('/warning')
      ) {
        return DEFAULT_REDIRECT;
      }

      return `${pathname}${parsed.search}${parsed.hash}`;
    } catch {
      // Try the next candidate, if any.
    }
  }

  return DEFAULT_REDIRECT;
}

/**
 * Normalizes legacy login links where some `/play` parameters accidentally
 * became top-level login parameters instead of remaining inside `redirect`.
 */
export function normalizeLoginRedirect(
  value: string | null | undefined,
  outerSearchParams?: SearchParamsReader,
): string {
  const safeRedirect = sanitizeInternalRedirect(value);
  if (!outerSearchParams || !safeRedirect.startsWith('/play?')) {
    return safeRedirect;
  }

  const parsed = new URL(safeRedirect, INTERNAL_ORIGIN);
  for (const key of PLAY_QUERY_KEYS) {
    const outerValue = outerSearchParams.get(key);
    if (outerValue && !parsed.searchParams.has(key)) {
      parsed.searchParams.set(key, outerValue);
    }
  }

  return sanitizeInternalRedirect(
    `${parsed.pathname}${parsed.search}${parsed.hash}`,
  );
}
