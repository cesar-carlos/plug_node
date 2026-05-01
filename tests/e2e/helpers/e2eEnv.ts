import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotEnv } from "dotenv";

import type { PlugCredentials } from "../../../packages/n8n-nodes-plug-client/generated/shared/contracts/api";
import { DEFAULT_BASE_URL } from "../../../packages/n8n-nodes-plug-client/generated/shared/contracts/api";

export interface PlugE2EConfig {
  readonly credentials: PlugCredentials;
  readonly timeoutMs: number;
  readonly sqlQueries: readonly string[];
  readonly multiResultSuccessSqlQuery: string;
  readonly multiResultMixedSqlQuery: string;
  readonly unauthorizedSqlQuery: string;
  readonly invalidSqlQuery: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../../..");
const envPath = path.join(workspaceRoot, ".env");

const defaultSqlQueries = [
  "SELECT * FROM Cliente",
  "SELECT * FROM Marca",
  "SELECT * FROM GrupoProduto",
] as const;

const defaultUnauthorizedSqlQuery = "SELECT * FROM Empresa";
const defaultInvalidSqlQuery = "SELECT FROM Cliente";
const defaultMultiResultSuccessSqlQuery = "SELECT * FROM Cliente; SELECT * FROM Marca";
const defaultMultiResultMixedSqlQuery = "SELECT * FROM Cliente; SELECT * FROM Empresa";

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

const getOptionalSqlQueries = (): readonly string[] => {
  const fromEnv = [
    process.env.PLUG_E2E_SQL_QUERY_CLIENTE,
    process.env.PLUG_E2E_SQL_QUERY_MARCA,
    process.env.PLUG_E2E_SQL_QUERY_GRUPO_PRODUTO,
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value !== "");

  return fromEnv.length > 0 ? fromEnv : defaultSqlQueries;
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

const getOptionalQuery = (name: string, fallback: string): string => {
  const value = process.env[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
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

  cachedConfig = {
    credentials: {
      user: getRequiredEnv("PLUG_E2E_USER"),
      password: getRequiredEnv("PLUG_E2E_PASSWORD"),
      agentId: getRequiredEnv("PLUG_E2E_AGENT_ID"),
      clientToken: getRequiredEnv("PLUG_E2E_CLIENT_TOKEN"),
      baseUrl:
        process.env.PLUG_E2E_BASE_URL && process.env.PLUG_E2E_BASE_URL.trim() !== ""
          ? process.env.PLUG_E2E_BASE_URL.trim()
          : DEFAULT_BASE_URL,
    },
    timeoutMs: parseTimeoutMs(),
    sqlQueries: getOptionalSqlQueries(),
    multiResultSuccessSqlQuery: getOptionalQuery(
      "PLUG_E2E_SQL_QUERY_MULTI_RESULT_SUCCESS",
      defaultMultiResultSuccessSqlQuery,
    ),
    multiResultMixedSqlQuery: getOptionalQuery(
      "PLUG_E2E_SQL_QUERY_MULTI_RESULT_MIXED",
      defaultMultiResultMixedSqlQuery,
    ),
    unauthorizedSqlQuery: getOptionalQuery(
      "PLUG_E2E_SQL_QUERY_UNAUTHORIZED",
      defaultUnauthorizedSqlQuery,
    ),
    invalidSqlQuery: getOptionalQuery(
      "PLUG_E2E_SQL_QUERY_INVALID",
      defaultInvalidSqlQuery,
    ),
  };

  return cachedConfig;
};
