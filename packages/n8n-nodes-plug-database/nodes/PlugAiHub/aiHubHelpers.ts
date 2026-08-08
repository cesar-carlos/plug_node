import type { IExecuteFunctions } from "n8n-workflow";

import type { SystemPromptConfig } from "../../generated/shared/mcp/contracts";
import { filterForbiddenCapabilityNames } from "../../generated/shared/mcp/forbiddenCapabilities";
import {
  normalizeJsonParameter,
  parseOptionalJsonArray,
} from "../../generated/shared/utils/json";

const normalizeMaxToolCallsPerTurn = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 3;
  }

  const truncated = Math.trunc(parsed);
  if (truncated < 1) {
    return 1;
  }

  if (truncated > 20) {
    return 20;
  }

  return truncated;
};

export const readSystemPromptConfig = (
  context: IExecuteFunctions,
  itemIndex = 0,
): SystemPromptConfig => ({
  identity: String(context.getNodeParameter("identity", itemIndex, "")),
  scope: String(context.getNodeParameter("scope", itemIndex, "")),
  maxToolCallsPerTurn: normalizeMaxToolCallsPerTurn(
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
  return filterForbiddenCapabilityNames(
    entries.filter((entry): entry is string => typeof entry === "string"),
  );
};
