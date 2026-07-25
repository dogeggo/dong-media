export interface AdFilterSourceRule {
  source: string;
  keywords: string[];
  durations: number[];
}

export interface AdFilterConfig {
  enabled: boolean;
  version: number;
  globalKeywords: string[];
  removeCueBlocks: boolean;
  removeDiscontinuity: boolean;
  sourceRules: AdFilterSourceRule[];
}

export const DEFAULT_AD_FILTER_CONFIG: AdFilterConfig = {
  enabled: true,
  version: 1,
  globalKeywords: [
    'sponsor',
    '/ad/',
    '/ads/',
    'advert',
    'advertisement',
    '/adjump',
    'redtraffic',
  ],
  removeCueBlocks: true,
  removeDiscontinuity: true,
  sourceRules: [],
};

function uniqueStrings(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0 && item.length <= 200),
    ),
  ).slice(0, maxItems);
}

function safeDurations(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter(
          (item): item is number =>
            typeof item === 'number' &&
            Number.isFinite(item) &&
            item > 0 &&
            item < 3600,
        )
        .map((item) => Number(item.toFixed(3))),
    ),
  ).slice(0, 100);
}

export function normalizeAdFilterConfig(value: unknown): AdFilterConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_AD_FILTER_CONFIG };
  }
  const input = value as Record<string, unknown>;
  const sourceRules = Array.isArray(input.sourceRules)
    ? input.sourceRules
        .filter(
          (rule): rule is Record<string, unknown> =>
            !!rule && typeof rule === 'object' && !Array.isArray(rule),
        )
        .map((rule) => ({
          source: typeof rule.source === 'string' ? rule.source.trim() : '',
          keywords: uniqueStrings(rule.keywords, 100),
          durations: safeDurations(rule.durations),
        }))
        .filter((rule) => rule.source.length > 0 && rule.source.length <= 100)
        .slice(0, 100)
    : [];

  return {
    enabled: input.enabled !== false,
    version:
      typeof input.version === 'number' &&
      Number.isSafeInteger(input.version) &&
      input.version > 0
        ? input.version
        : 1,
    globalKeywords:
      input.globalKeywords === undefined
        ? [...DEFAULT_AD_FILTER_CONFIG.globalKeywords]
        : uniqueStrings(input.globalKeywords, 200),
    removeCueBlocks: input.removeCueBlocks !== false,
    removeDiscontinuity: input.removeDiscontinuity !== false,
    sourceRules,
  };
}

function parseExtInfDuration(line: string): number | null {
  const match = line.match(/^#EXTINF:([\d.]+)/i);
  if (!match) return null;
  const duration = Number(match[1]);
  return Number.isFinite(duration) ? duration : null;
}

export function filterM3u8Ads(
  source: string,
  content: string,
  rawConfig: unknown,
) {
  if (!content) return '';
  const config = normalizeAdFilterConfig(rawConfig);
  if (!config.enabled) return content;

  const sourceRule = config.sourceRules.find((rule) => rule.source === source);
  const keywords = [
    ...config.globalKeywords,
    ...(sourceRule?.keywords || []),
  ].map((keyword) => keyword.toLowerCase());
  const durations = sourceRule?.durations || [];
  const lines = content.split('\n');
  const filtered: string[] = [];
  let insideCueBlock = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalized = line.trim().toUpperCase();

    if (config.removeCueBlocks && normalized.startsWith('#EXT-X-CUE-OUT')) {
      insideCueBlock = true;
      continue;
    }
    if (config.removeCueBlocks && normalized.startsWith('#EXT-X-CUE-IN')) {
      insideCueBlock = false;
      continue;
    }
    if (insideCueBlock) continue;
    if (
      config.removeDiscontinuity &&
      normalized.startsWith('#EXT-X-DISCONTINUITY')
    ) {
      continue;
    }

    if (normalized.startsWith('#EXTINF:') && index + 1 < lines.length) {
      const mediaUrl = lines[index + 1];
      const lowerMediaUrl = mediaUrl.toLowerCase();
      const duration = parseExtInfDuration(line);
      const keywordMatch = keywords.some((keyword) =>
        lowerMediaUrl.includes(keyword),
      );
      const durationMatch =
        duration !== null &&
        durations.some((candidate) => Math.abs(candidate - duration) < 0.01);
      if (keywordMatch || durationMatch) {
        index += 1;
        continue;
      }
    }

    filtered.push(line);
  }

  return filtered.join('\n');
}
