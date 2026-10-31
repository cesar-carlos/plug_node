import { isRecord } from "../../utils/json";

/** Safe correlation metadata only; never retain input bytes or credentials here. */
export interface ActionIoResponseExpectation {
  readonly faithfulIo?: boolean;
  readonly actionId?: string;
  readonly executionId?: string;
  readonly messageId?: string;
  readonly sequence?: number;
  readonly afterSequence?: number;
  readonly maxBytes?: number;
  readonly inputBytes?: number;
  readonly catalogPageSize?: number;
  readonly catalogCursor?: string;
}
export const captureActionIoExpectation = (
  command: unknown,
): ActionIoResponseExpectation => {
  if (
    !isRecord(command) ||
    typeof command.method !== "string" ||
    !command.method.startsWith("agent.action.") ||
    !isRecord(command.params)
  )
    return {};
  const p = command.params;
  const inputBytes =
    command.method === "agent.action.closeInput"
      ? 0
      : command.method === "agent.action.sendInput" && typeof p.data_base64 === "string"
        ? Buffer.byteLength(p.data_base64, "base64")
        : undefined;
  return {
    ...(command.method === "agent.action.listAvailable"
      ? {
          catalogPageSize: typeof p.page_size === "number" ? p.page_size : 20,
          ...(typeof p.cursor === "string" ? { catalogCursor: p.cursor } : {}),
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(p, "io") ? { faithfulIo: true } : {}),
    ...(Object.prototype.hasOwnProperty.call(p, "io") && typeof p.action_id === "string"
      ? { actionId: p.action_id }
      : {}),
    ...(inputBytes !== undefined ? { inputBytes } : {}),
    ...(typeof p.execution_id === "string" ? { executionId: p.execution_id } : {}),
    ...(typeof p.message_id === "string" ? { messageId: p.message_id } : {}),
    ...(typeof p.sequence === "number" ? { sequence: p.sequence } : {}),
    ...(typeof p.after_sequence === "number" ? { afterSequence: p.after_sequence } : {}),
    ...(typeof p.max_bytes === "number" ? { maxBytes: p.max_bytes } : {}),
  };
};
export const matchesActionIoExpectation = (
  result: unknown,
  expected: ActionIoResponseExpectation,
): boolean => {
  if (!isRecord(result)) return false;
  if (
    expected.catalogPageSize !== undefined &&
    (!Array.isArray(result.actions) ||
      result.actions.length > expected.catalogPageSize ||
      (expected.catalogCursor !== undefined &&
        result.next_cursor === expected.catalogCursor))
  )
    return false;
  if (expected.actionId !== undefined && result.action_id !== expected.actionId)
    return false;
  if (expected.executionId !== undefined && result.execution_id !== expected.executionId)
    return false;
  if (expected.messageId !== undefined && result.message_id !== expected.messageId)
    return false;
  if (expected.sequence !== undefined && result.sequence !== expected.sequence)
    return false;
  if (
    expected.inputBytes !== undefined &&
    result.state === "written" &&
    result.confirmed_bytes !== expected.inputBytes
  )
    return false;
  if (
    expected.inputBytes !== undefined &&
    typeof result.confirmed_bytes === "number" &&
    result.confirmed_bytes > expected.inputBytes
  )
    return false;
  if (expected.afterSequence !== undefined) {
    if (!Array.isArray(result.events)) return false;
    if (result.events.length === 0 && result.next_sequence !== expected.afterSequence)
      return false;
    let bytes = 0;
    let previous = expected.afterSequence;
    for (const event of result.events) {
      if (
        !isRecord(event) ||
        typeof event.sequence !== "number" ||
        event.sequence !== previous + 1
      )
        return false;
      previous = event.sequence;
      if (event.type === "output" && typeof event.data_base64 === "string")
        bytes += Buffer.byteLength(event.data_base64, "base64");
    }
    if (expected.maxBytes !== undefined && bytes > expected.maxBytes) return false;
  }
  return true;
};
