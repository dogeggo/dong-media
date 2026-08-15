export interface HeroBannerCandidateIdentity {
  id: string | number;
  type?: string;
}

export function getHeroBannerCandidateKey(
  item: HeroBannerCandidateIdentity,
): string {
  return `${item.type || 'unknown'}:${item.id}`;
}

/**
 * 按分类中的原始顺序寻找下一条轮播候选项。
 *
 * 已经展示或已经确认使用竖图的条目会被跳过，避免同一条目占用多个轮播位，
 * 也避免在连续竖图之间来回切换。
 */
export function findNextHeroBannerCandidate<
  T extends HeroBannerCandidateIdentity,
>(
  currentItem: T,
  displayedItems: readonly T[],
  candidates: readonly T[],
  rejectedKeys: ReadonlySet<string>,
): T | undefined {
  const currentKey = getHeroBannerCandidateKey(currentItem);
  const currentCandidateIndex = candidates.findIndex(
    (candidate) => getHeroBannerCandidateKey(candidate) === currentKey,
  );
  const displayedKeys = new Set(displayedItems.map(getHeroBannerCandidateKey));

  for (
    let index = Math.max(currentCandidateIndex + 1, 0);
    index < candidates.length;
    index += 1
  ) {
    const candidate = candidates[index];
    const candidateKey = getHeroBannerCandidateKey(candidate);
    if (
      candidate.type === currentItem.type &&
      !displayedKeys.has(candidateKey) &&
      !rejectedKeys.has(candidateKey)
    ) {
      return candidate;
    }
  }

  return undefined;
}
