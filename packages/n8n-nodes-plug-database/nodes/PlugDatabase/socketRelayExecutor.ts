import type { PlugSocketExecutor } from "../../generated/shared/n8n/plugClientExecution";
import { PlugValidationError } from "../../generated/shared/contracts/errors";
import {
  executeRelayCommand,
  type RelaySocketTransport,
} from "../../generated/shared/socket/relaySession";
import { createSocketIoTransport } from "./socketIoTransport";

export const executeSocketCommand: PlugSocketExecutor = async (input) => {
  if (Array.isArray(input.command)) {
    throw new PlugValidationError("Socket relay requires a single JSON-RPC command.");
  }

  const transport = createSocketIoTransport({
    baseUrl: input.session.credentials.baseUrl,
    accessToken: input.session.accessToken,
  }) as RelaySocketTransport;

  try {
    return await executeRelayCommand({
      transport,
      session: input.session,
      agentId: input.agentId,
      command: input.command,
      timeoutMs: input.timeoutMs,
      payloadFrameCompression: input.payloadFrameCompression,
      payloadFrameSigning: input.payloadFrameSigning,
      responseMode: input.responseMode,
      bufferLimits: input.bufferLimits,
      streamPullWindowSize: input.streamPullWindowSize,
    });
  } finally {
    transport.disconnect();
  }
};
