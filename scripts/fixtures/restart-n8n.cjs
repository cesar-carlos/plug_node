// Runs only inside the disposable container. The Hub and native agent stay up.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { DatabaseSync } = require("node:sqlite");
const { parse } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");
const { setTimeout: delay } = require("node:timers/promises");
const { verify } = require("./recovery-workflow.cjs");
const db = new DatabaseSync("/home/node/.n8n/database.sqlite", { readOnly: true });
const url = "http://127.0.0.1:5678";
let server;
async function until(check, label) {
  const deadline = Date.now() + 65000;
  while (Date.now() < deadline) {
    if (server?.exitCode != null || server?.signalCode)
      throw Error("n8n exited during " + label);
    const value = await check();
    if (value) return value;
    await delay(300);
  }
  throw Error("Timed out at " + label);
}
async function start() {
  const log = fs.openSync("/tmp/plug-n8n-server.log", "a", 0o600);
  try {
    server = spawn("n8n", ["start"], {
      detached: true,
      stdio: ["ignore", log, log],
      env: {
        ...process.env,
        N8N_USE_WORKFLOW_PUBLICATION_SERVICE: "false",
        N8N_DIAGNOSTICS_ENABLED: "false",
      },
    });
  } finally {
    fs.closeSync(log);
  }
  await until(
    async () => (await fetch(url + "/healthz/readiness").catch(() => null))?.ok,
    "startup",
  );
}
async function stop() {
  if (!server || server.exitCode != null || server.signalCode) return;
  const closed = once(server, "exit");
  process.kill(-server.pid, "SIGKILL");
  await closed;
}
function snapshot() {
  const row = db
    .prepare(
      "SELECT e.id,e.status,d.data FROM execution_entity e JOIN execution_data d ON d.executionId=e.id WHERE e.workflowId=? ORDER BY e.id DESC LIMIT 1",
    )
    .get("PlugRestartSmoke");
  if (!row) return;
  const runs = parse(row.data).resultData.runData;
  if (row.status === "error" || row.status === "crashed")
    throw Error("Execution " + row.status + " at " + Object.keys(runs).at(-1));
  return { id: row.id, status: row.status, runs };
}
function item(snapshot, name) {
  const runs = snapshot.runs[name];
  assert.equal(runs.length, 1, name);
  return runs[0].data.main[0][0].json;
}
async function post(path) {
  const res = await fetch(url + path, { method: "POST" });
  assert.ok(res.ok, "Webhook HTTP " + res.status);
}
async function main() {
  await start();
  await until(
    () =>
      db
        .prepare("SELECT 1 FROM webhook_entity WHERE webhookPath=?")
        .get("plug-restart-smoke"),
    "webhook activation",
  );
  await post("/webhook/plug-restart-smoke");
  const restarts = [];
  let workflowId;
  for (const channel of ["rest", "socket", "relay"]) {
    const paused = await until(() => {
      const s = snapshot();
      return s?.status === "waiting" && s.runs[channel + " lost input"] && s;
    }, channel + " checkpoint");
    workflowId ??= paused.id;
    assert.equal(paused.id, workflowId);
    const page = item(paused, channel + " prefix");
    assert.equal(page.next_sequence, 1);
    assert.deepEqual(page.next_offsets, { stdout: 3, stderr: 0 });
    assert.equal(
      item(paused, channel + " lost input").error.details.outcome_unknown,
      true,
    );
    assert.equal(paused.runs[channel + " resume"], undefined);
    const oldPid = server.pid;
    await stop();
    const stopped = snapshot();
    assert.equal(stopped.status, "waiting");
    assert.deepEqual(item(stopped, channel + " prefix"), page);
    await start();
    assert.notEqual(server.pid, oldPid);
    const resume = new URL(item(stopped, channel + " checkpoint").resumeUrl);
    assert.equal(resume.pathname, "/webhook-waiting/" + workflowId);
    await post(resume.pathname + resume.search);
    restarts.push({
      channel,
      oldPid,
      newPid: server.pid,
      executionId: page.execution_id,
      sequence: page.next_sequence,
      offsets: page.next_offsets,
    });
  }
  const completed = await until(() => {
    const s = snapshot();
    return s?.status === "success" && s;
  }, "completion");
  assert.equal(completed.id, workflowId);
  const channels = verify((name) => item(completed, name));
  assert.equal(
    db
      .prepare("SELECT count(*) AS n FROM execution_entity WHERE workflowId=?")
      .get("PlugRestartSmoke").n,
    1,
  );
  for (const [i, channel] of channels.entries())
    assert.equal(channel.executionId, restarts[i].executionId);
  process.stdout.write(JSON.stringify({ workflowId, restarts, channels }, null, 2));
}
main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stop();
    db.close();
  });
