import type { CustomSocketEventTransport } from "../../generated/shared/socket/customSocketEventSession";
import type { PlugSession } from "../../generated/shared/contracts/api";
import { createSocketIoTransport } from "./socketIoTransport";

export const createSocketIoCustomEventTransport = (
  session: PlugSession,
): CustomSocketEventTransport =>
  createSocketIoTransport({
    baseUrl: session.credentials.baseUrl,
    accessToken: session.accessToken,
  }) as CustomSocketEventTransport;
