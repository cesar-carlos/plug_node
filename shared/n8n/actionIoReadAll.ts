import type { IDataObject, IExecuteFunctions, INodeExecutionData } from "n8n-workflow";
import { ActionIoError, nextActionIoOffsets } from "../contracts/actionIo/client";
import { isRecord } from "../utils/json";
import { ACTION_IO_TRANSPORT } from "../contracts/actionIo/capability";

const MAX_READ_DURATION_MS = 300000;
const MAX_READ_PARTS = 4096;
const MAX_READ_PAGES = 4096;

/** Completion is an event consumed by this reader, not the agent's capture state. */
export const actionIoOutputDrained = (page: Record<string, unknown>): boolean =>
  Array.isArray(page.events) &&
  page.events.some((event: unknown) => isRecord(event) && event.type === "completed");

export interface ActionIoReadBudget {
  readonly bytes: number;
  readonly milliseconds: number;
}

export const validateActionIoReadBudget = (
  bytes: unknown,
  milliseconds: unknown,
): ActionIoReadBudget => {
  if (
    typeof bytes !== "number" ||
    !Number.isSafeInteger(bytes) ||
    bytes < 1 ||
    bytes > ACTION_IO_TRANSPORT.max_execution_bytes ||
    typeof milliseconds !== "number" ||
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < 1 ||
    milliseconds > MAX_READ_DURATION_MS
  )
    throw new ActionIoError("INVALID_READ_BUDGET", false);
  return { bytes, milliseconds };
};

/** Store bounded chunks through n8n; keep only binary references and metadata in memory. */
export const readAllActionIo = async (
  context: IExecuteFunctions,
  index: number,
  initial: Record<string, unknown>,
  initialOffsets: { stdout: number; stderr: number },
  budget: ActionIoReadBudget,
  read: (
    params: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<Record<string, unknown>>,
  interrupt: () => void,
): Promise<INodeExecutionData> => {
  const signal = context.getExecutionCancelSignal?.();
  const controller = new AbortController();
  let reason = "completed";
  const stop = (why: string): void => {
    reason = why;
    controller.abort();
    interrupt();
  };
  const cancelled = (): void => stop("cancelled");
  const timer = setTimeout(() => stop("time_limit"), budget.milliseconds);
  signal?.addEventListener("abort", cancelled, { once: true });
  const deadline = performance.now() + budget.milliseconds;
  let sequence = Number(initial.after_sequence);
  let offsets = { ...initialOffsets };
  let bytes = 0;
  let pages = 0;
  let drained = false;
  let complete = false;
  let terminal = false;
  let exitCode: number | null = null;
  let errorCode: string | undefined;
  const parts: IDataObject[] = [];
  const binary: NonNullable<INodeExecutionData["binary"]> = {};
  try {
    if (signal?.aborted) cancelled();
    outer: while (!controller.signal.aborted && pages < MAX_READ_PAGES) {
      if (performance.now() >= deadline) {
        stop("time_limit");
        break;
      }
      const params = {
        ...initial,
        after_sequence: sequence,
        max_bytes: Math.max(
          ACTION_IO_TRANSPORT.max_block_bytes,
          Math.min(Number(initial.max_bytes), budget.bytes - bytes),
        ),
        wait_ms: Math.min(
          Number(initial.wait_ms),
          Math.max(0, Math.floor(deadline - performance.now())),
        ),
      };
      // Stop promptly even when an adapter has not yet observed socket disposal.
      let abort: (() => void) | undefined;
      const interrupted = new Promise<never>((_, reject) => {
        abort = () => reject(new ActionIoError("READ_INTERRUPTED", false));
        controller.signal.addEventListener("abort", abort, { once: true });
      });
      let page: Record<string, unknown>;
      try {
        page = await Promise.race([read(params, controller.signal), interrupted]);
      } finally {
        if (abort) controller.signal.removeEventListener("abort", abort);
      }
      if (controller.signal.aborted) break;
      pages++;
      nextActionIoOffsets(page, offsets);
      terminal = page.terminal === true;
      const events = page.events as Record<string, unknown>[];
      let expected = sequence;
      let sawCompleted = false;
      for (const event of events) {
        if (sawCompleted || event.sequence !== ++expected)
          throw new ActionIoError("INVALID_RESPONSE", false);
        sawCompleted = event.type === "completed";
      }
      if (page.next_sequence !== expected)
        throw new ActionIoError("INVALID_RESPONSE", false);
      for (const event of events) {
        if (performance.now() >= deadline) stop("time_limit");
        if (controller.signal.aborted) break outer;
        if (event.type === "output") {
          const data = Buffer.from(String(event.data_base64), "base64");
          if (bytes + data.length > budget.bytes) {
            reason = "byte_limit";
            break outer;
          }
          if (parts.length >= MAX_READ_PARTS) {
            reason = "chunk_limit";
            break outer;
          }
          const stored = await context.helpers.prepareBinaryData(
            data,
            `${event.stream}-${event.offset}.bin`,
            "application/octet-stream",
          );
          // Inline n8n mode would retain the entire output as base64 in execution data.
          if (!stored.id || stored.data === event.data_base64)
            throw new ActionIoError("EXTERNAL_BINARY_STORAGE_REQUIRED", false);
          const key = `event_${event.sequence}`;
          binary[key] = stored;
          parts.push({
            field: key,
            stream: String(event.stream),
            offset: Number(event.offset),
            bytes: data.length,
            sequence: Number(event.sequence),
          });
          offsets = {
            ...offsets,
            [String(event.stream)]: Number(event.offset) + data.length,
          };
          bytes += data.length;
        } else if (event.type === "process_exited") {
          exitCode = typeof event.exit_code === "number" ? event.exit_code : null;
        } else if (event.type === "completed") {
          drained = true;
          complete = event.output_complete === true && !event.failure;
          if (!complete) {
            reason = "capture_failed";
            errorCode = "OUTPUT_CAPTURE_INCOMPLETE";
          }
        }
        sequence = Number(event.sequence);
      }
      if (drained) break;
      if (terminal && events.length === 0)
        throw new ActionIoError("COMPLETION_NOT_RECEIVED", false);
    }
    if (!drained && reason === "completed") reason = "page_limit";
  } catch (error) {
    if (!controller.signal.aborted) {
      reason = "read_failed";
      errorCode = error instanceof ActionIoError ? error.code : "READ_OR_STORAGE_FAILED";
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancelled);
  }
  return {
    json: {
      execution_id: String(initial.execution_id),
      next_sequence: sequence,
      next_offsets: offsets,
      output_drained: drained,
      output_complete: complete,
      terminal,
      process_exit_code: exitCode,
      stop_reason: reason,
      bytes_read: bytes,
      pages_read: pages,
      parts,
      ...(errorCode ? { error: { code: errorCode } } : {}),
    },
    binary,
    pairedItem: { item: index },
  };
};
