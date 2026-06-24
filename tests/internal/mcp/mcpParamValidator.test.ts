import { describe, expect, it } from "vitest";

import type { ParamSchema } from "../../../shared/mcp/contracts";
import { validateParams } from "../../../shared/mcp/paramValidator";

const schemas: Record<string, ParamSchema> = {
  codCliente: {
    type: "number",
    description: "Codigo do cliente.",
    required: true,
    minimum: 1,
  },
  nomeCliente: {
    type: "string",
    description: "Nome parcial do cliente.",
  },
  limite: {
    type: "number",
    description: "Quantidade maxima de registros.",
    default: 10,
    maximum: 100,
  },
};

describe("mcp paramValidator", () => {
  it("should coerce valid params and apply defaults", () => {
    const result = validateParams(schemas, { codCliente: "42" });

    expect(result).toEqual({
      ok: true,
      coerced: {
        codCliente: 42,
        nomeCliente: null,
        limite: 10,
      },
    });
  });

  it("should reject missing required params", () => {
    const result = validateParams(schemas, {});

    expect(result).toEqual({
      ok: false,
      error: 'Parameter "codCliente" is required.',
    });
  });

  it("should reject values above the configured maximum", () => {
    const result = validateParams(schemas, { codCliente: 42, limite: 500 });

    expect(result).toEqual({
      ok: false,
      error: 'Parameter "limite" must be at most 100.',
    });
  });

  it("should reject unknown parameters", () => {
    const result = validateParams(schemas, { codCliente: 42, extra: "value" });

    expect(result).toEqual({
      ok: false,
      error: 'Unknown parameter "extra" is not accepted by this capability.',
    });
  });
});
