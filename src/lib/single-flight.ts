export type SingleFlightRunner<Key, Value> = (
  key: Key,
  task: () => Promise<Value>,
) => Promise<Value>;

/**
 * 合并同一个 key 的并发异步任务；任务完成后允许下一次调用重新执行。
 */
export function createSingleFlight<Key, Value>(): SingleFlightRunner<
  Key,
  Value
> {
  const inFlight = new Map<Key, Promise<Value>>();

  return (key, task) => {
    const current = inFlight.get(key);
    if (current) return current;

    let next: Promise<Value>;
    next = Promise.resolve()
      .then(task)
      .finally(() => {
        if (inFlight.get(key) === next) inFlight.delete(key);
      });
    inFlight.set(key, next);
    return next;
  };
}
