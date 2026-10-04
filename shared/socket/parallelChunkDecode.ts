import { PlugValidationError } from "../contracts/errors";
import { MAX_PARALLEL_CHUNK_DECODES } from "./streamPullPrefetch";
import { buildSocketBufferError } from "./streamCommandSessionCommon";

export interface ParallelChunkDecodeQueue {
  readonly enqueueOrderedWork: (work: () => Promise<void>) => Promise<void>;
  readonly enqueueDecodeThenOrdered: <T>(
    decode: () => Promise<T>,
    apply: (value: T) => Promise<void> | void,
    bytes?: number,
    signal?: AbortSignal,
  ) => Promise<void>;
  readonly drainOrderedWork: () => Promise<void>;
  readonly clearPendingDecodes: () => void;
  readonly metrics: {
    pendingFrames: number;
    pendingBytes: number;
    peakPendingFrames: number;
    peakPendingBytes: number;
    decodes: number;
  };
}

export const createParallelChunkDecodeQueue = (options?: {
  readonly maxParallel?: number;
  readonly maxPendingFrames?: number;
  readonly maxPendingBytes?: number;
  readonly accumulated?: () => { bytes: number; frames: number };
  readonly signal?: AbortSignal;
  readonly onError?: (error: unknown) => void;
}): ParallelChunkDecodeQueue => {
  const maxParallel = options?.maxParallel ?? MAX_PARALLEL_CHUNK_DECODES;
  const maxFrames = options?.maxPendingFrames ?? 512;
  const maxBytes = options?.maxPendingBytes ?? 8 * 1024 * 1024;
  for (const limit of [maxParallel, maxFrames, maxBytes]) {
    if (!Number.isFinite(limit) || limit <= 0)
      throw new PlugValidationError(
        "Decode queue limits must be positive finite numbers.",
      );
  }
  if (maxParallel > MAX_PARALLEL_CHUNK_DECODES)
    throw new PlugValidationError("At most eight concurrent decodes are allowed.");
  let active = 0;
  let closed = false;
  let applying = false;
  interface Task {
    readonly decode?: () => Promise<unknown>;
    readonly apply: (value: unknown) => Promise<void> | void;
    readonly bytes: number;
    readonly signal?: AbortSignal;
    readonly resolve: () => void;
    cancel: () => void;
    started: boolean;
    ready: boolean;
    cancelled: boolean;
    released: boolean;
    value?: unknown;
    error?: unknown;
    failed: boolean;
  }
  const tasks: Task[] = [];
  const drains: Array<() => void> = [];
  const metrics = {
    pendingFrames: 0,
    pendingBytes: 0,
    peakPendingFrames: 0,
    peakPendingBytes: 0,
    decodes: 0,
  };
  const release = (task: Task): void => {
    if (task.released) return;
    task.released = true;
    task.signal?.removeEventListener("abort", task.cancel);
    if (task.decode) {
      metrics.pendingFrames--;
      metrics.pendingBytes -= task.bytes;
    }
    task.resolve();
  };
  const finishDrains = (): void => {
    if (tasks.length) return;
    for (const resolve of drains.splice(0)) resolve();
  };
  const clearPendingDecodes = (): void => {
    if (closed) return;
    closed = true;
    options?.signal?.removeEventListener("abort", clearPendingDecodes);
    for (const task of tasks) {
      task.cancelled = true;
      release(task);
    }
    tasks.length = 0;
    finishDrains();
  };
  options?.signal?.addEventListener("abort", clearPendingDecodes, { once: true });
  if (options?.signal?.aborted) clearPendingDecodes();
  const fail = (error: unknown): void => {
    if (closed) return;
    clearPendingDecodes();
    options?.onError?.(error);
  };
  const applyReady = (): void => {
    if (applying || closed) return;
    while (tasks.length && tasks[0].ready) {
      const task = tasks[0];
      if (task.cancelled) {
        tasks.shift();
        release(task);
        continue;
      }
      if (task.failed) {
        fail(task.error);
        return;
      }
      try {
        applying = true;
        const applied = task.apply(task.value);
        if (applied) {
          void applied.then(
            () => {
              applying = false;
              if (tasks[0] === task) tasks.shift();
              release(task);
              applyReady();
              finishDrains();
            },
            (error) => {
              applying = false;
              if (task.cancelled) {
                if (tasks[0] === task) tasks.shift();
                applyReady();
                finishDrains();
              } else fail(error);
            },
          );
          return;
        }
        applying = false;
        if (tasks[0] === task) tasks.shift();
        release(task);
      } catch (error) {
        applying = false;
        fail(error);
        return;
      }
    }
    finishDrains();
  };
  const pump = (): void => {
    if (closed) return;
    for (const task of tasks) {
      if (active >= maxParallel) break;
      if (!task.decode || task.started || task.cancelled) continue;
      task.started = true;
      active++;
      metrics.decodes++;
      const complete = (value: unknown, error?: unknown, failed = false): void => {
        active--;
        task.ready = true;
        task.value = value;
        task.error = error;
        task.failed = failed;
        pump();
        applyReady();
      };
      try {
        void task.decode().then(
          (value) => complete(value),
          (error) => complete(undefined, error, true),
        );
      } catch (error) {
        complete(undefined, error, true);
      }
    }
  };
  const enqueue = (
    decode: Task["decode"],
    apply: Task["apply"],
    bytes: number,
    signal?: AbortSignal,
  ): Promise<void> => {
    if (closed || signal?.aborted) return Promise.resolve();
    const completion = new Promise<void>((resolve) => {
      const task: Task = {
        decode,
        apply,
        bytes,
        signal,
        resolve,
        cancel: () => {
          task.cancelled = true;
          task.ready = true;
          release(task);
          applyReady();
        },
        started: false,
        ready: !decode,
        cancelled: false,
        released: false,
        failed: false,
      };
      tasks.push(task);
      signal?.addEventListener("abort", task.cancel, { once: true });
    });
    pump();
    applyReady();
    return completion;
  };
  return {
    metrics,
    enqueueOrderedWork: (work) => enqueue(undefined, work, 0),
    clearPendingDecodes,
    drainOrderedWork: () =>
      tasks.length
        ? new Promise<void>((resolve) => drains.push(resolve))
        : Promise.resolve(),
    enqueueDecodeThenOrdered: <T>(
      decode: () => Promise<T>,
      apply: (value: T) => Promise<void> | void,
      bytes = 0,
      signal?: AbortSignal,
    ): Promise<void> => {
      if (closed || signal?.aborted) return Promise.resolve();
      const accumulated = options?.accumulated?.() ?? { bytes: 0, frames: 0 };
      if (!Number.isFinite(bytes) || bytes < 0)
        throw new PlugValidationError(
          "Decode reservation must be a finite nonnegative number.",
        );
      if (
        metrics.pendingFrames + accumulated.frames + 1 > maxFrames ||
        metrics.pendingBytes + accumulated.bytes + bytes > maxBytes
      ) {
        fail(
          buildSocketBufferError({
            maxBufferedBytes: maxBytes,
            maxBufferedChunkItems: maxFrames,
            maxBufferedRows: Number.MAX_SAFE_INTEGER,
            bufferedBytes: metrics.pendingBytes + accumulated.bytes + bytes,
            chunkCount: metrics.pendingFrames + accumulated.frames + 1,
            bufferedRows: 0,
          }),
        );
        return Promise.resolve();
      }
      metrics.pendingFrames++;
      metrics.pendingBytes += bytes;
      metrics.peakPendingFrames = Math.max(
        metrics.peakPendingFrames,
        metrics.pendingFrames,
      );
      metrics.peakPendingBytes = Math.max(metrics.peakPendingBytes, metrics.pendingBytes);
      return enqueue(decode, (value) => apply(value as T), bytes, signal);
    },
  };
};

/** Unary commands never allocate an unused stream queue. */
export const createLazyParallelChunkDecodeQueue = (
  options?: Parameters<typeof createParallelChunkDecodeQueue>[0],
): ParallelChunkDecodeQueue => {
  let queue: ParallelChunkDecodeQueue | undefined;
  let closed = false;
  const getQueue = (): ParallelChunkDecodeQueue =>
    (queue ??= createParallelChunkDecodeQueue(options));
  return {
    get metrics() {
      return getQueue().metrics;
    },
    enqueueOrderedWork: (work) =>
      closed ? Promise.resolve() : getQueue().enqueueOrderedWork(work),
    enqueueDecodeThenOrdered: (decode, apply, bytes, signal) =>
      closed
        ? Promise.resolve()
        : getQueue().enqueueDecodeThenOrdered(decode, apply, bytes, signal),
    drainOrderedWork: () => queue?.drainOrderedWork() ?? Promise.resolve(),
    clearPendingDecodes: () => {
      closed = true;
      queue?.clearPendingDecodes();
    },
  };
};
