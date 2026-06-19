import { PlugTimeoutError } from "../contracts/errors";
import {
  relayAppErrorEvent,
  relayConnectErrorEvent,
  relayDisconnectEvent,
} from "./relaySessionConstants";
import {
  createRelayConnectError,
  createRelayDisconnectError,
  createRelaySocketAppError,
} from "./relaySessionErrors";
import type { RelaySocketTransport } from "./relaySessionTypes";

export const waitForRelaySingleEvent = <TPayload>(
  transport: RelaySocketTransport,
  eventName: string,
  timeoutMs: number,
  parser: (payload: unknown) => TPayload | Promise<TPayload>,
): Promise<TPayload> =>
  new Promise<TPayload>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      transport.off(eventName, handlePayload);
      transport.off(relayAppErrorEvent, handleAppError);
      transport.off(relayConnectErrorEvent, handleConnectError);
      transport.off(relayDisconnectEvent, handleDisconnect);
    };

    const handlePayload = (payload: unknown): void => {
      cleanup();
      void (async () => {
        try {
          resolve(await parser(payload));
        } catch (error: unknown) {
          reject(error);
        }
      })();
    };

    const handleAppError = (payload: unknown): void => {
      cleanup();
      reject(createRelaySocketAppError(payload));
    };

    const handleConnectError = (payload: unknown): void => {
      cleanup();
      reject(createRelayConnectError(payload));
    };

    const handleDisconnect = (payload: unknown): void => {
      cleanup();
      reject(createRelayDisconnectError(payload));
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(
        new PlugTimeoutError(`Timed out while waiting for socket event ${eventName}`, {
          timeoutMs,
          eventName,
        }),
      );
    }, timeoutMs);

    transport.on(eventName, handlePayload);
    transport.on(relayAppErrorEvent, handleAppError);
    transport.on(relayConnectErrorEvent, handleConnectError);
    transport.on(relayDisconnectEvent, handleDisconnect);
  });
