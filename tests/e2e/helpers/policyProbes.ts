import type { PlugE2EConfig } from "./e2eEnv";

export const missingDeniedResourceSkipReason =
  "Configure PLUG_E2E_DENIED_RESOURCE to a table name the test client token cannot read.";

export const deniedResourceAllowedSkipReason = (resource: string): string =>
  `PLUG_E2E_DENIED_RESOURCE (${resource}) is readable with the current client token; pick a denied table or fix the token policy.`;

export const resolveNegativeProbeSkipReason = (
  config: PlugE2EConfig,
): string | undefined => {
  if (!config.deniedResource) {
    return missingDeniedResourceSkipReason;
  }

  return undefined;
};

export const resolveUnauthorizedSuccessSkipReason = (
  response: unknown,
  deniedResource: string,
): string | undefined => {
  if (!isSuccessfulSingleResponse(response)) {
    return undefined;
  }

  return deniedResourceAllowedSkipReason(deniedResource);
};

const isSuccessfulSingleResponse = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const response = (value as { type?: string; item?: { success?: boolean } }).item;
  return (value as { type?: string }).type === "single" && response?.success === true;
};
