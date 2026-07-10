import { FORBIDDEN_CAPABILITY_RESOURCES, type CapabilityDefinition } from "./contracts";

const normalizeToken = (value: string): string =>
  value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[\s.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

const forbiddenTokens = FORBIDDEN_CAPABILITY_RESOURCES.map((entry) =>
  normalizeToken(entry),
);

const matchesForbiddenToken = (value: string): boolean => {
  const normalized = normalizeToken(value);
  if (normalized === "") {
    return false;
  }

  return forbiddenTokens.some(
    (token) =>
      normalized === token ||
      normalized.startsWith(`${token}_`) ||
      normalized.endsWith(`_${token}`) ||
      normalized.includes(`_${token}_`),
  );
};

export const isForbiddenCapabilityName = (name: string): boolean =>
  matchesForbiddenToken(name);

export const isForbiddenToolsOperation = (operation: string): boolean =>
  matchesForbiddenToken(operation);

export const isCapabilityForbiddenForAgent = (
  capability: CapabilityDefinition,
): boolean => {
  if (isForbiddenCapabilityName(capability.name)) {
    return true;
  }

  if (capability.executionConfig.providerType === "tools") {
    return isForbiddenToolsOperation(capability.executionConfig.operation);
  }

  return false;
};

export const filterForbiddenCapabilityNames = (names: readonly string[]): string[] => [
  ...new Set(names.map((name) => name.trim()).filter((name) => name !== "")),
];

export const isCapabilityBlockedByNameList = (
  capabilityName: string,
  forbiddenNames: readonly string[],
): boolean => {
  if (forbiddenNames.length === 0) {
    return false;
  }

  const normalizedName = normalizeToken(capabilityName);
  return forbiddenNames.some((name) => normalizeToken(name) === normalizedName);
};
