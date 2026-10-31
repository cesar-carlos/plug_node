import { describe, expect, it } from "vitest";
import { NodeOperationError } from "n8n-workflow";
import type { INode } from "n8n-workflow";
import { toNodeExecutionError } from "../../../packages/n8n-nodes-plug-database/generated/shared/n8n/nodeExecutionError";
import { PlugError } from "../../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";

const node: INode = {
  id: "test",
  name: "Plug",
  type: "plugDatabase",
  typeVersion: 2,
  position: [0, 0],
  parameters: {},
};
describe("node execution error boundary", () => {
  it("should preserve already normalized n8n errors", () => {
    const original = new NodeOperationError(node, "Failed", { itemIndex: 2 });
    expect(toNodeExecutionError(node, original, 0)).toBe(original);
  });
  it("should wrap raw errors for the n8n UI", () => {
    const error = toNodeExecutionError(node, new Error("Invalid configuration"), 3);
    expect(error).toBeInstanceOf(NodeOperationError);
    expect(error.message).toBe("Invalid configuration");
    expect(error.context.itemIndex).toBe(3);
  });
  it("should sanitize internal Plug diagnostics before wrapping", () => {
    const error = toNodeExecutionError(
      node,
      new PlugError("Unavailable", {
        code: "TEST",
        technicalMessage: "internal payload",
        details: { privateValue: "hidden" },
      }),
    );
    expect(JSON.stringify(error)).not.toContain("internal payload");
    expect(JSON.stringify(error)).not.toContain("privateValue");
  });
});
