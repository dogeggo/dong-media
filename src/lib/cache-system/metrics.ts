import type { CacheNamespaceStats, CacheStatus } from './types.ts';

type MetricCounters = Omit<CacheNamespaceStats, 'namespace'>;

function emptyCounters(): MetricCounters {
  return {
    entries: 0,
    estimatedBytes: 0,
    hits: 0,
    misses: 0,
    staleHits: 0,
    errors: 0,
    writes: 0,
    rejectedWrites: 0,
    coalescedLoads: 0,
  };
}

export class CacheMetrics {
  private readonly counters = new Map<string, MetricCounters>();

  recordRead(namespace: string, status: CacheStatus): void {
    const counters = this.forNamespace(namespace);
    if (status === 'HIT') counters.hits++;
    else if (status === 'STALE') counters.staleHits++;
    else if (status === 'ERROR') counters.errors++;
    else counters.misses++;
  }

  recordWrite(namespace: string, bytes: number): void {
    const counters = this.forNamespace(namespace);
    counters.writes++;
    counters.entries++;
    counters.estimatedBytes += bytes;
  }

  recordRejectedWrite(namespace: string): void {
    this.forNamespace(namespace).rejectedWrites++;
  }

  recordCoalescedLoad(namespace: string): void {
    this.forNamespace(namespace).coalescedLoads++;
  }

  recordError(namespace: string): void {
    this.forNamespace(namespace).errors++;
  }

  snapshot(): CacheNamespaceStats[] {
    return Array.from(this.counters, ([namespace, counters]) => ({
      namespace,
      ...counters,
    })).sort((left, right) => left.namespace.localeCompare(right.namespace));
  }

  reset(): void {
    this.counters.clear();
  }

  private forNamespace(namespace: string): MetricCounters {
    let counters = this.counters.get(namespace);
    if (!counters) {
      counters = emptyCounters();
      this.counters.set(namespace, counters);
    }
    return counters;
  }
}

export const cacheMetrics = new CacheMetrics();
