import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotEnv } from "dotenv";

import type { PlugCredentials } from "../../../packages/n8n-nodes-plug-database/generated/shared/contracts/api";
import { DEFAULT_BASE_URL } from "../../../packages/n8n-nodes-plug-database/generated/shared/contracts/api";

export type PlugE2EStressChannel = "rest" | "socket";

export interface PlugE2EStressConfig {
  readonly concurrency: number;
  readonly requestCount: number;
  readonly minSuccessRatio: number;
  readonly channels: readonly PlugE2EStressChannel[];
}

export interface PlugE2EConfig {
  readonly credentials: PlugCredentials;
  readonly socketCredentials: PlugCredentials;
  readonly timeoutMs: number;
  readonly sqlQueries: readonly string[];
  readonly emptySqlQuery: string;
  readonly deniedResource?: string;
  readonly unauthorizedSqlQuery: string;
  readonly invalidSqlQuery: string;
  readonly multiResultSuccessSqlQuery: string;
  readonly multiResultMixedSqlQuery: string;
  readonly bulkInsertParamsJson?: string;
  readonly batchCommandsJson: string;
  readonly hubOptionsSqlQuery: string;
  readonly cancelExecutionId?: string;
  readonly cancelRequestId?: string;
  readonly stress?: PlugE2EStressConfig;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../../..");
const envPath = path.join(workspaceRoot, ".env");

const defaultClienteQuery = "SELECT TOP 10 * FROM Cliente";
const defaultVendedorQuery = "SELECT TOP 10 * FROM Vendedor";
const defaultProdutoQuery = "SELECT TOP 10 * FROM Produto";
const defaultInvalidSqlQuery = "SELECT FROM Cliente";
const defaultMultiResultSuccessSqlQuery =
  "SELECT TOP 5 * FROM Cliente; SELECT TOP 5 * FROM Vendedor";
const defaultEmptySqlQuery = "SELECT * FROM Cliente WHERE 1=0";
const defaultBatchCommandsJson =
  '[{"sql":"SELECT TOP 1 * FROM Cliente"},{"sql":"SELECT TOP 1 * FROM Vendedor"}]';
const defaultHubOptionsSqlQuery = "SELECT TOP 100 * FROM Cliente ORDER BY CodCliente";
const defaultDeniedResource = "Empresa";
const defaultStressConcurrency = 4;
const defaultStressRequestCount = 12;
const defaultStressMinSuccessRatio = 0.25;
const maxStressConcurrency = 25;
const maxStressRequestCount = 60;

let cachedConfig: PlugE2EConfig | undefined;

const getRequiredEnv = (name: string): string => {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `Missing required E2E environment variable ${name}. Copy .env.example to .env and fill in the credentials before running npm run test:e2e.`,
    );
  }

  return value.trim();
};

const getOptionalEnv = (name: string): string | undefined => {
  const value = process.env[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
};

const getOptionalQuery = (name: string, fallback: string): string => {
  const value = process.env[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
};

const parsePositiveIntEnv = (name: string, fallback: number, max: number): number => {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return Math.min(max, parsed);
};

const parseRatioEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    throw new Error(`${name} must be a number between 0 and 1 (exclusive of 0).`);
  }

  return parsed;
};

const parseStressChannels = (): readonly PlugE2EStressChannel[] => {
  const raw = getOptionalEnv("PLUG_E2E_STRESS_CHANNELS");
  if (!raw) {
    return ["rest", "socket"];
  }

  const channels = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  const normalized: PlugE2EStressChannel[] = [];
  for (const channel of channels) {
    if (channel === "rest" || channel === "socket") {
      if (!normalized.includes(channel)) {
        normalized.push(channel);
      }
      continue;
    }

    throw new Error(
      "PLUG_E2E_STRESS_CHANNELS must be a comma-separated list of rest and/or socket.",
    );
  }

  if (normalized.length === 0) {
    throw new Error("PLUG_E2E_STRESS_CHANNELS must include at least one channel.");
  }

  return normalized;
};

const parseStressConfig = (): PlugE2EStressConfig | undefined => {
  const enabledRaw = process.env.PLUG_E2E_STRESS_ENABLED;
  const enabled =
    enabledRaw === "1" || enabledRaw?.toLowerCase() === "true" || enabledRaw === "yes";
  if (!enabled) {
    return undefined;
  }

  return {
    concurrency: parsePositiveIntEnv(
      "PLUG_E2E_STRESS_CONCURRENCY",
      defaultStressConcurrency,
      maxStressConcurrency,
    ),
    requestCount: parsePositiveIntEnv(
      "PLUG_E2E_STRESS_REQUEST_COUNT",
      defaultStressRequestCount,
      maxStressRequestCount,
    ),
    minSuccessRatio: parseRatioEnv(
      "PLUG_E2E_STRESS_MIN_SUCCESS_RATIO",
      defaultStressMinSuccessRatio,
    ),
    channels: parseStressChannels(),
  };
};

const parseTimeoutMs = (): number => {
  const raw = process.env.PLUG_E2E_TIMEOUT_MS;
  if (!raw) {
    return 30_000;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("PLUG_E2E_TIMEOUT_MS must be a positive number.");
  }

  return parsed;
};

