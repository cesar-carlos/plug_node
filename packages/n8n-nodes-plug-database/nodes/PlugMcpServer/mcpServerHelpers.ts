import { randomUUID } from "node:crypto";

import type {
  IExecuteFunctions,
  ILoadOptionsFunctions,
  INodePropertyOptions,
  ResourceMapperFields,
  ResourceMapperValue,
} from "n8n-workflow";

import type {
  AuditContext,
  CapabilityDefinition,
  CapabilityExecutionConfig,
  GovernanceConfig,
  ParamSchema,
  ParamType,
} from "../../generated/shared/mcp/contracts";
import {
  filterForbiddenCapabilityNames,
  isCapabilityForbiddenForAgent,
} from "../../generated/shared/mcp/forbiddenCapabilities";
import { buildRegistry } from "../../generated/shared/mcp/registry";
import { listNamedSqlParameters } from "../../generated/shared/n8n/plugSqlGuidedCommands";
import {
  isRecord,
  normalizeJsonParameter,
  parseOptionalJsonArray,
  parseOptionalJsonObject,
} from "../../generated/shared/utils/json";

const readRequiredString = (value: unknown, fieldPath: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldPath} must be a non-empty string.`);
  }

  return value;
};

const splitCsv = (value: unknown): string[] => {
  if (typeof value !== "string" || value.trim() === "") {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
};

const isParamType = (value: unknown): value is ParamType =>
  value === "string" || value === "number" || value === "boolean" || value === "object";

const coerceDefaultValue = (raw: unknown, type: ParamType): unknown => {
  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }

  if (type === "number") {
    const parsed = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  if (type === "boolean") {
    if (typeof raw === "boolean") {
      return raw;
    }
    if (raw === "true") {
      return true;
    }
    if (raw === "false") {
      return false;
    }
    return undefined;
  }

  if (type === "object") {
    if (isRecord(raw)) {
      return raw;
    }
    if (typeof raw === "string" && raw.trim() !== "") {
      try {
        const parsed: unknown = JSON.parse(raw);
        return isRecord(parsed) ? parsed : undefined;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  return String(raw);
};

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
    ...(Number.isFinite(value.maximum) ? { maximum: value.maximum as number } : {}),
    ...(Number.isFinite(value.minimum) ? { minimum: value.minimum as number } : {}),
  };
};

const parsePositiveIntegerMaxRows = (value: unknown, fieldPath: string): number => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldPath}.maxRows must be a positive integer.`);
  }

  return parsed;
};

const parseGovernance = (value: unknown, fieldPath: string): GovernanceConfig => {
  if (!isRecord(value)) {
    throw new Error(`${fieldPath} must be an object.`);
  }

  const maxRows = parsePositiveIntegerMaxRows(value.maxRows, fieldPath);

  if (maxRows > 1000) {
    throw new Error(`${fieldPath}.maxRows must be at most 1000.`);
  }

  return {
    maxRows,
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
    const maxRows = parsePositiveIntegerMaxRows(value.maxRows, fieldPath);

    return {
      providerType: "sql",
      sql: value.sql,
      channel,
      maxRows,
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
    };
  }

  throw new Error(`${fieldPath}.providerType must be "sql" or "tools".`);
};

const applyCrossValidations = (
  fieldPath: string,
  parameters: Readonly<Record<string, ParamSchema>>,
  governance: GovernanceConfig,
  executionConfig: CapabilityExecutionConfig,
): void => {
  if (governance.filterParamNames) {
    for (const name of governance.filterParamNames) {
      if (!(name in parameters)) {
        throw new Error(
          `${fieldPath}.governance.filterParamNames includes "${name}" which is not defined in parameters.`,
        );
      }
    }
  }

  if (executionConfig.providerType === "sql") {
    for (const binding of listNamedSqlParameters(executionConfig.sql)) {
      if (!(binding in parameters)) {
        throw new Error(
          `${fieldPath}.executionConfig.sql references ":${binding}" which is not defined in parameters.`,
        );
      }
    }
  }
};

export const parseCapabilityDefinition = (
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

  const governance = parseGovernance(value.governance, `${fieldPath}.governance`);
  const executionConfig = parseExecutionConfig(
    value.executionConfig,
    `${fieldPath}.executionConfig`,
  );

  applyCrossValidations(fieldPath, parameters, governance, executionConfig);

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
    governance,
    executionConfig,
  };
};

