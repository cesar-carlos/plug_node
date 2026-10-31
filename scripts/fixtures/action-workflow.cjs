const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const channels = ["rest", "socket", "relay"];
const bytes = Buffer.from([0, 255, 13, 10, 65]);

exports.configure = (workflow) => {
  const [start, template] = workflow.nodes;
  workflow.id = "PlugActionSmoke";
  workflow.name = "Plug remote action acceptance";
  workflow.nodes = [start];
  workflow.connections = {};
  function append(node) {
    const previous = workflow.nodes.at(-1);
    node.position = [workflow.nodes.length * 240, 0];
    node.id = randomUUID();
    workflow.connections[previous.name] = {
      main: [[{ node: node.name, type: "main", index: 0 }]],
    };
    workflow.nodes.push(node);
  }
  for (const channel of channels) {
    const execution = `={{ $('${channel} run').first().json.execution_id }}`;
    function action(operation, parameters) {
      append({
        ...template,
        name: channel + " " + operation,
        parameters: {
          resource: "actionIo",
          actionChannel: channel,
          operation,
          ...parameters,
        },
      });
    }
    function wait(name) {
      append({
        name: channel + " " + name,
        type: "n8n-nodes-base.wait",
        typeVersion: 1.1,
        parameters: { resume: "timeInterval", amount: 2, unit: "seconds" },
      });
    }
    action("run", {
      actionId: "action-second",
      actionTrigger: "second-trigger",
      actionKey: randomUUID(),
    });
    action("sendInput", {
      actionExecutionId: execution,
      actionSequence: 0,
      actionMessageId: randomUUID(),
      actionBase64: bytes.toString("base64"),
    });
    wait("await echo");
    action("readIo", { actionExecutionId: execution });
    action("cancel", { actionExecutionId: execution });
    wait("await termination");
    action("getExecution", { actionExecutionId: execution });
  }
};

exports.verify = (item) =>
  channels.map((channel) => {
    const response = (name) => item(channel + " " + name);
    const id = response("run").execution_id;
    assert.ok(id);
    const sent = response("sendInput");
    const page = response("readIo");
    const state = response("getExecution");
    for (const result of [sent, page, response("cancel"), state])
      assert.equal(result.execution_id, id);
    const output = Buffer.concat(
      page.events
        .filter((e) => e.type === "output" && e.stream === "stdout")
        .map((e) => Buffer.from(e.data_base64, "base64")),
    );
    assert.deepEqual(output, bytes);
    assert.equal(state.status, "cancelled");
    assert.equal(state.flags.terminal, true);
    return {
      channel,
      executionId: id,
      inputState: sent.state,
      stdoutHex: output.toString("hex"),
      status: state.status,
    };
  });