const getOptionalSqlQueries = (): readonly string[] => {
  const cliente = getOptionalQuery("PLUG_E2E_SQL_QUERY_CLIENTE", defaultClienteQuery);
  const vendedor =
    getOptionalEnv("PLUG_E2E_SQL_QUERY_VENDEDOR") ??
    getOptionalEnv("PLUG_E2E_SQL_QUERY_MARCA") ??
    defaultVendedorQuery;
  const produto =
    getOptionalEnv("PLUG_E2E_SQL_QUERY_PRODUTO") ??
    getOptionalEnv("PLUG_E2E_SQL_QUERY_GRUPO_PRODUTO") ??
    defaultProdutoQuery;

  return [cliente, vendedor, produto];
};

const buildUnauthorizedQuery = (deniedResource: string | undefined): string => {
  const fromEnv = getOptionalEnv("PLUG_E2E_SQL_QUERY_UNAUTHORIZED");
  if (fromEnv) {
    return fromEnv;
  }

  if (deniedResource) {
    return `SELECT TOP 1 * FROM ${deniedResource}`;
  }

  return `SELECT TOP 1 * FROM ${defaultDeniedResource}`;
};

const buildMultiResultMixedQuery = (deniedResource: string | undefined): string => {
  const fromEnv = getOptionalEnv("PLUG_E2E_SQL_QUERY_MULTI_RESULT_MIXED");
  if (fromEnv) {
    return fromEnv;
  }

  const denied = deniedResource ?? defaultDeniedResource;
  return `SELECT TOP 5 * FROM Cliente; SELECT TOP 5 * FROM ${denied}`;
};

export const getPlugE2EConfig = (): PlugE2EConfig => {
  if (cachedConfig) {
    return cachedConfig;
  }

  if (!existsSync(envPath)) {
    throw new Error(
      `Missing ${envPath}. Copy .env.example to .env and provide the Plug test credentials before running E2E tests.`,
    );
  }

  loadDotEnv({ path: envPath, quiet: true });

  const credentials: PlugCredentials = {
    user: getRequiredEnv("PLUG_E2E_USER"),
    password: getRequiredEnv("PLUG_E2E_PASSWORD"),
    agentId: getRequiredEnv("PLUG_E2E_AGENT_ID"),
    clientToken: getRequiredEnv("PLUG_E2E_CLIENT_TOKEN"),
    baseUrl:
      process.env.PLUG_E2E_BASE_URL && process.env.PLUG_E2E_BASE_URL.trim() !== ""
        ? process.env.PLUG_E2E_BASE_URL.trim()
        : DEFAULT_BASE_URL,
  };

  const deniedResource = getOptionalEnv("PLUG_E2E_DENIED_RESOURCE");
  const stress = parseStressConfig();

  cachedConfig = {
    credentials,
    socketCredentials: {
      ...credentials,
      agentId: getOptionalEnv("PLUG_E2E_SOCKET_AGENT_ID") ?? credentials.agentId,
      clientToken:
        getOptionalEnv("PLUG_E2E_SOCKET_CLIENT_TOKEN") ?? credentials.clientToken,
    },
    timeoutMs: parseTimeoutMs(),
    sqlQueries: getOptionalSqlQueries(),
    emptySqlQuery: getOptionalQuery("PLUG_E2E_SQL_QUERY_EMPTY", defaultEmptySqlQuery),
    ...(deniedResource ? { deniedResource } : {}),
    unauthorizedSqlQuery: buildUnauthorizedQuery(deniedResource),
    invalidSqlQuery: getOptionalQuery(
      "PLUG_E2E_SQL_QUERY_INVALID",
      defaultInvalidSqlQuery,
    ),
    multiResultSuccessSqlQuery: getOptionalQuery(
      "PLUG_E2E_SQL_QUERY_MULTI_RESULT_SUCCESS",
      defaultMultiResultSuccessSqlQuery,
    ),
    multiResultMixedSqlQuery: buildMultiResultMixedQuery(deniedResource),
    batchCommandsJson: getOptionalQuery(
      "PLUG_E2E_BATCH_COMMANDS_JSON",
      defaultBatchCommandsJson,
    ),
    hubOptionsSqlQuery: getOptionalQuery(
      "PLUG_E2E_SQL_HUB_OPTIONS_QUERY",
      defaultHubOptionsSqlQuery,
    ),
    ...(getOptionalEnv("PLUG_E2E_BULK_INSERT_JSON")
      ? { bulkInsertParamsJson: getOptionalEnv("PLUG_E2E_BULK_INSERT_JSON") }
      : {}),
    ...(getOptionalEnv("PLUG_E2E_CANCEL_EXECUTION_ID")
      ? { cancelExecutionId: getOptionalEnv("PLUG_E2E_CANCEL_EXECUTION_ID") }
      : {}),
    ...(getOptionalEnv("PLUG_E2E_CANCEL_REQUEST_ID")
      ? { cancelRequestId: getOptionalEnv("PLUG_E2E_CANCEL_REQUEST_ID") }
      : {}),
    ...(stress ? { stress } : {}),
  };

  return cachedConfig;
};
