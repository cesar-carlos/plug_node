// Runs only inside the disposable n8n container, with synthetic credentials.
const assert = require("node:assert/strict");
const { createServer } = require("node:https");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { writeFileSync } = require("node:fs");
const run = promisify(execFile);
const health = {
  status: "healthy",
  timestamp: "2026-01-01T00:00:00Z",
  version: "fixture",
  pool: { size: 0 },
  sql_queue: { enabled: false },
  queries: {
    total: 0,
    errors: 0,
    success_rate: 1,
    avg_latency_ms: 0,
    p95_latency_ms: 0,
    p99_latency_ms: 0,
  },
  uptime_seconds: 0,
};
const stdout = Buffer.from("PLUG_REMOTE_ECHO=ação 🌱\r\n");
const split = stdout.indexOf(Buffer.from("🌱")) + 1;
const stream = {
  captured: true,
  truncated: false,
  utf8_total_bytes: 0,
  offset: 0,
  next_offset: 0,
  response_truncated: false,
};
const state = {
  execution_id: "fixture-execution",
  action_id: "fixture-action",
  action_type: "script",
  status: "succeeded",
  source: "remoteHub",
  requested_at: "2026-01-01T00:00:00Z",
  timestamps: {},
  process: { exit_code: 0 },
  output: { stdout: stream, stderr: stream },
  flags: {
    terminal: true,
    skipped: false,
    timed_out: false,
    cancelled: false,
    killed: false,
    redaction_applied: false,
  },
  io: {
    version: 1,
    mode: "faithful",
    process_state: "finished",
    stdin_state: "closed",
    capture_state: "complete",
    output_expired: false,
    next_input_sequence: 2,
  },
};
function resultFor(command) {
  switch (command.method) {
    case "agent.getHealth":
      return health;
    case "sql.describeSource":
      return {
        contractVersion: 1,
        database: command.params.database,
        dialect: "mssql",
        identityHash: "a".repeat(64),
        identityKind: "native",
        engineVersion: "fixture",
        verifiedAt: "2026-01-01T00:00:00Z",
      };
    case "agent.action.validateRun":
    case "agent.action.run":
      assert.equal(command.params.io.initial_input_base64, "YcOnw6NvIPCfjLE=");
      assert.equal(command.params.io.close_input, true);
      return command.method.endsWith("validateRun")
        ? {
            valid: true,
            action_id: "fixture-action",
            action_type: "script",
            would_replay_existing_execution: false,
          }
        : state;
    case "agent.action.getExecution":
      return state;
    case "agent.action.readIo": {
      const first = command.params.after_sequence === 0;
      const events = [
        {
          sequence: first ? 1 : 2,
          type: "output",
          stream: "stdout",
          offset: first ? 0 : split,
          data_base64: (first
            ? stdout.subarray(0, split)
            : stdout.subarray(split)
          ).toString("base64"),
        },
      ];
      if (!first)
        events.push(
          { sequence: 3, type: "process_exited", exit_code: 0 },
          { sequence: 4, type: "completed", output_complete: true },
        );
      return {
        execution_id: "fixture-execution",
        events,
        next_sequence: first ? 1 : 4,
        terminal: true,
        output_complete: true,
      };
    }
    default:
      return { actions: [], next_cursor: null };
  }
}
async function main() {
  const requests = [];
  const server = createServer(
    {
      key: require("node:fs").readFileSync("/tmp/fixture.key"),
      cert: require("node:fs").readFileSync("/tmp/fixture.crt"),
    },
    async (req, res) => {
      const parts = [];
      for await (const chunk of req) parts.push(chunk);
      const body = JSON.parse(Buffer.concat(parts).toString());
      res.setHeader("Content-Type", "application/json");
      if (req.url.endsWith("/client-auth/login"))
        return res.end(
          JSON.stringify({
            accessToken: "fixture-access",
            refreshToken: "fixture-refresh",
            client: {
              id: "c",
              userId: "u",
              email: "fixture@example.test",
              name: "Fixture",
              lastName: "Test",
              status: "active",
              role: "client",
            },
          }),
        );
      const { agentId, command } = body;
      requests.push({
        agentId,
        token: command.params.client_token,
        method: command.method,
      });
      assert.equal(command.params.client_token, agentId + "-token");
      res.end(
        JSON.stringify({
          agentId,
          response: {
            type: "single",
            item: {
              id: command.id,
              success: true,
              result: resultFor(command),
            },
          },
        }),
      );
    },
  );
  await new Promise((resolve) => server.listen(443, "127.0.0.1", resolve));
  try {
    const baseUrl = "https://plug-server.se7esistemassinop.com.br/api/v1";
    const account = (id, agentId) => ({
      id,
      name: id,
      type: "plugDatabaseAccountApi",
      data: {
        user: "fixture@example.test",
        password: "synthetic-password",
        baseUrl,
        agentId,
        clientToken: agentId + "-token",
      },
    });
    const credentials = [
      account("account", "account"),
      account("legacy", "unused"),
      {
        id: "separate",
        name: "Separate",
        type: "plugAgentApi",
        data: { agentId: "separate", clientToken: "separate-token" },
      },
    ];
    writeFileSync("/tmp/credential-fixture.json", JSON.stringify(credentials), {
      mode: 0o600,
    });
    const cli = async (args) =>
      run("n8n", args, { timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
    await cli(["import:credentials", "--input=/tmp/credential-fixture.json"]);
    require("node:fs").unlinkSync("/tmp/credential-fixture.json");
    const start = {
      id: "start",
      name: "Start",
      type: "n8n-nodes-base.manualTrigger",
      typeVersion: 1,
      position: [0, 0],
      parameters: {},
    };
    const nodes = [start],
      connections = {};
    for (const resource of ["actionIo", "sqlExtension"])
      for (const mode of ["account", "stale", "legacy", "separate"]) {
        const name = resource + "-" + mode;
        const accountMode = mode === "account" || mode === "stale";
        const credential = {
          plugDatabaseAccountApi: {
            id: accountMode ? "account" : "legacy",
            name: "Fixture",
          },
        };
        if (mode !== "account")
          credential.plugAgentApi = {
            id: mode === "stale" ? "does-not-exist" : "separate",
            name: "Fixture agent",
          };
        const parameters = {
          resource,
          operation: resource === "actionIo" ? "listAvailable" : "agent.getHealth",
          actionChannel: "rest",
        };
        if (mode !== "legacy")
          parameters.agentCredentialSource = accountMode ? "account" : "separate";
        const previous = nodes.at(-1).name;
        nodes.push({
          id: name,
          name,
          type: "n8n-nodes-plug-database.plugDatabase",
          typeVersion: 2,
          parameters,
          credentials: credential,
          position: [nodes.length * 220, 0],
        });
        connections[previous] = { main: [[{ node: name, type: "main", index: 0 }]] };
      }
    writeFileSync(
      "/tmp/credential-workflow.json",
      JSON.stringify([
        {
          id: "PlugCredentialAcceptance",
          name: "Credential source acceptance",
          active: false,
          nodes,
          connections,
          settings: { executionOrder: "v1" },
        },
      ]),
    );
    await cli(["import:workflow", "--input=/tmp/credential-workflow.json"]);
    const execution = await cli([
      "execute",
      "--id=PlugCredentialAcceptance",
      "--rawOutput",
    ]);
    const jsonStart = execution.stdout.search(/^\{\s*"/m);
    assert.ok(jsonStart >= 0, "Expected n8n execution JSON");
    const data = JSON.parse(execution.stdout.slice(jsonStart));
    assert.equal(data.data.resultData.error, undefined);
    for (const node of nodes.slice(1)) {
      const output = data.data.resultData.runData[node.name][0].data.main[0][0].json;
      assert.deepEqual(
        output,
        node.parameters.resource === "actionIo"
          ? { actions: [], next_cursor: null }
          : health,
      );
    }
    assert.equal(requests.length, 8);
    assert.deepEqual(
      requests.map((r) => r.agentId),
      [
        "account",
        "account",
        "separate",
        "separate",
        "account",
        "account",
        "separate",
        "separate",
      ],
    );
    const exampleReports = [];
    for (const [filename, textCatalog] of [
      ["action-account-echo-workflow.json", false],
      ["sql-extensions-account-workflow.json", false],
      ["action-account-echo-workflow.json", true],
      ["action-complete-output-workflow.json", false],
    ]) {
      const example = JSON.parse(
        require("node:fs").readFileSync("/tmp/" + filename, "utf8"),
      );
      const readAll = filename === "action-complete-output-workflow.json";
      if (readAll) {
        example.nodes.push({
          id: "verify-binary",
          name: "Saida da execucao",
          type: "n8n-nodes-base.code",
          typeVersion: 2,
          position: [1800, 0],
          parameters: {
            mode: "runOnceForAllItems",
            jsCode: `
const item = $input.first();
if (!item.json.output_drained || !item.json.output_complete || item.json.stop_reason !== 'completed') throw new Error('Incomplete drain');
const chunks = [];
for (const part of item.json.parts) {
  if (!item.binary[part.field].id) throw new Error('Expected external storage');
  chunks.push(await this.helpers.getBinaryDataBuffer(0, part.field));
}
// Only the tiny UTF-8 fixture is joined here, never production-sized output.
const stdout = Buffer.concat(chunks).toString('utf8');
if (stdout !== 'PLUG_REMOTE_ECHO=ação 🌱\\r\\n') throw new Error('Binary bytes differ');
return [{json: {echo: 'ação 🌱', echo_bytes: 11, output_complete: true, exit_code: item.json.process_exit_code}}];`,
          },
        });
        example.connections["Ler saida"] = {
          main: [[{ node: "Saida da execucao", type: "main", index: 0 }]],
        };
      }
      example.id = filename.startsWith("action") ? "PlugAccountEcho" : "PlugAccountSql";
      for (const node of example.nodes) {
        if (node.type === "n8n-nodes-plug-database.plugDatabase")
          node.credentials = {
            plugDatabaseAccountApi: { id: "account", name: "Fixture" },
          };
        if (node.name === "Referencia")
          node.parameters.assignments.assignments.find(
            (a) => a.name === "actionId",
          ).value = "fixture-action";
        if (node.name === "Identificar fonte")
          node.parameters.extensionParams = JSON.stringify({
            contractVersion: 1,
            database: "fixture",
          });
      }
      if (textCatalog)
        for (const node of example.nodes) {
          if (["Validar acao", "Iniciar acao"].includes(node.name)) {
            node.parameters.actionInputFormat = "text";
            node.parameters.actionText = "ação 🌱";
            node.parameters.actionSelection = "catalog";
            node.parameters.actionCatalog = {
              __rl: true,
              mode: "list",
              value: "fixture-action",
            };
            node.parameters.actionId = "hidden-id-must-not-be-used";
          }
        }
      writeFileSync("/tmp/example.json", JSON.stringify([example]));
      await cli(["import:workflow", "--input=/tmp/example.json"]);
      const run = await cli(["execute", "--id=" + example.id, "--rawOutput"]);
      const json = JSON.parse(run.stdout.slice(run.stdout.search(/^\{\s*"/m)));
      assert.equal(json.data.resultData.error, undefined);
      const last =
        example.id === "PlugAccountEcho" ? "Saida da execucao" : "Identificar fonte";
      const result = json.data.resultData.runData[last][0].data.main[0][0].json;
      if (example.id === "PlugAccountEcho")
        assert.deepEqual(
          {
            echo: result.echo,
            bytes: result.echo_bytes,
            complete: result.output_complete,
            exit: result.exit_code,
          },
          { echo: "ação 🌱", bytes: 11, complete: true, exit: 0 },
        );
      else assert.equal(result.database, "fixture");
      exampleReports.push({ file: filename, textCatalog, success: true });
    }
    const pkg = require("/home/node/.n8n/nodes/node_modules/n8n-nodes-plug-database/package.json");
    console.log(
      JSON.stringify({
        success: true,
        n8n: (await cli(["--version"])).stdout.trim(),
        package: pkg.version,
        executedNodes: 8,
        examples: exampleReports,
        cases: [
          "account only",
          "account with stale separate binding",
          "legacy without source parameter",
          "explicit separate",
        ],
        resources: ["actionIo", "sqlExtension"],
        transport: "REST",
        fixture: "synthetic Hub; real n8n CLI and encrypted credentials",
      }),
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error.message);
  if (error.stdout) console.error(error.stdout.slice(-1600));
  process.exitCode = 1;
});
