import type { RpcSingleCommand } from "../contracts/api";
import { PlugValidationError } from "../contracts/errors";
import { isRecord } from "../utils/json";

export const DEFAULT_BRIDGE_WAIT_MS = 30_000;
export const MAX_BRIDGE_WAIT_MS = 360_000;
export const TRANSPORT_MARGIN_MS = 5_000;
const sqlMethods = new Set(["sql.execute", "sql.executeBatch", "sql.bulkInsert"]);

const validateTimeout = (value: number | undefined): void => {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new PlugValidationError("Timeouts must be positive finite numbers.");
  }
};

export const resolveCommandTimeoutPolicy = (input: {
  readonly command?: RpcSingleCommand | readonly RpcSingleCommand[];
  readonly timeoutMs?: number;
  readonly connectTimeoutMs?: number;
}): {
  readonly hubWaitTimeoutMs: number;
  readonly commandTimeoutMs: number;
  readonly connectTimeoutMs: number;
} => {
  validateTimeout(input.timeoutMs);
  validateTimeout(input.connectTimeoutMs);
  const commands = Array.isArray(input.command) ? input.command : [input.command];
  let hubWaitTimeoutMs = input.timeoutMs ?? DEFAULT_BRIDGE_WAIT_MS;
  for (let index = 0; index < commands.length; index++) {
    const command = commands[index];
    if (!command || !sqlMethods.has(command.method)) {
      continue;
    }
    const params: unknown = command.params;
    const options = isRecord(params) ? params.options : undefined;
    const sqlTimeout = isRecord(options) ? options.timeout_ms : undefined;
    if (typeof sqlTimeout === "number" && Number.isFinite(sqlTimeout) && sqlTimeout > 0) {
      hubWaitTimeoutMs = Math.max(hubWaitTimeoutMs, sqlTimeout + TRANSPORT_MARGIN_MS);
    }
  }
  hubWaitTimeoutMs = Math.min(MAX_BRIDGE_WAIT_MS, hubWaitTimeoutMs);
  return {
    hubWaitTimeoutMs,
    commandTimeoutMs: hubWaitTimeoutMs + TRANSPORT_MARGIN_MS,
    connectTimeoutMs: Math.min(input.connectTimeoutMs ?? 10_000, 10_000),
  };
};
