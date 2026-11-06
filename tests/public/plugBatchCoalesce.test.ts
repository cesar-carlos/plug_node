import { describe, expect, it } from "vitest";

import { PlugValidationError } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";
import {
  buildCoalescedBatchRequest,
  MAX_COALESCED_BATCH_COMMANDS,
  shouldCoalesceBatchInputItems,
} from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugBatchCoalesce";
import { createMockExecuteContext } from "../helpers/mockExecuteFunctions";
import { resolvePlugExecutionContext } from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugCommandRequestBuilder";

const credentials = {
  user: "client@example.com",
  password: "secret",
  agentId: "agent-1",
  clientToken: "client-token",
  baseUrl: "https://plug-server.example.com/api/v1",
};

describe("plugBatchCoalesce", () => {
  it.each([
    { agentId: ["agent-1", "agent-2"] },
    { clientToken: ["fixture-one", "fixture-two"] },
    { operation: ["executeBatch", "executeSql"] },
    { inputMode: ["guided", "advanced"] },
    { channel: ["rest", "socket"] },
  ])("rejects incompatible coalesced contexts (%j)", (overrides) => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "executeBatch",
        inputMode: "guided",
        channel: "rest",
        batchCommandsJson: '[{"sql":"SELECT 1"}]',
        ...overrides,
      },
      inputData: [{ json: {} }, { json: {} }],
      responses: [],
    });
    expect(() =>
      buildCoalescedBatchRequest({
        context,
        credentialDefaults: credentials,
        config: { supportsSocket: true },
        resolveExecutionContext: resolvePlugExecutionContext,
        finalizeBuiltRequest: (request) => request,
      }),
    ).toThrow(/Coalesce Input Items requires/);
  });

  it("disables coalescing when continueOnFail needs per-item errors", () => {
    const context = createMockExecuteContext({
      credentials,
      continueOnFail: true,
      parameters: {
        operation: "executeBatch",
        batchOptions: { coalesceInputItems: true },
      },
      responses: [],
    });
    expect(shouldCoalesceBatchInputItems(context, 0)).toBe(false);
  });

  it.each([33, 150000])("rejects %s commands before mapping their contents", (count) => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "executeBatch",
        batchCommandsJson: JSON.stringify(Array(count).fill(null)),
      },
      responses: [],
    });
    expect(() =>
      buildCoalescedBatchRequest({
        context,
        credentialDefaults: credentials,
        config: { supportsSocket: false },
        resolveExecutionContext: resolvePlugExecutionContext,
        finalizeBuiltRequest: (request) => request,
      }),
    ).toThrow(/exceeds 32 commands/);
  });
  it("detects coalesce flag on executeBatch", () => {
    const enabled = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "executeBatch",
        inputMode: "guided",
        batchCommandsJson: '[{"sql":"SELECT TOP 1 * FROM Cliente"}]',
        batchOptions: { coalesceInputItems: true },
      },
      responses: [],
    });

    expect(shouldCoalesceBatchInputItems(enabled, 0)).toBe(true);
  });

  it("defaults coalesce to true when flag is unset and auto hints are on", () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "executeBatch",
        inputMode: "guided",
        batchCommandsJson: '[{"sql":"SELECT TOP 1 * FROM Cliente"}]',
        batchOptions: { autoPerformanceHints: true },
      },
      responses: [],
    });

    expect(shouldCoalesceBatchInputItems(context, 0)).toBe(true);
  });

  it("defaults coalesce to false when flag is unset and auto hints are off", () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "executeBatch",
        inputMode: "guided",
        batchCommandsJson: '[{"sql":"SELECT TOP 1 * FROM Cliente"}]',
        batchOptions: { autoPerformanceHints: false },
      },
      responses: [],
    });

    expect(shouldCoalesceBatchInputItems(context, 0)).toBe(false);
  });

  it("honors explicit coalesceInputItems false", () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "executeBatch",
        inputMode: "guided",
        batchCommandsJson: '[{"sql":"SELECT TOP 1 * FROM Cliente"}]',
        batchOptions: { coalesceInputItems: false, autoPerformanceHints: true },
      },
      responses: [],
    });

    expect(shouldCoalesceBatchInputItems(context, 0)).toBe(false);
  });

  it("merges batch commands from multiple input items", () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "executeBatch",
        inputMode: "guided",
        channel: "rest",
        batchCommandsJson: [
          '[{"sql":"SELECT TOP 1 * FROM Cliente"}]',
          '[{"sql":"SELECT TOP 1 * FROM Vendedor"}]',
        ],
        batchOptions: { coalesceInputItems: true },
      },
      inputData: [{ json: { a: 1 } }, { json: { b: 2 } }],
      responses: [],
    });

    const { builtRequest, coalescedItemCount } = buildCoalescedBatchRequest({
      context,
      credentialDefaults: credentials,
      config: { supportsSocket: false },
      resolveExecutionContext: () => ({
        ...credentials,
        resolvedAgentId: "agent-1",
        resolvedClientToken: "client-token",
      }),
      finalizeBuiltRequest: (builtRequest) => builtRequest,
    });

    expect(coalescedItemCount).toBe(2);
    expect(builtRequest.command).toMatchObject({
      method: "sql.executeBatch",
      params: {
        commands: [
          { sql: "SELECT TOP 1 * FROM Cliente" },
          { sql: "SELECT TOP 1 * FROM Vendedor" },
        ],
      },
    });
  });

  it("rejects mismatched batch options across items", () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "executeBatch",
        inputMode: "guided",
        batchCommandsJson: [
          '[{"sql":"SELECT TOP 1 * FROM Cliente"}]',
          '[{"sql":"SELECT TOP 1 * FROM Vendedor"}]',
        ],
        batchOptions: [
          { coalesceInputItems: true },
          { coalesceInputItems: true, transaction: true },
        ],
      },
      inputData: [{ json: {} }, { json: {} }],
      responses: [],
    });

    expect(() =>
      buildCoalescedBatchRequest({
        context,
        credentialDefaults: credentials,
        config: { supportsSocket: false },
        resolveExecutionContext: () => ({
          ...credentials,
          resolvedAgentId: "agent-1",
          resolvedClientToken: "client-token",
        }),
        finalizeBuiltRequest: (builtRequest) => builtRequest,
      }),
    ).toThrow(PlugValidationError);
  });

  it("enforces the coalesced command ceiling", () => {
    const commands = Array.from(
      { length: MAX_COALESCED_BATCH_COMMANDS + 1 },
      (_, index) => ({
        sql: `SELECT TOP 1 * FROM Cliente WHERE CodCliente = ${index + 1}`,
      }),
    );

    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "executeBatch",
        inputMode: "guided",
        batchCommandsJson: JSON.stringify(commands),
        batchOptions: { coalesceInputItems: true },
      },
      responses: [],
    });

    expect(() =>
      buildCoalescedBatchRequest({
        context,
        credentialDefaults: credentials,
        config: { supportsSocket: false },
        resolveExecutionContext: () => ({
          ...credentials,
          resolvedAgentId: "agent-1",
          resolvedClientToken: "client-token",
        }),
        finalizeBuiltRequest: (builtRequest) => builtRequest,
      }),
    ).toThrow(new RegExp(`exceeds ${MAX_COALESCED_BATCH_COMMANDS} commands`, "i"));
  });
});
