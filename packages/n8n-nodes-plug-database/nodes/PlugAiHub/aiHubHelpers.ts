import type { IExecuteFunctions } from "n8n-workflow";

import type { SystemPromptConfig } from "../../generated/shared/mcp/contracts";
import { parseOptionalJsonArray } from "../../generated/shared/utils/json";

const normalizeJsonParameter = (value: unknown, fallback = ""): string => {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined || value === null) {
    return fallback;
  }

  return JSON.stringify(value);
};

export const readSystemPromptConfig = (
  context: IExecuteFunctions,
  itemIndex = 0,
): SystemPromptConfig => ({
  identity: String(context.getNodeParameter("identity", itemIndex, "")),
  scope: String(context.getNodeParameter("scope", itemIndex, "")),
  maxToolCallsPerTurn: Number(
    context.getNodeParameter("maxToolCallsPerTurn", itemIndex, 3),
  ),
  sensitiveDataRules: String(
    context.getNodeParameter("sensitiveDataRules", itemIndex, ""),
  ),
  operationalLimits: String(context.getNodeParameter("operationalLimits", itemIndex, "")),
});

export const readForbiddenCapabilityNames = (
  context: IExecuteFunctions,
  itemIndex = 0,
): string[] => {
  const rawValue = context.getNodeParameter(
    "forbiddenCapabilityNamesJson",
    itemIndex,
    "[]",
  );
  const entries =
    parseOptionalJsonArray(
      normalizeJsonParameter(rawValue, "[]"),
      "Forbidden Capability Names JSON",
    ) ?? [];
  return entries.filter((entry): entry is string => typeof entry === "string");
};
