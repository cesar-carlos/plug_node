import type { PlugToolsSocketEventListener } from "../../generated/shared/n8n/plugToolsExecution";
import { waitForCustomSocketEvent } from "../../generated/shared/socket/customSocketEventSession";
import { createSocketIoCustomEventTransport } from "./socketIoCustomEventTransport";

export const waitForCustomSocketEventWithSocketIo: PlugToolsSocketEventListener = (
  input,
) =>
  waitForCustomSocketEvent({
    transport: createSocketIoCustomEventTransport(input.session),
    eventName: input.eventName,
    ackTimeoutMs: input.ackTimeoutMs,
    listenTimeoutMs: input.listenTimeoutMs,
    payloadFrameSigning: input.payloadFrameSigning,
    requirePayloadSignature: input.requirePayloadSignature,
  });
