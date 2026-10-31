const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");

// Only the reader goes through this private loopback proxy. The writer stays on the Hub.
exports.openResetProxy = async (hubUrl) => {
  const hub = new URL(hubUrl);
  assert.equal(hub.hostname, "127.0.0.1");
  let armed = false,
    closedSocket,
    nextSocket;
  const evidence = {};
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/api/v1/agents/commands") {
      res.writeHead(404).end();
      return;
    }
    const upstream = http.request(
      new URL(req.url, hub),
      {
        method: "POST",
        headers: { ...req.headers, host: hub.host, "accept-encoding": "identity" },
      },
      (reply) => {
        if (armed) {
          armed = false;
          closedSocket = req.socket;
          evidence.httpStatus = reply.statusCode;
          evidence.lostPort = closedSocket.remotePort;
          // Frame a deliberately incomplete HTTP response, then reset the real TCP socket.
          reply.once("data", (chunk) => {
            evidence.partialBodyBytes = Math.min(chunk.length, 32);
            res.writeHead(reply.statusCode, {
              "content-type": "application/json",
              "transfer-encoding": "chunked",
            });
            res.write(chunk.subarray(0, evidence.partialBodyBytes), () => {
              closedSocket.resetAndDestroy();
            });
            reply.resume();
          });
        } else {
          if (closedSocket && !nextSocket) {
            nextSocket = req.socket;
            evidence.resumedPort = nextSocket.remotePort;
          }
          res.writeHead(reply.statusCode, reply.headers);
          reply.pipe(res);
        }
      },
    );
    upstream.on("error", () => res.destroy());
    req.pipe(upstream);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    url: "http://127.0.0.1:" + server.address().port,
    arm() {
      armed = true;
    },
    evidence() {
      assert.ok(closedSocket?.destroyed && nextSocket && nextSocket !== closedSocket);
      assert.ok(evidence.partialBodyBytes > 0);
      assert.equal(evidence.httpStatus, 200);
      assert.notEqual(evidence.lostPort, evidence.resumedPort);
      return evidence;
    },
    async close() {
      const done = once(server, "close");
      server.close();
      server.closeAllConnections();
      await done;
    },
  };
};
