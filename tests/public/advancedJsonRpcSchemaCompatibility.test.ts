import { describe, expect, it } from "vitest";

import fixtures from "../fixtures/advanced-json-rpc-errors.json";
import { parseAdvancedJsonRpcCommand } from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugAdvancedJsonRpcValidation";
import { PlugValidationError } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";

describe("advanced JSON-RPC schema compatibility", () => {
  it.each(fixtures)("should preserve the public error for $command.method", (fixture) => {
    expect(() => parseAdvancedJsonRpcCommand(fixture.command)).toThrow(
      new PlugValidationError(fixture.error),
    );
  });
});
