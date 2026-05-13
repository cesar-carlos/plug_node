import type { PlugToolsSocketEventPublisher } from "../../generated/shared/n8n/plugToolsExecution";
import { publishCustomSocketEventOverSocket } from "../../generated/shared/socket/customSocketEventSession";
import { createSocketIoCustomEventTransport } from "./socketIoCustomEventTransport";

export const publishCustomSocketEventWithSocketIo: PlugToolsSocketEventPublisher = async (
  input,
) => {
  return publishCustomSocketEventOverSocket({
    transport: createSocketIoCustomEventTransport(input.session),
    request: {
      eventName: input.eventName,
      payload: input.payload,
      payloadFrameCompression: input.payloadFrameCompression,
      idempotencyKey: input.idempotencyKey,
      attachments: input.attachments,
      timeoutMs: input.timeoutMs,
    },
    payloadFrameSigning: input.payloadFrameSigning,
  });
};
