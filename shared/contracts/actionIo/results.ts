import {
  actionExecutionResultSchema,
  actionValidateRunResultSchema,
  actionCancelResultSchema,
} from "./execution";
import {
  matchesActionIoExpectation,
  type ActionIoResponseExpectation,
} from "./expectation";
import { isRecord } from "../../utils/json";
import { ACTION_IO_TRANSPORT } from "./capability";
import { z } from "zod4";
import {
  actionIoBlockSchema,
  ACTION_IO_BLOCK_BYTES,
  ACTION_IO_PAGE_BYTES,
} from "./params";
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const identity = z.string().min(1);
const receipt = z
  .object({
    execution_id: identity,
    message_id: identity,
    sequence: integer,
    state: z.enum(["accepted", "writing", "written", "failed", "unknown"]),
    confirmed_bytes: integer.max(ACTION_IO_BLOCK_BYTES).nullable(),
    next_input_sequence: integer,
    stdin_state: z.enum(["pending", "open", "closing", "closed", "failed"]),
  })
  .strict()
  .refine((value) => value.state !== "written" || value.confirmed_bytes !== null, {
    message: "Written input requires confirmed byte progress",
  });
const failure = z
  .object({
    code: identity,
    phase: identity,
    origin: identity,
    diagnostic_id: identity,
    effects_possible: z.boolean(),
    retryable: z.literal(false),
    recovery: identity,
    confirmed_bytes: integer.nullable().optional(),
  })
  .strict();
const event = z.discriminatedUnion("type", [
  z
    .object({
      sequence: integer.min(1),
      type: z.literal("output"),
      stream: z.enum(["stdout", "stderr"]),
      offset: integer,
      data_base64: actionIoBlockSchema,
    })
    .strict(),
  z
    .object({
      sequence: integer.min(1),
      type: z.literal("process_exited"),
      exit_code: z.number().int().nullable(),
    })
    .strict(),
  z
    .object({
      sequence: integer.min(1),
      type: z.literal("completed"),
      output_complete: z.boolean(),
      failure: failure.optional(),
    })
    .strict(),
]);
const page = z
  .object({
    execution_id: identity,
    events: z.array(event).max(256),
    next_sequence: integer,
    terminal: z.boolean(),
    output_complete: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    let bytes = 0;
    let previous = 0;
    const offsets = new Map<"stdout" | "stderr", number>();
    for (const item of value.events) {
      if (item.sequence <= previous)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Non-increasing event sequence",
        });
      previous = item.sequence;
      if (item.type === "output") {
        const length = Buffer.byteLength(item.data_base64, "base64");
        const expectedOffset = offsets.get(item.stream);
        const end = item.offset + length;
        if (
          (expectedOffset !== undefined && item.offset !== expectedOffset) ||
          !Number.isSafeInteger(end)
        )
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Invalid stream byte offsets",
          });
        offsets.set(item.stream, end);
        bytes += length;
      }
    }
    if (
      bytes > ACTION_IO_PAGE_BYTES ||
      (value.events.length > 0 && value.next_sequence !== previous)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid page byte limit or cursor",
      });
    }
  });
const found = z.discriminatedUnion("found", [
  z.object({ found: z.literal(true), execution_id: identity }).strict(),
  z
    .object({
      found: z.literal(false),
      execution_id: z.null(),
      reason: z.literal("not_found_in_retention_window"),
    })
    .strict(),
]);
const results: Readonly<Record<string, z.ZodType>> = {
  "agent.action.run": actionExecutionResultSchema,
  "agent.action.getExecution": actionExecutionResultSchema,
  "agent.action.validateRun": actionValidateRunResultSchema,
  "agent.action.cancel": actionCancelResultSchema,
  "agent.action.sendInput": receipt,
  "agent.action.closeInput": receipt,
  "agent.action.getInputStatus": receipt,
  "agent.action.readIo": page,
  "agent.action.listAvailable": z.strictObject({
    actions: z
      .array(
        z.strictObject({
          action_id: z.string().min(1),
          name: z.string().min(1),
          trigger_ids: z.array(z.string().min(1)),
          io_eligible: z.boolean(),
          public_description: z.string().max(512).nullable(),
          stdin_description: z.string().max(512).nullable(),
          stdout_description: z.string().max(512).nullable(),
          stderr_description: z.string().max(512).nullable(),
        }),
      )
      .max(50),
    next_cursor: z.string().min(1).max(128).nullable(),
  }),
  "agent.action.findExecution": found,
};
/** Validate the selected method only; never accept another method's result union. */
export const isValidActionIoResult = (method: string, result: unknown): boolean => {
  if (!Object.prototype.hasOwnProperty.call(results, method)) return false;
  const schema = results[method];
  if (!schema || !schema.safeParse(result).success) return false;
  try {
    return (
      Buffer.byteLength(JSON.stringify(result), "utf8") <=
      ACTION_IO_TRANSPORT.max_json_bytes
    );
  } catch {
    return false;
  }
};

/** General JSON-RPC envelope validation runs before this method-specific check. */
export const isValidActionIoResponse = (
  method: string | undefined,
  response: unknown,
  expected?: ActionIoResponseExpectation,
): boolean => {
  if (!method || !Object.prototype.hasOwnProperty.call(results, method)) return false;
  if (!isRecord(response)) return false;
  const executionMethod = [
    "agent.action.run",
    "agent.action.getExecution",
    "agent.action.validateRun",
    "agent.action.cancel",
  ].includes(method);
  const result = isRecord(response.result) ? response.result : undefined;
  const execution =
    method === "agent.action.cancel" && isRecord(result?.execution)
      ? result.execution
      : result;
  if (
    !Object.prototype.hasOwnProperty.call(response, "error") &&
    method !== "agent.action.validateRun" &&
    executionMethod &&
    (!execution || !isRecord(execution.io))
  )
    return false;
  if (
    method === "agent.action.cancel" &&
    result &&
    execution &&
    (result.execution_id !== execution.execution_id || result.status !== execution.status)
  )
    return false;
  // The negotiated budget includes correlation metadata and error envelopes.
  try {
    if (
      Buffer.byteLength(JSON.stringify(response), "utf8") >
      ACTION_IO_TRANSPORT.max_json_bytes
    )
      return false;
  } catch {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(response, "error"))
    return !Object.prototype.hasOwnProperty.call(response, "result");
  // For a wire JSON object the envelope already includes every result byte.
  // Custom objects can omit or replace the result during serialization.
  const field = Object.getOwnPropertyDescriptor(response, "result");
  const included =
    result &&
    field?.enumerable &&
    field.value === result &&
    !Array.isArray(response) &&
    !("toJSON" in response) &&
    !("toJSON" in result);
  return (
    (included
      ? results[method].safeParse(result).success
      : isValidActionIoResult(method, response.result)) &&
    (!expected || matchesActionIoExpectation(response.result, expected))
  );
};
