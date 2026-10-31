import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { advancedJsonRpcCommandSchema } from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugAdvancedJsonRpcMethodSchemas";
import { buildActionIoProperties } from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/actionIoDescription";
import { buildSqlExtensionProperties } from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/sqlExtensionDescription";
import { actionIoParamsSchemas } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/actionIo/params";
import type { INodeProperties } from "n8n-workflow";
import baseline from "../fixtures/bridge-methods.json";

const operations = (fields: INodeProperties[]): string[] =>
  (fields.find((f) => f.name === "operation")?.options ?? []).map((o) =>
    String("value" in o ? o.value : ""),
  );
it("exposes the entire bridge method inventory, including each action with request validation", () => {
  const actions = operations(buildActionIoProperties());
  expect(actions.sort()).toEqual(Object.keys(actionIoParamsSchemas).sort());
  const methods = [
    ...advancedJsonRpcCommandSchema.options.map((s) => s.shape.method.value),
    ...actions.map((name) => `agent.action.${name}`),
    ...operations(buildSqlExtensionProperties()),
  ].sort();
  expect(methods).toEqual([...baseline].sort());
  const hubFile = resolve(
    process.env.PLUG_SERVER_ROOT ?? "../plug_server",
    "src/shared/constants/agent_bridge_parity.ts",
  );
  if (existsSync(hubFile) || process.env.REQUIRE_PLUG_SERVER_CONTRACT === "1") {
    const list = /export const bridgeParityMethods = (\[[\s\S]*?\]) as const/.exec(
      readFileSync(hubFile, "utf8"),
    );
    expect(list).not.toBeNull();
    expect(methods).toEqual(JSON.parse(list![1].replace(/,\s*\]/, "]")).sort());
  }
  const agentFile = resolve(
    process.env.PLUG_AGENT_ROOT ?? "../plug_agente",
    "docs/communication/openrpc.json",
  );
  if (existsSync(agentFile) || process.env.REQUIRE_PLUG_AGENT_CONTRACT === "1") {
    const spec = JSON.parse(readFileSync(agentFile, "utf8"));
    expect(methods).toEqual(spec.methods.map((m: { name: string }) => m.name).sort());
  }
});
