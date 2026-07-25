import { MAX_PARALLEL_CHUNK_DECODES } from "./streamPullPrefetch";

/**
 * Starts PayloadFrame (or wire) decodes with bounded concurrency, while applying
 * results in arrival order on a serial chain. Decode work overlaps; merge/credit
 * accounting stays ordered.
 */
export interface ParallelChunkDecodeQueue {
  readonly enqueueOrderedWork: (work: () => Promise<void>) => void;
  readonly enqueueDecodeThenOrdered: <TDecoded>(
    decode: () => Promise<TDecoded>,
    apply: (decoded: TDecoded) => Promise<void> | void,
  ) => void;
  readonly drainOrderedWork: () => Promise<void>;
  readonly clearPendingDecodes: () => void;
}

export const createParallelChunkDecodeQueue = (options?: {
  readonly maxParallel?: number;
  readonly onError?: (error: unknown) => void;
}): ParallelChunkDecodeQueue => {
  const maxParallel = options?.maxParallel ?? MAX_PARALLEL_CHUNK_DECODES;
  let orderedChain = Promise.resolve();
  let inflightDecodes = 0;
  const pendingDecodeStarts: Array<() => void> = [];

  const pumpDecodeStarts = (): void => {
    while (inflightDecodes < maxParallel && pendingDecodeStarts.length > 0) {
      const start = pendingDecodeStarts.shift();
      if (!start) {
        return;
      }
      start();
    }
  };

  const enqueueOrderedWork = (work: () => Promise<void>): void => {
    orderedChain = orderedChain.then(work).catch((error: unknown) => {
      options?.onError?.(error);
    });
  };

  const enqueueDecodeThenOrdered = <TDecoded>(
    decode: () => Promise<TDecoded>,
    apply: (decoded: TDecoded) => Promise<void> | void,
  ): void => {
    const decodePromise = new Promise<TDecoded>((resolve, reject) => {
      const start = (): void => {
        inflightDecodes += 1;
        void decode()
          .then(resolve, reject)
          .finally(() => {
            inflightDecodes = Math.max(0, inflightDecodes - 1);
            pumpDecodeStarts();
          });
      };

      if (inflightDecodes < maxParallel) {
        start();
        return;
      }

      pendingDecodeStarts.push(start);
    });

    enqueueOrderedWork(async () => {
      const decoded = await decodePromise;
      await apply(decoded);
    });
  };

  return {
    enqueueOrderedWork,
    enqueueDecodeThenOrdered,
    drainOrderedWork: () => orderedChain,
    clearPendingDecodes: () => {
      pendingDecodeStarts.length = 0;
    },
  };
};
