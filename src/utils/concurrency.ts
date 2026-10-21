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
