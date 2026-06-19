import { describe, expect, it, vi } from "vitest";
import type { IExecuteFunctions } from "n8n-workflow";

import {
  executeUtilityOperation,
  utilityOperationHandlers,
} from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugToolsUtilityHandlers";
import {
  plugToolBuildSocketEventPayloadOperation,
  plugToolBuildSqlRequestOperation,
  plugToolGenerateAccessRequestSummaryOperation,
  plugToolGenerateUuidOperation,
  plugToolNormalizeTextOperation,
  plugToolParseSqlRowsOperation,
  plugToolValidateAgentContextOperation,
  plugToolValidateClientTokenOperation,
} from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugToolsDescription";

const createContext = (
  parameters: Record<string, unknown>,
  inputJson: Record<string, unknown> = {},
): IExecuteFunctions =>
  ({
    getNodeParameter: (name: string, _itemIndex: number, fallback?: unknown) =>
      parameters[name] ?? fallback,
    getInputData: () => [{ json: inputJson }],
    helpers: {
      getBinaryDataBuffer: vi.fn(),
    },
  }) as unknown as IExecuteFunctions;

describe("plugToolsUtilityHandlers", () => {
  it("exposes a handler for every utility operation", () => {
    const operations = [
      plugToolGenerateUuidOperation,
      plugToolNormalizeTextOperation,
      plugToolBuildSocketEventPayloadOperation,
      plugToolValidateClientTokenOperation,
      plugToolValidateAgentContextOperation,
      plugToolBuildSqlRequestOperation,
      plugToolParseSqlRowsOperation,
      plugToolGenerateAccessRequestSummaryOperation,
    ] as const;

    for (const operation of operations) {
      expect(typeof utilityOperationHandlers[operation]).toBe("function");
    }
  });

  it("routes executeUtilityOperation through the registry", async () => {
    const context = createContext({});

    const result = await executeUtilityOperation(
      context,
      0,
      plugToolGenerateUuidOperation,
    );

    expect(typeof result).toBe("string");
    expect(result).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("builds socket event payloads from JSON text", async () => {
    const context = createContext({
      eventName: "client:custom.order.created",
      payloadJson: '{"orderId": 42}',
    });

    const result = await executeUtilityOperation(
      context,
      0,
      plugToolBuildSocketEventPayloadOperation,
    );

    expect(result).toEqual({
      eventName: "client:custom.order.created",
      payload: { orderId: 42 },
    });
  });

  it("validates agent context and client token length", async () => {
    const context = createContext({
      agentId: "agent-1",
      clientToken: "short",
    });

    const result = await executeUtilityOperation(
      context,
      0,
      plugToolValidateAgentContextOperation,
    );

    expect(result).toMatchObject({
      valid: false,
      agentId: "agent-1",
      warnings: expect.arrayContaining([expect.stringMatching(/short/i)]),
    });
  });

  it("builds sql requests and parses sql rows", async () => {
    const buildContext = createContext({
      agentId: "agent-1",
      sql: "SELECT 1",
      paramsJson: "[1]",
    });
    const parseContext = createContext({
      rowsJson: '[{"id": 1}]',
    });

    const request = await executeUtilityOperation(
      buildContext,
      0,
      plugToolBuildSqlRequestOperation,
    );
    const rows = await executeUtilityOperation(
      parseContext,
      0,
      plugToolParseSqlRowsOperation,
    );

    expect(request).toMatchObject({
      agentId: "agent-1",
      sql: "SELECT 1",
      params: [1],
    });
    expect(rows).toEqual({
      rows: [{ id: 1 }],
      rowCount: 1,
      columns: ["id"],
    });
  });

  it("normalizes text and summarizes access requests", async () => {
    const normalizeContext = createContext({
      text: "  Plug   Database  ",
    });
    const summaryContext = createContext({
      accessRequestJson:
        '{"status":"pending","requestedAgentId":"agent-1","clientAgentId":"client-agent-1"}',
    });

    const normalized = await executeUtilityOperation(
      normalizeContext,
      0,
      plugToolNormalizeTextOperation,
    );
    const summary = await executeUtilityOperation(
      summaryContext,
      0,
      plugToolGenerateAccessRequestSummaryOperation,
    );

    expect(normalized).toBe("Plug Database");
    expect(summary).toMatchObject({
      status: "pending",
      requestedAgentId: "agent-1",
      clientAgentId: "client-agent-1",
      summary: expect.stringContaining("pending"),
    });
  });
});
