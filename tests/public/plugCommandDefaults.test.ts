import { describe, expect, it } from "vitest";

import { DEFAULT_API_VERSION } from "../../shared/contracts/api";
import type {
  PlugResolvedExecutionContext,
  RpcSingleCommand,
} from "../../shared/contracts/api";
import { applyCommandDefaults } from "../../shared/n8n/plugCommandDefaults";

const executionContext: PlugResolvedExecutionContext = {
  user: "client@example.com",
  password: "secret",
  baseUrl: "https://plug-server.example.com/api/v1",
  resolvedAgentId: "agent-1",
  resolvedClientToken: "client-token",
};

describe("applyCommandDefaults", () => {
  it("sets jsonrpc and default api_version on every command", () => {
    const command = applyCommandDefaults(
      { method: "rpc.discover" } as RpcSingleCommand,
      executionContext,
    );

    expect(command).toMatchObject({
      jsonrpc: "2.0",
      api_version: DEFAULT_API_VERSION,
      method: "rpc.discover",
    });
  });

  it("preserves an explicit api_version override", () => {
    const command = applyCommandDefaults(
      { method: "rpc.discover", api_version: "9.9" } as RpcSingleCommand,
      executionContext,
      "2.0",
    );

    expect(command.api_version).toBe("2.0");
  });

  it("injects client_token for sql.execute", () => {
    const command = applyCommandDefaults(
      {
        method: "sql.execute",
        params: { sql: "SELECT 1" },
      } as RpcSingleCommand,
      executionContext,
    );

    expect(command.params).toMatchObject({
      sql: "SELECT 1",
      client_token: "client-token",
    });
  });

  it("injects client_token for sql.executeBatch and sql.bulkInsert", () => {
    const batch = applyCommandDefaults(
      {
        method: "sql.executeBatch",
        params: { commands: [{ sql: "SELECT 1" }] },
      } as RpcSingleCommand,
      executionContext,
    );
    const bulk = applyCommandDefaults(
      {
        method: "sql.bulkInsert",
        params: { table: "Cliente", columns: ["CodCliente"], rows: [[1]] },
      } as RpcSingleCommand,
      executionContext,
    );

    expect(batch.params).toMatchObject({ client_token: "client-token" });
    expect(bulk.params).toMatchObject({ client_token: "client-token" });
  });

  it("merges client_token for agent.getProfile and client_token.getPolicy", () => {
    const profile = applyCommandDefaults(
      { method: "agent.getProfile" } as RpcSingleCommand,
      executionContext,
    );
    const policy = applyCommandDefaults(
      { method: "client_token.getPolicy" } as RpcSingleCommand,
      executionContext,
    );

    expect(profile.params).toEqual({ client_token: "client-token" });
    expect(policy.params).toEqual({ client_token: "client-token" });
  });

  it("merges meta when provided", () => {
    const command = applyCommandDefaults(
      { method: "rpc.discover" } as RpcSingleCommand,
      executionContext,
      undefined,
      { trace: "audit-1" },
    );

    expect(command.meta).toEqual({ trace: "audit-1" });
  });
});
