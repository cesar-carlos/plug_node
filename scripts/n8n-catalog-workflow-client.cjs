// Invoked in the private Hub fixture, after the native agent has registered.
const assert = require("node:assert/strict");
const { execFile, execFileSync } = require("node:child_process");
const { readFileSync, writeFileSync, unlinkSync } = require("node:fs");
const { join } = require("node:path");

exports.verifyReferenceClient = async (options) => {
  const container = process.env.PLUG_WORKFLOW_CONTAINER;
  const root = process.cwd();
  const restart = process.env.PLUG_ACTION_WORKFLOW === "restart";
  const recovery = restart || process.env.PLUG_ACTION_WORKFLOW === "recovery";
  const grantFile = join(root, "workflow-grants.json");
  const grants = JSON.parse(readFileSync(grantFile, "utf8"));
  unlinkSync(grantFile);
  const docker = (args, input) =>
    new Promise((resolve) => {
      const child = execFile(
        "docker",
        ["exec", ...(input ? ["-i"] : []), container, ...args],
        {
          encoding: "utf8",
          windowsHide: true,
          timeout: restart ? 390000 : recovery ? 120000 : 60000,
          maxBuffer: 8 * 1024 * 1024,
        },
        (error, stdout, stderr) => resolve({ status: error?.code ?? 0, stdout, stderr }),
      );
      child.stdin.end(input);
    });
  function requireOk(result, label) {
    if (result.status !== 0) throw Error(`${label} failed (status ${result.status})`);
  }
  async function put(path, data) {
    requireOk(
      await docker(
        [
          "node",
          "-e",
          "require('node:fs').writeFileSync(process.argv[1],require('node:fs').readFileSync(0),{mode:0o600})",
          path,
        ],
        typeof data === "string" ? data : JSON.stringify(data),
      ),
      "fixture upload",
    );
  }
  const hub = new URL(options.hubUrl);
  assert.equal(hub.hostname, "127.0.0.1");
  const hostname = "plug-server.se7esistemassinop.com.br";
  requireOk(
    await docker([
      "node",
      "-e",
      `require('node:dns').lookup('${hostname}',{all:true},(e,ips)=>{if(e||!ips.length||ips.some(i=>i.address!=='127.0.0.1'))process.exit(1)})`,
    ]),
    "private fixed-host mapping",
  );
  const key = join(root, "workflow-tls.key"),
    cert = join(root, "workflow-tls.crt");
  try {
    execFileSync(
      process.env.PLUG_FIXTURE_OPENSSL,
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "1",
        "-subj",
        `/CN=${hostname}`,
        "-addext",
        `subjectAltName=DNS:${hostname}`,
      ],
      { stdio: "ignore", windowsHide: true },
    );
    await put("/tmp/plug-workflow.key", readFileSync(key, "utf8"));
    await put("/tmp/plug-workflow.crt", readFileSync(cert, "utf8"));
  } finally {
    for (const path of [key, cert])
      if (require("node:fs").existsSync(path)) unlinkSync(path);
  }
  await put(
    "/tmp/plug-workflow-proxy.cjs",
    readFileSync(process.env.PLUG_WORKFLOW_PROXY, "utf8"),
  );
  if (recovery)
    await put(
      "/tmp/recovery-proxy.cjs",
      readFileSync(join(__dirname, "fixtures/recovery-proxy.cjs"), "utf8"),
    );
  execFileSync(
    "docker",
    [
      "exec",
      "-d",
      container,
      "node",
      "/tmp/plug-workflow-proxy.cjs",
      hub.port,
      ...(recovery ? ["recovery"] : []),
    ],
    { stdio: "ignore", windowsHide: true },
  );
  const ready = await docker([
    "node",
    "-e",
    "const fs=require('node:fs'); let i=0;const id=setInterval(()=>{if(fs.existsSync('/tmp/plug-workflow-proxy.pid'))clearInterval(id);else if(++i>80)process.exit(1)},50)",
  ]);
  requireOk(ready, "loopback TLS proxy");
  const cli = ["env", "NODE_EXTRA_CA_CERTS=/tmp/plug-workflow.crt", "n8n"];
  const credentials = [
    {
      id: "catalogHub",
      name: "Catalog Hub",
      type: "plugDatabaseAccountApi",
      data: { user: options.email, password: options.password },
    },
  ];
  for (const [profile, token] of Object.entries({
    Allowed: options.credential,
    Empty: grants.empty,
    Denied: grants.denied,
  }))
    credentials.push({
      id: `catalog${profile}`,
      name: `Catalog ${profile}`,
      type: "plugAgentApi",
      data: { agentId: options.agentId, clientToken: token },
    });
  const workflow = JSON.parse(readFileSync(process.env.PLUG_WORKFLOW_FILE, "utf8"));
  const strict = structuredClone(workflow);
  strict.id = "PlugCatalogDeny";
  strict.name = "Plug catalog stop on denial";
  strict.nodes = [strict.nodes[0], strict.nodes.at(-1)];
  delete strict.nodes[1].onError;
  strict.connections = {
    Start: { main: [[{ node: "Denied catalog", type: "main", index: 0 }]] },
  };
  const actionMode = recovery || process.env.PLUG_ACTION_WORKFLOW === "1";
  const fixture = recovery
    ? "./fixtures/recovery-workflow.cjs"
    : "./fixtures/action-workflow.cjs";
  if (actionMode) require(fixture).configure(workflow, restart);
  await put("/tmp/plug-workflows.json", actionMode ? [workflow] : [workflow, strict]);
  await put("/tmp/plug-creds.json", credentials);
  try {
    requireOk(
      await docker(["n8n", "import:credentials", "--input=/tmp/plug-creds.json"]),
      "import credentials",
    );
  } finally {
    requireOk(
      await docker([
        "node",
        "-e",
        "require('node:fs').unlinkSync('/tmp/plug-creds.json')",
      ]),
      "remove temporary credential file",
    );
  }
  requireOk(
    await docker(["n8n", "import:workflow", "--input=/tmp/plug-workflows.json"]),
    "import workflows",
  );
  if (restart) {
    requireOk(
      await docker(["n8n", "publish:workflow", `--id=${workflow.id}`]),
      "publish isolated webhook workflow",
    );
    await put(
      "/tmp/recovery-workflow.cjs",
      readFileSync(join(__dirname, fixture), "utf8"),
    );
    await put(
      "/tmp/restart-n8n.cjs",
      readFileSync(join(__dirname, "fixtures/restart-n8n.cjs"), "utf8"),
    );
    const result = await docker([
      "env",
      "NODE_EXTRA_CA_CERTS=/tmp/plug-workflow.crt",
      "node",
      "/tmp/restart-n8n.cjs",
    ]);
    if (result.status !== 0) {
      process.stderr.write(result.stderr);
      throw Error("Restart workflow failed");
    }
    writeFileSync(
      join(
        require("node:path").dirname(process.env.PLUG_WORKFLOW_REPORT),
        "restart-report.json",
      ),
      result.stdout,
    );
    return;
  }
  const run = await docker([...cli, "execute", `--id=${workflow.id}`, "--rawOutput"]);
  // n8n can prefix raw output with startup diagnostics. Never log returned credentials or unrestricted execution data.
  const jsonStart = run.stdout?.search(/^\{\s*"/m) ?? -1;
  if (run.status !== 0 || jsonStart < 0) {
    const text = (run.stdout ?? "") + "\n" + (run.stderr ?? "");
    const lines = text
      .split(/\r?\n/)
      .filter(
        (s) =>
          !s.trim().startsWith("at ") &&
          /error|failed|module|unknown node|unrecognized|credential/i.test(s),
      )
      .slice(0, 6);
    const redact = (s) =>
      credentials
        .flatMap((c) => Object.values(c.data))
        .filter((v) => typeof v === "string" && v.length > 0)
        .reduce((out, value) => out.replaceAll(value, "[redacted]"), s)
        .slice(0, 250);
    writeFileSync(
      join(root, "workflow-diagnostic.json"),
      JSON.stringify({ status: run.status, lines: lines.map(redact) }),
    );
    throw Error("n8n workflow execution failed");
  }
  const execution = JSON.parse(run.stdout.slice(jsonStart).trim());
  const runs = execution.data.resultData.runData;
  const item = (name) => {
    assert.equal(runs[name].length, 1);
    const items = runs[name][0].data.main[0];
    assert.equal(items.length, 1);
    return items[0].json;
  };
  if (actionMode) {
    const report = require(fixture).verify(item);
    writeFileSync(
      join(
        require("node:path").dirname(process.env.PLUG_WORKFLOW_REPORT),
        recovery ? "recovery-report.json" : "actions-report.json",
      ),
      JSON.stringify(report, null, 2),
    );
    return;
  }
  const first = item("First page"),
    second = item("Second page"),
    empty = item("Empty catalog"),
    denied = item("Denied catalog");
  assert.deepEqual(
    first.actions.map((x) => x.action_id),
    ["action"],
  );
  assert.equal(typeof first.next_cursor, "string");
  assert.ok(first.next_cursor.length);
  assert.deepEqual(
    second.actions.map((x) => x.action_id),
    ["action-second"],
  );
  assert.equal(second.next_cursor, null);
  assert.deepEqual(empty, { actions: [], next_cursor: null });
  assert.equal(
    denied.error.details?.failure_code ?? denied.error.code,
    "ACTION_IO_UNAUTHORIZED",
  );
  assert.equal(denied.error.retryable, false);
  assert.equal(denied.error.message, "O agente negou acesso ao catálogo de ações.");
  assert.equal(denied.error.details.reason, "scope_or_action_denied");
  assert.match(denied.error.description, /agent_actions\.list/);
  const stopped = await docker([...cli, "execute", `--id=${strict.id}`, "--rawOutput"]);
  assert.equal(stopped.status, 1);
  assert.match(
    (stopped.stdout ?? "") + (stopped.stderr ?? ""),
    /O agente negou acesso ao catálogo de ações/,
  );
  writeFileSync(
    process.env.PLUG_WORKFLOW_REPORT,
    JSON.stringify(
      {
        n8n: (await docker(["n8n", "--version"])).stdout.trim(),
        channel: "REST",
        firstIds: first.actions.map((x) => x.action_id),
        secondIds: second.actions.map((x) => x.action_id),
        finalCursor: second.next_cursor,
        empty,
        deniedCode: denied.error.details?.failure_code ?? denied.error.code,
        deniedRetryable: denied.error.retryable,
        strictFailureExit: stopped.status,
      },
      null,
      2,
    ),
  );
};
