import {
  ActionIoError,
  currentActionIoEncoding,
  type ActionIoTransport,
} from "../contracts/actionIo/client";
import { isRecord } from "../utils/json";
import { actionIoErrorDetails } from "../contracts/actionIo/errorDetails";

/** REST adapter for the existing normalized single-command bridge envelope. */
export const createRestActionIoTransport = (options: {
  readonly endpoint: string;
  readonly agentId: string;
  readonly bearerToken: () => string;
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly maxResponseBytes?: number;
}): ActionIoTransport => {
  const transport: ActionIoTransport = async (command) => {
    const prepared = currentActionIoEncoding(command, transport);
    const response = await (options.fetch ?? fetch)(options.endpoint, {
      method: "POST",
      redirect: "error",
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.bearerToken()}`,
      },
      body: prepared
        ? `{"agentId":${JSON.stringify(options.agentId)},"command":${prepared.json},"timeoutMs":30000}`
        : JSON.stringify({ agentId: options.agentId, command, timeoutMs: 30000 }),
    });
    // Allow bounded REST metadata around the negotiated 512 KiB logical response.
    const reader = response.body?.getReader();
    if (!reader) throw new ActionIoError("EMPTY_HTTP_RESPONSE", true);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        size += item.value.byteLength;
        if (size > (options.maxResponseBytes ?? 1024 * 1024)) {
          let cleanupFailed = false;
          try {
            await reader.cancel();
          } catch {
            cleanupFailed = true;
          }
          throw new ActionIoError(
            "HTTP_RESPONSE_TOO_LARGE",
            true,
            cleanupFailed ? { cleanup_failed: true } : {},
          );
        }
        chunks.push(item.value);
      }
    } finally {
      reader.releaseLock();
    }
    let body: unknown;
    try {
      body = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, size),
        ),
      );
    } catch {
      throw new ActionIoError("INVALID_HTTP_JSON", true);
    }
    if (
      !response.ok &&
      isRecord(body) &&
      body.success === false &&
      isRecord(body.error) &&
      typeof body.error.code === "string"
    ) {
      const details = actionIoErrorDetails({
        ...(isRecord(body.error.details) ? body.error.details : {}),
        ...(typeof body.requestId === "string" ? { request_id: body.requestId } : {}),
      });
      throw new ActionIoError(
        body.error.code,
        details.effects_possible !== false || details.outcome_unknown === true,
        details,
      );
    }
    if (
      !isRecord(body) ||
      body.agentId !== options.agentId ||
      !isRecord(body.response) ||
      body.response.type !== "single" ||
      !isRecord(body.response.item)
    ) {
      throw new ActionIoError(`HTTP_${response.status}_INVALID_ENVELOPE`, true);
    }
    const item = body.response.item;
    const envelope = {
      jsonrpc: "2.0",
      id: item.id,
      ...(Object.prototype.hasOwnProperty.call(item, "api_version")
        ? { api_version: item.api_version }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(item, "meta") ? { meta: item.meta } : {}),
    };
    if (
      item.success === true &&
      Object.prototype.hasOwnProperty.call(item, "result") &&
      !Object.prototype.hasOwnProperty.call(item, "error") &&
      response.ok
    ) {
      return { ...envelope, result: item.result };
    }
    if (
      item.success === false &&
      isRecord(item.error) &&
      !Object.prototype.hasOwnProperty.call(item, "result")
    ) {
      return { ...envelope, error: item.error };
    }
    throw new ActionIoError("INVALID_HTTP_RESULT", true);
  };
  return transport;
};
