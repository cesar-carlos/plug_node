import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "../../../shared/mcp/systemPrompt";

describe("mcp systemPrompt", () => {
  it("should compose the configured prompt blocks", () => {
    const prompt = buildSystemPrompt({
      identity: "Voce e o assistente comercial.",
      scope: "Consulte apenas clientes e estoque.",
      maxToolCallsPerTurn: 4,
      sensitiveDataRules: "Nao exiba CPF completo.",
      operationalLimits: "Nao execute acoes irreversiveis.",
    });

    expect(prompt).toContain("IDENTITY");
    expect(prompt).toContain("Voce e o assistente comercial.");
    expect(prompt).toContain("SCOPE");
    expect(prompt).toContain("Consulte apenas clientes e estoque.");
    expect(prompt).toContain("Maximum of 4 tool calls per user message.");
    expect(prompt).toContain("Nao exiba CPF completo.");
    expect(prompt).toContain("Nao execute acoes irreversiveis.");
  });

  it("should fall back to default blocks when optional sections are empty", () => {
    const prompt = buildSystemPrompt({
      identity: "   ",
      scope: "",
      maxToolCallsPerTurn: 2,
    });

    expect(prompt).toContain("You are the operational ERP assistant.");
    expect(prompt).toContain("Maximum of 2 tool calls per user message.");
  });
});
