export interface LatestTaskQueue<Value> {
  enqueue(value: Value): Promise<void>;
}

/**
 * 串行执行任务；执行期间的多次 enqueue 只保留最后一个值。
 *
 * 适合播放进度这类“最新状态覆盖旧状态”的写入：网络变慢时不会堆积
 * 已经过时的请求，但当前请求结束后仍会把最后一次状态持久化。
 */
export function createLatestTaskQueue<Value>(
  run: (value: Value) => Promise<void>,
): LatestTaskQueue<Value> {
  let pending!: Value;
  let hasPending = false;
  let active: Promise<void> | null = null;

  const drain = async () => {
    while (hasPending) {
      const current = pending;
      hasPending = false;

      try {
        await run(current);
      } catch (error) {
        // 如果失败时已经有更新的状态，直接尝试更新状态；旧状态已经没有
        // 重试价值。没有更新状态时把错误交给调用方，等待下一次保存重试。
        if (!hasPending) throw error;
      }
    }
  };

  return {
    enqueue(value) {
      pending = value;
      hasPending = true;
      if (!active) {
        active = drain().finally(() => {
          active = null;
        });
      }
      return active;
    },
  };
}
