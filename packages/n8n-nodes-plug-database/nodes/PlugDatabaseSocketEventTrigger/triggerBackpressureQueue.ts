import { PlugError } from "../../generated/shared/contracts/errors";

export interface BackpressureSnapshot {
  readonly queuedCount: number;
  readonly inflightCount: number;
  readonly startedCount: number;
  readonly processedCount: number;
  readonly failedCount: number;
  readonly droppedNewestCount: number;
  readonly droppedOldestCount: number;
  readonly averageQueueLatencyMs: number;
  readonly averageProcessingMs: number;
}

export const defaultBackpressureStatsLogIntervalMs = 30_000;

export const createBackpressureQueue = (input: {
  readonly maxInflightEvents: number;
  readonly maxQueueSize: number;
  readonly overflowPolicy: "fail" | "dropNewest" | "dropOldest";
  readonly emitError: (error: PlugError) => void;
  readonly statsLogIntervalMs?: number;
  readonly onDrop?: (
    reason: "dropNewest" | "dropOldest",
    metadata: { readonly queueSize: number },
  ) => void;
  /** When true, surfaced through emitError in addition to onDrop logging/metrics. */
  readonly reportDropAsError?: boolean;
  readonly onStats?: (
    snapshot: BackpressureSnapshot,
    metadata: { readonly reason: "drop" | "drain" },
  ) => void;
}) => {
  const queue: Array<{
    readonly task: () => Promise<void>;
    readonly enqueuedAtMs: number;
  }> = [];
  let inflight = 0;
  let closed = false;
  let startedCount = 0;
  let processedCount = 0;
  let failedCount = 0;
  let droppedNewestCount = 0;
  let droppedOldestCount = 0;
  let totalQueueLatencyMs = 0;
  let totalProcessingMs = 0;
  let lastStatsLoggedAtMs = 0;

  const getStats = (): BackpressureSnapshot => {
    const completedCount = processedCount + failedCount;
    return {
      queuedCount: queue.length,
      inflightCount: inflight,
      startedCount,
      processedCount,
      failedCount,
      droppedNewestCount,
      droppedOldestCount,
      averageQueueLatencyMs:
        startedCount > 0 ? Math.round(totalQueueLatencyMs / startedCount) : 0,
      averageProcessingMs:
        completedCount > 0 ? Math.round(totalProcessingMs / completedCount) : 0,
    };
  };

  const maybeLogStats = (reason: "drop" | "drain"): void => {
    if (!input.onStats) {
      return;
    }

    const now = Date.now();
    const intervalMs = input.statsLogIntervalMs ?? defaultBackpressureStatsLogIntervalMs;
    if (reason !== "drop" && now - lastStatsLoggedAtMs < intervalMs) {
      return;
    }

    lastStatsLoggedAtMs = now;
    input.onStats(getStats(), { reason });
  };

  const drain = (): void => {
    if (closed) {
      return;
    }

    while (inflight < input.maxInflightEvents && queue.length > 0) {
      const queuedTask = queue.shift();
      if (!queuedTask) {
        return;
      }

      const startedAtMs = Date.now();
      startedCount += 1;
      totalQueueLatencyMs += Math.max(0, startedAtMs - queuedTask.enqueuedAtMs);
      inflight += 1;
      queuedTask
        .task()
        .then(() => {
          processedCount += 1;
        })
        .catch((error: unknown) => {
          if (closed) {
            return;
          }

          failedCount += 1;
          input.emitError(
            error instanceof PlugError
              ? error
              : new PlugError("Failed to emit Plug socket event item.", {
                  code: "SOCKET_EVENT_EMIT_FAILED",
                  technicalMessage: error instanceof Error ? error.message : undefined,
                }),
          );
        })
        .finally(() => {
          totalProcessingMs += Math.max(0, Date.now() - startedAtMs);
          inflight -= 1;
          maybeLogStats("drain");
          drain();
        });
    }
  };

  return {
    enqueue(task: () => Promise<void>): void {
      if (closed) {
        return;
      }
      const queuedTask = { task, enqueuedAtMs: Date.now() };

      if (inflight < input.maxInflightEvents && queue.length === 0) {
        queue.push(queuedTask);
        drain();
        return;
      }

      if (queue.length >= input.maxQueueSize) {
        if (input.overflowPolicy === "dropNewest") {
          droppedNewestCount += 1;
          input.onDrop?.("dropNewest", { queueSize: queue.length });
          if (input.reportDropAsError) {
            input.emitError(
              new PlugError("Plug socket event was dropped because the queue is full.", {
                code: "SOCKET_EVENT_BACKPRESSURE_DROPPED",
                description:
                  "Increase Max Queue Size, reduce event volume, or switch overflow policy.",
                details: { policy: "dropNewest", queueSize: queue.length },
              }),
            );
          }
          maybeLogStats("drop");
          return;
        }

        if (input.overflowPolicy === "dropOldest") {
          queue.shift();
          droppedOldestCount += 1;
          input.onDrop?.("dropOldest", { queueSize: queue.length });
          if (input.reportDropAsError) {
            input.emitError(
              new PlugError("Plug socket event was dropped because the queue is full.", {
                code: "SOCKET_EVENT_BACKPRESSURE_DROPPED",
                description:
                  "Increase Max Queue Size, reduce event volume, or switch overflow policy.",
                details: { policy: "dropOldest", queueSize: queue.length },
              }),
            );
          }
          maybeLogStats("drop");
        } else {
          input.emitError(
            new PlugError("Plug socket event queue is full.", {
              code: "SOCKET_EVENT_BACKPRESSURE_LIMIT",
              description:
                "Increase Max Queue Size or reduce event volume before retrying.",
              retryable: true,
            }),
          );
          return;
        }
      }

      queue.push(queuedTask);
      drain();
    },
    close(): void {
      closed = true;
      queue.length = 0;
    },
    getStats(): BackpressureSnapshot {
      return getStats();
    },
  };
};
