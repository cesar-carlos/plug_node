import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { sqlOperationExecuteParamsSchema } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/sqlOperation/params";

const directory = resolve("tests/fixtures/sql-contracts");
describe("canonical SQL schemas", () => {
  it("detects source contract drift in the explicitly required agent checkout", () => {
    const root = process.env.PLUG_AGENT_ROOT ?? resolve("../plug_agente");
    for (const name of readdirSync(directory)) {
      const source = resolve(root, "docs/communication/schemas", name);
      if (!existsSync(source)) {
        if (process.env.REQUIRE_PLUG_AGENT_CONTRACT === "1")
          throw new Error(`Missing required agent schema: ${name}`);
        continue;
      }
      expect(JSON.parse(readFileSync(source, "utf8"))).toEqual(
        JSON.parse(readFileSync(resolve(directory, name), "utf8")),
      );
    }
  });
  it("agrees with canonical schema on valid plans and exact byte/scalar boundaries", () => {
    const ajv = new Ajv({ strict: false });
    addFormats(ajv);
    const validate = ajv.compile(
      JSON.parse(
        readFileSync(
          resolve(directory, "rpc.params.sql-operation-execute.schema.json"),
          "utf8",
        ),
      ),
    );
    const plan = {
      contractVersion: 1,
      operationId: "018f87c0-1111-7111-8111-123456789abc",
      fingerprint: "a".repeat(64),
      sourcePhysicalId: "b".repeat(64),
      database: "fixture",
      maxAffectedRows: 1,
      timeoutMs: 300000,
      steps: [
        {
          id: "step",
          effect: "update",
          sql: "UPDATE fixture SET x = :x",
          params: {
            x: {
              kind: "value",
              scalar: { type: "decimal", value: "12345678901234567890.123456789" },
            },
          },
          outputs: {},
          affectedRows: { min: 0, max: 1 },
        },
      ],
    };
    for (const payload of [
      plan,
      { ...plan, timeoutMs: 300001 },
      { ...plan, operationId: "not-a-uuid" },
      { ...plan, contractVersion: 2 },
      { ...plan, maxAffectedRows: 100001 },
      { ...plan, unknown: true },
    ]) {
      expect(sqlOperationExecuteParamsSchema.safeParse(payload).success).toBe(
        validate(payload),
      );
    }
    expect(validate(plan)).toBe(true);
  });
});
