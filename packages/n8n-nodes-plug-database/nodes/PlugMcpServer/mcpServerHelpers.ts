import { randomUUID } from "node:crypto";

import type { IExecuteFunctions } from "n8n-workflow";
import { NodeOperationError } from "n8n-workflow";

import type {
  AuditContext,
  CapabilityDefinition,
  CapabilityExecutionConfig,
  GovernanceConfig,
  ParamSchema,
} from "../../generated/shared/mcp/contracts";
import { FORBIDDEN_CAPABILITY_RESOURCES } from "../../generated/shared/mcp/contracts";
import {
  isRecord,
  parseOptionalJsonArray,
  parseOptionalJsonObject,
} from "../../generated/shared/utils/json";

const normalizeJsonParameter = (value: unknown, fallback = ""): string => {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined || value === null) {
    return fallback;
  }

  return JSON.stringify(value);
};

const readRequiredString = (value: unknown, fieldPath: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldPath} must be a non-empty string.`);
  }

  return value;
};

const isParamType = (value: unknown): value is ParamSchema["type"] =>
  value === "string" || value === "number" || value === "boolean" || value === "object";

const parseParamSchema = (value: unknown, fieldPath: string): ParamSchema => {
  if (!isRecord(value)) {
    throw new Error(`${fieldPath} must be an object.`);
  }

  if (!isParamType(value.type)) {
    throw new Error(`${fieldPath}.type must be string, number, boolean, or object.`);
  }

  if (typeof value.description !== "string" || value.description.trim() === "") {
    throw new Error(`${fieldPath}.description must be a non-empty string.`);
  }

  return {
    type: value.type,
    description: value.description,
    ...(value.required === true ? { required: true } : {}),
    ...(value.default !== undefined ? { default: value.default } : {}),
    ...(typeof value.maximum === "number" ? { maximum: value.maximum } : {}),
    ...(typeof value.minimum === "number" ? { minimum: value.minimum } : {}),
  };
};

const parseGovernance = (value: unknown, fieldPath: string): GovernanceConfig => {
  if (!isRecord(value)) {
    throw new Error(`${fieldPath} must be an object.`);
  }

  if (typeof value.maxRows !== "number" || value.maxRows <= 0) {
    throw new Error(`${fieldPath}.maxRows must be a positive number.`);
  }

  return {
    maxRows: value.maxRows,
    ...(value.requireAtLeastOneFilter === true ? { requireAtLeastOneFilter: true } : {}),
    ...(Array.isArray(value.filterParamNames)
      ? {
          filterParamNames: value.filterParamNames.filter(
            (entry): entry is string => typeof entry === "string",
          ),
        }
      : {}),
    ...(Array.isArray(value.maskedColumns)
      ? {
          maskedColumns: value.maskedColumns.filter(
            (entry): entry is string => typeof entry === "string",
          ),
        }
      : {}),
  };
};

const parseExecutionConfig = (
  value: unknown,
  fieldPath: string,
): CapabilityExecutionConfig => {
  if (!isRecord(value)) {
    throw new Error(`${fieldPath} must be an object.`);
  }

  if (value.providerType === "sql") {
    if (typeof value.sql !== "string" || value.sql.trim() === "") {
      throw new Error(`${fieldPath}.sql must be a non-empty string.`);
    }

    const channel = value.channel === "socket" ? "socket" : "rest";
    if (typeof value.maxRows !== "number" || value.maxRows <= 0) {
      throw new Error(`${fieldPath}.maxRows must be a positive number.`);
    }

    return {
      providerType: "sql",
      sql: value.sql,
      channel,
      maxRows: value.maxRows,
      ...(typeof value.agentId === "string" && value.agentId.trim() !== ""
        ? { agentId: value.agentId }
        : {}),
      ...(typeof value.clientToken === "string" && value.clientToken.trim() !== ""
        ? { clientToken: value.clientToken }
        : {}),
    };
  }

  if (value.providerType === "tools") {
    if (typeof value.operation !== "string" || value.operation.trim() === "") {
      throw new Error(`${fieldPath}.operation must be a non-empty string.`);
    }

    return {
      providerType: "tools",
      operation: value.operation,
      ...(isRecord(value.staticParams) ? { staticParams: value.staticParams } : {}),
      ...(typeof value.agentId === "string" && value.agentId.trim() !== ""
        ? { agentId: value.agentId }
        : {}),
      ...(typeof value.clientToken === "string" && value.clientToken.trim() !== ""
        ? { clientToken: value.clientToken }
        : {}),
    };
  }

  throw new Error(`${fieldPath}.providerType must be "sql" or "tools".`);
};

const parseCapabilityDefinition = (
  value: unknown,
  index: number,
): CapabilityDefinition => {
  const fieldPath = `Capability definition at index ${index}`;
  if (!isRecord(value)) {
    throw new Error(`${fieldPath} must be an object.`);
  }

  const requiredStringFields = [
    "name",
    "displayName",
    "description",
    "whenToUse",
    "whenNotToUse",
    "category",
  ] as const;

  if (!isRecord(value.parameters)) {
    throw new Error(`${fieldPath}.parameters must be an object.`);
  }

  for (const field of requiredStringFields) {
    readRequiredString(value[field], `${fieldPath}.${field}`);
  }

  const parameters = Object.fromEntries(
    Object.entries(value.parameters).map(([name, schema]) => [
      name,
      parseParamSchema(schema, `${fieldPath}.parameters.${name}`),
    ]),
  );

  return {
    name: readRequiredString(value.name, `${fieldPath}.name`),
    displayName: readRequiredString(value.displayName, `${fieldPath}.displayName`),
    description: readRequiredString(value.description, `${fieldPath}.description`),
    whenToUse: readRequiredString(value.whenToUse, `${fieldPath}.whenToUse`),
    whenNotToUse: readRequiredString(value.whenNotToUse, `${fieldPath}.whenNotToUse`),
    category: readRequiredString(value.category, `${fieldPath}.category`),
    ...(Array.isArray(value.tags)
      ? {
          tags: value.tags.filter((entry): entry is string => typeof entry === "string"),
        }
      : {}),
    parameters,
    governance: parseGovernance(value.governance, `${fieldPath}.governance`),
    executionConfig: parseExecutionConfig(
      value.executionConfig,
      `${fieldPath}.executionConfig`,
    ),
  };
};

export const parseCapabilityDefinitions = (
  context: IExecuteFunctions,
  itemIndex = 0,
): CapabilityDefinition[] => {
  const rawValue = context.getNodeParameter("capabilityDefinitionsJson", itemIndex);
  const definitions =
    parseOptionalJsonArray(
      normalizeJsonParameter(rawValue, "[]"),
      "Capability Definitions JSON",
    ) ?? [];

  return definitions.map((definition, index) =>
    parseCapabilityDefinition(definition, index),
  );
};

export const parseCapabilityParams = (
  context: IExecuteFunctions,
  itemIndex = 0,
): Record<string, unknown> => {
  const rawValue = context.getNodeParameter("capabilityParamsJson", itemIndex, "{}");
  return (
    parseOptionalJsonObject(
      normalizeJsonParameter(rawValue, "{}"),
      "Capability Params JSON",
    ) ?? {}
  );
};

export const readAuditContext = (
  context: IExecuteFunctions,
  itemIndex = 0,
): AuditContext => {
  const userId = String(context.getNodeParameter("auditUserId", itemIndex, "anonymous"));
  const sessionIdRaw = String(context.getNodeParameter("auditSessionId", itemIndex, ""));
  return {
    userId: userId.trim() === "" ? "anonymous" : userId,
    sessionId: sessionIdRaw.trim() === "" ? randomUUID() : sessionIdRaw,
  };
};

export const assertCapabilityAllowedForAgent = (
  context: IExecuteFunctions,
  capability: CapabilityDefinition,
): void => {
  if (capability.executionConfig.providerType === "tools") {
    const operation = capability.executionConfig.operation.toLowerCase();
    for (const forbidden of FORBIDDEN_CAPABILITY_RESOURCES) {
      if (operation.includes(forbidden.toLowerCase())) {
        throw new NodeOperationError(
          context.getNode(),
          `Capability "${capability.name}" exposes a forbidden administration operation.`,
        );
      }
    }
  }
};
