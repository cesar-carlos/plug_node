const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const channels = ["rest", "socket", "relay"];
const prefix = Buffer.from([0, 255, 13]);
const suffix = Buffer.from([10, 65, 0, 128]);

exports.configure = (workflow, restart = false) => {
  const [start, template] = workflow.nodes;
  workflow.id = "PlugRecoverySmoke";
  workflow.name = "Plug remote action recovery";
  if (restart) {
    workflow.id = "PlugRestartSmoke";
    workflow.name = "Plug remote action recovery after n8n restart";
    Object.assign(start, {
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      webhookId: randomUUID(),
      parameters: {
        path: "plug-restart-smoke",
        httpMethod: "POST",
        responseMode: "onReceived",
      },
    });
  }
  workflow.nodes = [start];
  workflow.connections = {};
  for (const channel of channels) {
    const expr = (step, field) => `={{ $('${channel} ${step}').first().json.${field} }}`;
    const key = randomUUID(),
      message = randomUUID();
    const actionId = "action-second";
    const execution = { actionExecutionId: expr("find", "execution_id") };
    const checkpoint = {
      ...execution,
      actionAfterSequence: expr("prefix", "next_sequence"),
      actionStdoutOffset: expr("prefix", "next_offsets.stdout"),
      actionStderrOffset: expr("prefix", "next_offsets.stderr"),
    };
    function append(name, node) {
      node.name = channel + " " + name;
      node.position = [workflow.nodes.length * 220, 0];
      node.id = randomUUID();
      workflow.connections[workflow.nodes.at(-1).name] = {
        main: [[{ node: node.name, type: "main", index: 0 }]],
      };
      workflow.nodes.push(node);
    }
    function action(name, operation, parameters, lost = false) {
      append(name, {
        ...template,
        ...(lost ? { onError: "continueRegularOutput" } : {}),
        parameters: {
          resource: "actionIo",
          actionChannel: channel,
          operation,
          ...parameters,
        },
      });
    }
    action(
      "lost run",
      "run",
      {
        actionId,
        actionTrigger: "second-trigger",
        actionKey: key,
        actionInitial: true,
        actionBase64: prefix.toString("base64"),
      },
      true,
    );
    action("find", "findExecution", { actionId, actionKey: key });
    action("prefix", "readIo", execution);
    action(
      "lost input",
      "sendInput",
      {
        ...execution,
        actionSequence: 1,
        actionMessageId: message,
        actionBase64: suffix.toString("base64"),
      },
      true,
    );
    if (restart)
      append("checkpoint", {
        type: "n8n-nodes-base.set",
        typeVersion: 3.4,
        parameters: {
          assignments: {
            assignments: [
              {
                id: randomUUID(),
                name: "resumeUrl",
                value: "={{ $execution.resumeUrl }}",
                type: "string",
              },
            ],
          },
        },
      });
    append("settle", {
      type: "n8n-nodes-base.wait",
      typeVersion: 1.1,
      ...(restart ? { webhookId: randomUUID() } : {}),
      parameters: restart
        ? { resume: "webhook", httpMethod: "POST" }
        : { resume: "timeInterval", amount: 1, unit: "seconds" },
    });
    action("receipt", "getInputStatus", { ...execution, actionMessageId: message });
    action("lost read", "readIo", checkpoint, true);
    action("resume", "readIo", checkpoint);
    action("close", "closeInput", {
      ...execution,
      actionSequence: 2,
      actionMessageId: randomUUID(),
    });
    append("finish", {
      type: "n8n-nodes-base.wait",
      typeVersion: 1.1,
      // A fresh relay conversation per node is limited to eight starts per ten seconds.
      parameters: {
        resume: "timeInterval",
        amount: channel === "relay" ? 11 : 2,
        unit: "seconds",
      },
    });
    action("end", "readIo", {
      ...execution,
      actionAfterSequence: expr("resume", "next_sequence"),
      actionStdoutOffset: expr("resume", "next_offsets.stdout"),
      actionStderrOffset: expr("resume", "next_offsets.stderr"),
    });
  }
};

exports.verify = (item) =>
  channels.map((channel) => {
    const get = (name) => item(channel + " " + name);
    for (const name of ["lost run", "lost input", "lost read"]) {
      const error = get(name).error;
      assert.ok(error, channel + " " + name);
      assert.equal(error.retryable, false);
      assert.equal(
        error.code,
        channel === "rest" ? "TRANSPORT_UNCONFIRMED" : "SOCKET_DISCONNECTED",
      );
      assert.equal(error.details.outcome_unknown, name !== "lost read");
    }
    const found = get("find"),
      receipt = get("receipt");
    assert.equal(found.found, true);
    const pages = ["prefix", "resume", "end"].map(get);
    for (const reply of [receipt, ...pages, get("close")])
      assert.equal(reply.execution_id, found.execution_id);
    assert.equal(receipt.state, "written");
    assert.equal(receipt.sequence, 1);
    assert.equal(receipt.confirmed_bytes, suffix.length);
    assert.equal(receipt.next_input_sequence, 2);
    const stream = (page, name) =>
      Buffer.concat(
        page.events
          .filter((e) => e.type === "output" && e.stream === name)
          .map((e) => Buffer.from(e.data_base64, "base64")),
      );
    assert.deepEqual(stream(pages[0], "stdout"), prefix);
    assert.deepEqual(stream(pages[1], "stdout"), suffix);
    assert.deepEqual(stream(pages[2], "stdout"), Buffer.alloc(0));
    assert.match(stream(pages[2], "stderr").toString(), /^EOF\r?\n$/);
    assert.ok(pages[2].terminal && pages[2].output_complete);
    let sequence = 0;
    for (const page of pages) {
      for (const event of page.events) assert.equal(event.sequence, ++sequence);
      assert.equal(page.next_sequence, sequence);
    }
    return {
      channel,
      executionId: found.execution_id,
      checkpoint: pages[0].next_sequence,
      finalSequence: sequence,
      stdoutHex: Buffer.concat([prefix, suffix]).toString("hex"),
      confirmedInputBytes: receipt.confirmed_bytes,
      terminal: true,
    };
  });
