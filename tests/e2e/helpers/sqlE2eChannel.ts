import type { PlugE2EConfig } from "./e2eEnv";
import { getInfrastructureSkipReason } from "./environmentSkips";

export type SqlLiveChannel = "rest" | "socket";

export const channelLabel = (channel: SqlLiveChannel): string =>
  channel === "rest" ? "REST" : "SOCKET";

export const credentialsForChannel = (config: PlugE2EConfig, channel: SqlLiveChannel) =>
  channel === "rest" ? config.credentials : config.socketCredentials;

export const baseParameters = (
  channel: SqlLiveChannel,
  extra: Record<string, unknown>,
): Record<string, unknown> => ({
  ...(channel === "socket" ? { channel: "socket" } : {}),
  includePlugMetadata: true,
  ...extra,
});

export const maybeSkipInfrastructureResponse = (
  response: unknown,
  skip: (reason: string) => never,
): void => {
  const skipReason = getInfrastructureSkipReason(response);
  if (skipReason) {
    skip(skipReason);
  }
};
