// Runs fn over the items with at most `limit` calls in flight, starting the next as soon as one
// settles, so a slow call holds up only its own slot rather than a whole batch. The results keep
// the order of the items; a call that rejects rejects the whole, as with Promise.all.
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Runs fn one call at a time: a caller during a run gets that run's promise, and one passing
// `again` makes the run call fn once more when it ends, as the call in flight may predate what that
// caller is about; callers during that call can ask for another. A new key() value, such as the
// next wallet's, starts a run of its own, and the old one neither repeats nor detaches the new one.
export function sharedRun<T>(fn: () => Promise<T>, key: () => unknown = () => undefined) {
  let current: { promise: Promise<T>, key: unknown } | undefined;
  let again = false;

  async function runFrom(runKey: unknown): Promise<T> {
    try {
      let result = await fn();
      while (again && runKey === key()) {
        again = false;
        result = await fn();
      }
      return result;
    } finally {
      // in the same step as the last check, so no caller joins a run that will not call fn again
      if (current?.key === runKey) current = undefined;
    }
  }

  function run({ again: callAgain = false } = {}): Promise<T> {
    const runKey = key();
    if (current && current.key === runKey) {
      if (callAgain) again = true;
      return current.promise;
    }
    again = false;
    current = { key: runKey, promise: runFrom(runKey) };
    return current.promise;
  }

  return { run };
}
