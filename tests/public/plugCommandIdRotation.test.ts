import { describe, expect, it } from "vitest";

import type { BuiltCommandRequest } from "../../shared/contracts/api";
import { rotateBuiltRequestCommandIdsForRetry } from "../../shared/n8n/plugCommandIdRotation";

const baseRequest = (): BuiltCommandRequest => ({
  operation: "executeSql",
  agentId: "agent-1",
  channel: "rest",
  responseMode: "aggregatedJson",
  command: {
    jsonrpc: "2.0",
    method: "sql.execute",
    id: "fixed-id",
    params: {
      idempotency_key: "workflow-key",
      sql: "SELECT 1",
    },
  },
});

describe("rotateBuiltRequestCommandIdsForRetry", () => {
  it("keeps the first attempt unchanged", () => {
    const request = baseRequest();
    expect(rotateBuiltRequestCommandIdsForRetry(request, 0)).toBe(request);
  });

  it("rotates jsonrpc id on retry", () => {
    const first = rotateBuiltRequestCommandIdsForRetry(baseRequest(), 1);
    const second = rotateBuiltRequestCommandIdsForRetry(baseRequest(), 2);

    expect(Array.isArray(first.command)).toBe(false);
    if (!Array.isArray(first.command)) {
      expect(first.command.id).not.toBe("fixed-id");
      expect(second.command).not.toEqual(first.command);
      expect(
        (first.command.params as { readonly idempotency_key?: string }).idempotency_key,
      ).toBe("workflow-key");
    }
  });
});
