export const runWithBoundedConcurrency = async <T>(
  total: number,
  concurrency: number,
  worker: (index: number) => Promise<T>,
): Promise<T[]> => {
  if (total <= 0) {
    return [];
  }

  const results = new Array<T>(total);
  let nextIndex = 0;

  const runners = Array.from(
    { length: Math.min(concurrency, total) },
    async (): Promise<void> => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= total) {
          return;
        }

        results[index] = await worker(index);
      }
    },
  );

  await Promise.all(runners);
  return results;
};