const parseVisualParameterRow = (
  value: unknown,
  fieldPath: string,
): { readonly name: string; readonly schema: ParamSchema } => {
  if (!isRecord(value)) {
    throw new Error(`${fieldPath} must be an object.`);
  }

  const name = readRequiredString(value.name, `${fieldPath}.name`);
  if (!isParamType(value.type)) {
    throw new Error(`${fieldPath}.type must be string, number, boolean, or object.`);
  }

  const description = readRequiredString(value.description, `${fieldPath}.description`);
  const defaultValue = coerceDefaultValue(value.defaultValue, value.type);

  const schema: ParamSchema = {
    type: value.type,
    description,
    ...(value.required === true ? { required: true } : {}),
    ...(defaultValue !== undefined ? { default: defaultValue } : {}),
    ...(value.type === "number" && Number.isFinite(value.minimum)
      ? { minimum: value.minimum as number }
      : {}),
    ...(value.type === "number" && Number.isFinite(value.maximum)
      ? { maximum: value.maximum as number }
      : {}),
  };

  return { name, schema };
};

const parseVisualCapabilityRow = (
  value: unknown,
  index: number,
): CapabilityDefinition => {
  const fieldPath = `Capability builder entry at index ${index}`;
  if (!isRecord(value)) {
    throw new Error(`${fieldPath} must be an object.`);
  }

  const parameterRows =
    isRecord(value.parameters) && Array.isArray(value.parameters.values)
      ? value.parameters.values
      : [];

  const parameters = Object.fromEntries(
    parameterRows.map((row, paramIndex) => {
      const parsed = parseVisualParameterRow(
        row,
        `${fieldPath}.parameters.values[${paramIndex}]`,
      );
      return [parsed.name, parsed.schema];
    }),
  );

  const providerType = value.providerType === "tools" ? "tools" : "sql";
  const maxRows = parsePositiveIntegerMaxRows(value.maxRows, `${fieldPath}`);
  if (maxRows > 1000) {
    throw new Error(`${fieldPath}.maxRows must be at most 1000.`);
  }

  const governance: GovernanceConfig = {
    maxRows,
    ...(value.requireAtLeastOneFilter === true ? { requireAtLeastOneFilter: true } : {}),
    ...(splitCsv(value.filterParamNames).length > 0
      ? { filterParamNames: splitCsv(value.filterParamNames) }
      : {}),
    ...(splitCsv(value.maskedColumns).length > 0
      ? { maskedColumns: splitCsv(value.maskedColumns) }
      : {}),
  };

  let executionConfig: CapabilityExecutionConfig;
  if (providerType === "sql") {
    executionConfig = {
      providerType: "sql",
      sql: readRequiredString(value.sql, `${fieldPath}.sql`),
      channel: value.channel === "socket" ? "socket" : "rest",
      maxRows: parsePositiveIntegerMaxRows(
        value.executionMaxRows ?? value.maxRows,
        `${fieldPath}.executionMaxRows`,
      ),
    };
  } else {
    const staticParams =
      parseOptionalJsonObject(
        normalizeJsonParameter(value.staticParamsJson, "{}"),
        `${fieldPath}.staticParamsJson`,
      ) ?? {};
    executionConfig = {
      providerType: "tools",
      operation: readRequiredString(value.toolsOperation, `${fieldPath}.toolsOperation`),
      ...(Object.keys(staticParams).length > 0 ? { staticParams } : {}),
    };
  }

  applyCrossValidations(fieldPath, parameters, governance, executionConfig);

  const tags = splitCsv(value.tags);

  return {
    name: readRequiredString(value.name, `${fieldPath}.name`),
    displayName: readRequiredString(value.displayName, `${fieldPath}.displayName`),
    description: readRequiredString(value.description, `${fieldPath}.description`),
    whenToUse: readRequiredString(value.whenToUse, `${fieldPath}.whenToUse`),
    whenNotToUse: readRequiredString(value.whenNotToUse, `${fieldPath}.whenNotToUse`),
    category: readRequiredString(value.category, `${fieldPath}.category`),
    ...(tags.length > 0 ? { tags } : {}),
    parameters,
    governance,
    executionConfig,
  };
};

