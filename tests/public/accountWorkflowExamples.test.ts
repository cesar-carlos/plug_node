import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) =>
  JSON.parse(
    readFileSync(new URL("../../docs/socket/examples/" + name, import.meta.url), "utf8"),
  );
const echo = read("action-account-echo-workflow.json");
const sql = read("sql-extensions-account-workflow.json");
const completeOutput = read("action-complete-output-workflow.json");
interface ExampleNode {
  name: string;
  type: string;
  credentials?: unknown;
  retryOnFail?: boolean;
  parameters: Record<string, unknown>;
}
describe("account credential importable examples", () => {
  it("keeps reading finished captures until completion is delivered and routes failed completion to validation", () => {
    const gate = echo.nodes.find(
      (node: ExampleNode) =>
        node.type === "n8n-nodes-base.if" &&
        JSON.stringify(node.parameters).includes("completed"),
    );
    const expression = gate.parameters.conditions.conditions[0].leftValue;
    const evaluate = new Function("$json", "return (" + expression.slice(3, -2) + ");");
    expect(
      evaluate({ terminal: true, output_complete: true, events: [{ type: "output" }] }),
    ).toBe(false);
    expect(
      evaluate({
        terminal: true,
        output_complete: true,
        events: [{ type: "completed", output_complete: true }],
      }),
    ).toBe(true);
    expect(
      evaluate({
        terminal: true,
        output_complete: false,
        events: [{ type: "completed", output_complete: false }],
      }),
    ).toBe(true);
    expect(evaluate({ terminal: true, events: [] })).toBe(true);
    expect(evaluate({ terminal: false, events: [] })).toBe(false);
  });
  it.each([echo, sql, completeOutput])(
    "requires only an account selection and never embeds credentials",
    (workflow) => {
      expect(workflow.active).toBe(false);
      for (const node of workflow.nodes as ExampleNode[]) {
        expect(node.credentials).toBeUndefined();
        if (node.type === "n8n-nodes-plug-database.plugDatabase") {
          expect(node.parameters.agentCredentialSource).toBe("account");
          expect(node.retryOnFail).toBe(false);
        }
      }
    },
  );
  it("keeps the preflight and direct base64 input aligned with Run", () => {
    for (const name of ["Validar acao", "Iniciar acao"]) {
      const node = echo.nodes.find((node: ExampleNode) => node.name === name);
      expect(node.parameters.actionBase64).toBe(
        "={{ $('Referencia').item.json.inputBase64 }}",
      );
      expect(node.parameters.actionInitial).toBe(true);
      expect(node.parameters.actionClose).toBe(true);
    }
    expect(echo.connections["Pode iniciar"].main[1][0].node).toBe("Validacao recusada");
  });
  it.each([
    "exact",
    "extra",
    "partial",
    "nonzero",
    "missing-completed",
    "capture-failure",
  ])("checks the UTF-8 echo bytes and completeness: %s", (scenario) => {
    const text =
      "PLUG_REMOTE_ECHO=ação 🌱" + (scenario === "extra" ? " extra" : "") + "\r\n";
    const bytes = Buffer.from(text);
    const split = bytes.indexOf(Buffer.from("🌱")) + 1;
    const pages = [bytes.subarray(0, split), bytes.subarray(split)].map(
      (part, index) => ({
        execution_id: "e",
        events: [
          {
            type: "output",
            stream: "stdout",
            offset: index === 0 ? 0 : split,
            data_base64: part.toString("base64"),
          },
          ...(index === 1 && scenario !== "missing-completed"
            ? [
                {
                  type: "completed",
                  output_complete: scenario !== "partial",
                  ...(scenario === "capture-failure"
                    ? { failure: { code: "CAPTURE_FAILED" } }
                    : {}),
                },
              ]
            : []),
        ],
        // Capture can finish before the consumer reads even the first page.
        terminal: true,
        output_complete: true,
      }),
    );
    const state = {
      execution_id: "e",
      status: "succeeded",
      process: { exit_code: scenario === "nonzero" ? 1 : 0 },
    };
    const lookup = (name: string) =>
      name === "Referencia"
        ? { first: () => ({ json: { inputBase64: "YcOnw6NvIPCfjLE=" } }) }
        : {
            all: (_branch: number, index: number) =>
              pages[index] ? [{ json: pages[index] }] : [],
          };
    const code = echo.nodes.find((node: ExampleNode) => node.name === "Saida da execucao")
      .parameters.jsCode;
    const execute = () =>
      new Function("$input", "$", "Buffer", code)(
        { item: { json: state } },
        lookup,
        Buffer,
      );
    if (scenario === "exact")
      expect(execute().json).toMatchObject({
        echo: "ação 🌱",
        echo_bytes: 11,
        output_complete: true,
        exit_code: 0,
      });
    else expect(execute).toThrow();
  });
});
