const assert = require("node:assert/strict");
const { once } = require("node:events");
const { WebSocket, WebSocketServer } = require("ws");

exports.openResetProxy = async (hubUrl, channel) => {
  const hub = new URL(hubUrl);
  assert.equal(hub.hostname, "127.0.0.1");
  const event = channel === "relay" ? "relay:rpc.response" : "agents:command_response";
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  let armed = false,
    lost,
    resumed;
  const evidence = { event };
  server.on("connection", (client, req) => {
    const downstream = req.socket;
    if (lost && !resumed) {
      resumed = downstream;
      evidence.resumedPort = downstream.remotePort;
    }
    const upstream = new WebSocket("ws://" + hub.host + req.url);
    upstream.on("error", () => client.terminate());
    client.on("error", () => upstream.terminate());
    upstream.on("close", () => client.terminate());
    client.on("close", () => upstream.terminate());
    client.on("message", (data, binary) => upstream.send(data, { binary }));
    upstream.on("message", (data, binary) => {
      if (armed && !binary && data.toString().includes(JSON.stringify(event))) {
        armed = false;
        lost = downstream;
        evidence.lostPort = downstream.remotePort;
        downstream.resetAndDestroy();
      } else if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
    });
  });
  await once(server, "listening");
  return {
    url: "http://127.0.0.1:" + server.address().port,
    arm() {
      armed = true;
    },
    evidence() {
      assert.ok(lost?.destroyed && resumed && resumed !== lost);
      assert.notEqual(evidence.lostPort, evidence.resumedPort);
      return evidence;
    },
    async close() {
      for (const client of server.clients) client.terminate();
      await new Promise((done) => server.close(done));
    },
  };
};