export const parseCapabilityDefinitionsFromRaw = (
  authoringMode: unknown,
  capabilityDefinitionsJson: unknown,
  capabilitiesBuilder: unknown,
): CapabilityDefinition[] => {
  if (authoringMode === "visual") {
    const rows =
      isRecord(capabilitiesBuilder) && Array.isArray(capabilitiesBuilder.values)
        ? capabilitiesBuilder.values
        : [];
    return rows.map((row, index) => parseVisualCapabilityRow(row, index));
  }

  const definitions =
    parseOptionalJsonArray(
      normalizeJsonParameter(capabilityDefinitionsJson, "[]"),
      "Capability Definitions JSON",
    ) ?? [];

  return definitions.map((definition, index) =>
    parseCapabilityDefinition(definition, index),
  );
};

export const parseCapabilityDefinitions = (
  context: IExecuteFunctions,
  itemIndex = 0,
): CapabilityDefinition[] => {
  const authoringMode = context.getNodeParameter("authoringMode", itemIndex, "json");
  const capabilityDefinitionsJson = context.getNodeParameter(
    "capabilityDefinitionsJson",
    itemIndex,
    "[]",
  );
  const capabilitiesBuilder = context.getNodeParameter(
    "capabilitiesBuilder",
    itemIndex,
    {},
  );

  return parseCapabilityDefinitionsFromRaw(
    authoringMode,
    capabilityDefinitionsJson,
    capabilitiesBuilder,
  );
};

const isResourceMapperValue = (value: unknown): value is ResourceMapperValue =>
  isRecord(value) && "mappingMode" in value && "value" in value;

export const parseCapabilityParamsFromRaw = (
  paramsInputMode: unknown,
  capabilityParamsJson: unknown,
  capabilityParamsMapper: unknown,
): Record<string, unknown> => {
  if (paramsInputMode === "mapper") {
    if (!isResourceMapperValue(capabilityParamsMapper)) {
      return {};
    }

    const mapped = capabilityParamsMapper.value;
    if (!isRecord(mapped)) {
      return {};
    }

    return { ...mapped };
  }

  return (
    parseOptionalJsonObject(
      normalizeJsonParameter(capabilityParamsJson, "{}"),
      "Capability Params JSON",
    ) ?? {}
  );
};

