import { execFile, spawnSync } from "node:child_process";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const shell = process.platform === "win32" ? "powershell.exe" : "pwsh";
const available = !spawnSync(shell, ["-NoProfile", "-Command", "exit 0"]).error;
it.skipIf(process.platform !== "win32")(
  "writes UTF-8 bytes from the agent script even under code page 850",
  () => {
    const echo = "ação 🌱";
    const result = spawnSync(
      shell,
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "[Console]::OutputEncoding = [Text.Encoding]::GetEncoding(850); & './testes_acao_remota/acao_no_agente.ps1'",
      ],
      { input: Buffer.from(echo) },
    );
    expect(result.status).toBe(0);
    const output = new TextDecoder("utf-8", { fatal: true }).decode(result.stdout);
    expect(output.split(/\r?\n/)).toContain(`PLUG_REMOTE_ECHO=${echo}`);
  },
);
it.skipIf(!available).each([
  ["complete", 0],
  ["partial", 2],
  ["nonzero", 2],
  ["missing-code", 2],
  ["extra-text", 2],
  ["wrong-case", 2],
  ["bad-offset", 1],
] as const)(
  "validates the API echo script with %s output",
  async (scenario, expected) => {
    const echo = "ação 🌱";
    const line = "PLUG_REMOTE_ECHO=" + echo;
    const bytes = Buffer.from(
      (scenario === "wrong-case" ? line.toUpperCase() : line) +
        (scenario === "extra-text" ? " extra" : "") +
        "\r\n",
    );
    const split = bytes.indexOf(Buffer.from("🌱")) + 1;
    const server = createServer(async (req, res) => {
      const body = [];
      for await (const chunk of req) body.push(chunk);
      const { command } = JSON.parse(Buffer.concat(body).toString());
      let result;
      if (command.method === "agent.action.run") {
        result = {
          execution_id: "e",
          status: "succeeded",
          process: {
            exit_code:
              scenario === "missing-code" ? null : scenario === "nonzero" ? 7 : 0,
          },
          output: { stdout: { text: line } },
        };
      } else if (command.method === "agent.action.readIo") {
        const first = command.params.after_sequence === 0;
        const offset = first ? 0 : split;
        const chunk =
          scenario === "partial"
            ? first
              ? bytes
              : Buffer.alloc(0)
            : first
              ? bytes.subarray(0, split)
              : bytes.subarray(split);
        result = {
          events: chunk.length
            ? [
                {
                  type: "output",
                  stream: "stdout",
                  offset: scenario === "bad-offset" && !first ? offset + 1 : offset,
                  data_base64: chunk.toString("base64"),
                },
              ]
            : [],
          next_sequence: first || scenario === "partial" ? 1 : 2,
          output_complete: !first && scenario !== "partial",
        };
      }
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ response: { item: { success: true, result } } }));
    });
    const dir = await mkdtemp(join(tmpdir(), "plug-echo-"));
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as AddressInfo).port;
      await copyFile("testes_acao_remota/chamar_daqui.ps1", join(dir, "echo.ps1"));
      await writeFile(
        join(dir, "config.local.json"),
        JSON.stringify({
          hubUrl: `http://127.0.0.1:${port}`,
          clientToken: "local",
          accessToken: "hub",
          agentId: "agent",
          actionId: "echo",
          echo,
          pollTimeoutSeconds: scenario === "partial" ? 1 : 10,
        }),
      );
      const code = await promisify(execFile)(shell, [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(dir, "echo.ps1"),
      ]).then(
        () => 0,
        (error) => {
          if (error.code !== expected) throw error;
          return error.code;
        },
      );
      expect(code).toBe(expected);
    } finally {
      server.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  15000,
);
