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
  let failed = false;
  let firstError: unknown;

  const runners = Array.from(
    { length: Math.min(concurrency, total) },
    async (): Promise<void> => {
      while (!failed) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= total) {
          return;
        }

        try {
          results[index] = await worker(index);
        } catch (error) {
          if (!failed) firstError = error;
          failed = true;
        }
      }
    },
  );

  await Promise.all(runners);
  if (failed) throw firstError;
  return results;
};