export const parseCapabilityParams = (
  context: IExecuteFunctions,
  itemIndex = 0,
): Record<string, unknown> => {
  const paramsInputMode = context.getNodeParameter("paramsInputMode", itemIndex, "json");
  const capabilityParamsJson = context.getNodeParameter(
    "capabilityParamsJson",
    itemIndex,
    "{}",
  );
  const capabilityParamsMapper = context.getNodeParameter(
    "capabilityParamsMapper",
    itemIndex,
    {
      mappingMode: "defineBelow",
      value: null,
    },
  );

  return parseCapabilityParamsFromRaw(
    paramsInputMode,
    capabilityParamsJson,
    capabilityParamsMapper,
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

export const assertCapabilityAllowedForAgent = (
  capability: CapabilityDefinition,
): void => {
  if (isCapabilityForbiddenForAgent(capability)) {
    throw new Error(
      `Capability "${capability.name}" exposes a forbidden administration operation.`,
    );
  }
};

export const readToolCallBudget = (
  context: IExecuteFunctions,
  itemIndex = 0,
): { readonly maxToolCallsPerTurn: number; readonly toolCallCount: number } => {
  const maxRaw = Number(context.getNodeParameter("maxToolCallsPerTurn", itemIndex, 0));
  const countRaw = Number(context.getNodeParameter("toolCallCount", itemIndex, 0));
  const maxToolCallsPerTurn =
    Number.isFinite(maxRaw) && maxRaw > 0 ? Math.trunc(maxRaw) : 0;
  const parsedCount =
    Number.isFinite(countRaw) && countRaw > 0 ? Math.trunc(countRaw) : 0;
  // When a hard max is configured but the workflow omits the counter, treat this
  // execution as call #1 so the budget is still enforced on subsequent wired calls.
  const toolCallCount =
    maxToolCallsPerTurn > 0 && parsedCount === 0 ? 1 : parsedCount;
  return { maxToolCallsPerTurn, toolCallCount };
};

export interface CapabilityDefinitionsValidationResult {
  readonly valid: boolean;
  readonly capabilityCount: number;
  readonly capabilities: ReadonlyArray<{
    readonly name: string;
    readonly displayName: string;
    readonly category: string;
    readonly providerType: string;
  }>;
  readonly error?: string;
  readonly forbiddenCapabilities?: readonly string[];
}

export const validateCapabilityDefinitionsResult = (
  definitions: readonly CapabilityDefinition[],
): CapabilityDefinitionsValidationResult => {
  const registry = buildRegistry(definitions);
  const forbiddenCapabilities = definitions
    .filter((capability) => isCapabilityForbiddenForAgent(capability))
    .map((capability) => capability.name);

  const capabilities = definitions.map((capability) => ({
    name: capability.name,
    displayName: capability.displayName,
    category: capability.category,
    providerType: capability.executionConfig.providerType,
  }));

  if (forbiddenCapabilities.length > 0) {
    return {
      valid: false,
      capabilityCount: registry.size,
      capabilities,
      forbiddenCapabilities,
      error: `Forbidden administration capabilities must be removed: ${forbiddenCapabilities.join(", ")}.`,
    };
  }

  return {
    valid: true,
    capabilityCount: registry.size,
    capabilities,
  };
};

export const listCapabilityNameOptions = (
  definitions: readonly CapabilityDefinition[],
): INodePropertyOptions[] =>
  definitions.map((capability) => ({
    name: `${capability.displayName} (${capability.name})`,
    value: capability.name,
    description: capability.description,
  }));

export const loadCapabilityNameOptions = (
  context: ILoadOptionsFunctions,
): INodePropertyOptions[] => {
  try {
    const authoringMode = context.getCurrentNodeParameter("authoringMode") ?? "json";
    const capabilityDefinitionsJson =
      context.getCurrentNodeParameter("capabilityDefinitionsJson") ?? "[]";
    const capabilitiesBuilder =
      context.getCurrentNodeParameter("capabilitiesBuilder") ?? {};
    const definitions = parseCapabilityDefinitionsFromRaw(
      authoringMode,
      capabilityDefinitionsJson,
      capabilitiesBuilder,
    );
    return listCapabilityNameOptions(definitions);
  } catch {
    return [
      {
        name: "Fix Capability Definitions To Load Names",
        value: "",
        description:
          "Capability definitions are currently invalid. Correct JSON/visual builder fields first.",
      },
    ];
  }
};

const toResourceMapperFieldType = (
  type: ParamType,
): "string" | "number" | "boolean" | "object" => type;

export const buildCapabilityParamResourceMapperFields = (
  capability: CapabilityDefinition | undefined,
): ResourceMapperFields => {
  if (!capability) {
    return {
      fields: [],
      emptyFieldsNotice:
        "Select a capability name first so parameter fields can be generated.",
    };
  }

  return {
    fields: Object.entries(capability.parameters).map(([name, schema]) => ({
      id: name,
      displayName: name,
      defaultMatch: false,
      canBeUsedToMatch: false,
      required: schema.required === true,
      display: true,
      type: toResourceMapperFieldType(schema.type),
      ...(schema.default !== undefined &&
      (typeof schema.default === "string" ||
        typeof schema.default === "number" ||
        typeof schema.default === "boolean" ||
        schema.default === null)
        ? { defaultValue: schema.default }
        : {}),
    })),
  };
};

export const loadCapabilityParamResourceMapperFields = (
  context: ILoadOptionsFunctions,
): ResourceMapperFields => {
  try {
    const authoringMode = context.getCurrentNodeParameter("authoringMode") ?? "json";
    const capabilityDefinitionsJson =
      context.getCurrentNodeParameter("capabilityDefinitionsJson") ?? "[]";
    const capabilitiesBuilder =
      context.getCurrentNodeParameter("capabilitiesBuilder") ?? {};
    const capabilityName = String(
      context.getCurrentNodeParameter("capabilityName") ?? "",
    );
    const definitions = parseCapabilityDefinitionsFromRaw(
      authoringMode,
      capabilityDefinitionsJson,
      capabilitiesBuilder,
    );
    const capability = definitions.find((entry) => entry.name === capabilityName);
    return buildCapabilityParamResourceMapperFields(capability);
  } catch {
    return {
      fields: [],
      emptyFieldsNotice:
        "Capability definitions are currently invalid. Correct them before mapping parameters.",
    };
  }
};
