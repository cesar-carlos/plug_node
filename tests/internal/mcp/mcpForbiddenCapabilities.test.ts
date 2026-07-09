import { describe, expect, it } from "vitest";

import type { CapabilityDefinition } from "../../../shared/mcp/contracts";
import {
  isCapabilityBlockedByNameList,
  isCapabilityForbiddenForAgent,
  isForbiddenCapabilityName,
  isForbiddenToolsOperation,
} from "../../../shared/mcp/forbiddenCapabilities";

const sqlCapability = (name: string): CapabilityDefinition => ({
  name,
  displayName: name,
  description: "desc",
  whenToUse: "use",
  whenNotToUse: "not",
  category: "crm",
  parameters: {},
  governance: { maxRows: 10 },
  executionConfig: {
    providerType: "sql",
    sql: "SELECT 1",
    channel: "rest",
    maxRows: 10,
  },
});

const toolsCapability = (name: string, operation: string): CapabilityDefinition => ({
  name,
  displayName: name,
  description: "desc",
  whenToUse: "use",
  whenNotToUse: "not",
  category: "tools",
  parameters: {},
  governance: { maxRows: 10 },
  executionConfig: {
    providerType: "tools",
    operation,
  },
});

describe("mcp forbiddenCapabilities", () => {
  it("should detect forbidden capability names without false positives", () => {
    expect(isForbiddenCapabilityName("client_access")).toBe(true);
    expect(isForbiddenCapabilityName("userAccess")).toBe(true);
    expect(isForbiddenCapabilityName("list_client_access_tokens")).toBe(true);
    expect(isForbiddenCapabilityName("user_accessibility")).toBe(false);
    expect(isForbiddenCapabilityName("consultar_cliente")).toBe(false);
  });

  it("should detect forbidden tools operations", () => {
    expect(isForbiddenToolsOperation("clientAccess")).toBe(true);
    expect(isForbiddenToolsOperation("userAccess.list")).toBe(true);
    expect(isForbiddenToolsOperation("validateCpfCnpj")).toBe(false);
  });

  it("should mark admin capabilities as forbidden for agents", () => {
    expect(isCapabilityForbiddenForAgent(sqlCapability("client_access"))).toBe(true);
    expect(
      isCapabilityForbiddenForAgent(toolsCapability("admin", "clientAccess")),
    ).toBe(true);
    expect(
      isCapabilityForbiddenForAgent(toolsCapability("validate_doc", "validateCpfCnpj")),
    ).toBe(false);
  });

  it("should match forbidden name lists case-insensitively", () => {
    expect(
      isCapabilityBlockedByNameList("Consultar_Cliente", ["consultar_cliente"]),
    ).toBe(true);
    expect(isCapabilityBlockedByNameList("other", ["consultar_cliente"])).toBe(false);
  });
});
