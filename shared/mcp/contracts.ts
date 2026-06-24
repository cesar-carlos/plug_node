export type ParamType = "string" | "number" | "boolean" | "object";

export interface ParamSchema {
  readonly type: ParamType;
  readonly description: string;
  readonly required?: boolean;
  readonly default?: unknown;
  readonly maximum?: number;
  readonly minimum?: number;
}

export interface GovernanceConfig {
  readonly requireAtLeastOneFilter?: boolean;
  readonly filterParamNames?: readonly string[];
  readonly maxRows: number;
  readonly maskedColumns?: readonly string[];
}

export type CapabilityProviderType = "sql" | "tools";

export interface SqlCapabilityExecutionConfig {
  readonly providerType: "sql";
  readonly sql: string;
  readonly channel: "rest" | "socket";
  readonly maxRows: number;
  readonly agentId?: string;
  readonly clientToken?: string;
}

export interface ToolsCapabilityExecutionConfig {
  readonly providerType: "tools";
  readonly operation: string;
  readonly staticParams?: Readonly<Record<string, unknown>>;
  readonly agentId?: string;
  readonly clientToken?: string;
}

export type CapabilityExecutionConfig =
  | SqlCapabilityExecutionConfig
  | ToolsCapabilityExecutionConfig;

export interface CapabilityDefinition {
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly whenToUse: string;
  readonly whenNotToUse: string;
  readonly category: string;
  readonly tags?: readonly string[];
  readonly parameters: Readonly<Record<string, ParamSchema>>;
  readonly governance: GovernanceConfig;
  readonly executionConfig: CapabilityExecutionConfig;
}

export type ValidationResult =
  | { readonly ok: true; readonly coerced: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly error: string };

export type GovernanceResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

export interface McpMeta {
  readonly capability: string;
  readonly rowCount?: number;
  readonly truncated?: boolean;
  readonly executionMs?: number;
  readonly emptyResult?: boolean;
}

export interface McpTextContent {
  readonly type: "text";
  readonly text: string;
}

export interface McpCallResponse {
  readonly content: readonly [McpTextContent];
  readonly meta: McpMeta;
  readonly isError?: true;
}

export interface ToolInputSchemaProperty {
  readonly type: string;
  readonly description: string;
  readonly default?: unknown;
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface ToolSchema {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: "object";
    readonly properties: Readonly<Record<string, ToolInputSchemaProperty>>;
    readonly required?: readonly string[];
  };
}

export interface AuditContext {
  readonly userId: string;
  readonly sessionId: string;
}

export interface AuditEntry {
  readonly capability: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly userId: string;
  readonly sessionId: string;
  readonly timestamp: string;
  readonly durationMs: number;
  readonly rowCount?: number;
  readonly emptyResult?: boolean;
  readonly truncated?: boolean;
  readonly isError?: boolean;
  readonly errorMessage?: string;
}

export type McpServerMode = "list" | "call";

export interface SystemPromptConfig {
  readonly identity: string;
  readonly scope: string;
  readonly maxToolCallsPerTurn: number;
  readonly sensitiveDataRules?: string;
  readonly operationalLimits?: string;
}

export const MCP_PROTOCOL_VERSION = "2024-11-05" as const;

export const FORBIDDEN_CAPABILITY_RESOURCES = ["clientAccess", "userAccess"] as const;
