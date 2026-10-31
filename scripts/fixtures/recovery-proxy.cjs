// Disposable n8n fixture. Count only Hub command replies, never handshakes or ACKs.
const { WebSocket, WebSocketServer } = require("/home/node/.n8n/nodes/node_modules/ws");
const server = new WebSocketServer({ noServer: true });
const replies = new Map();
exports.drop = (channel) => {
  const ordinal = (replies.get(channel) ?? 0) + 1;
  replies.set(channel, ordinal);
  return [1, 4, 6].includes(ordinal);
};
exports.upgrade = (request, socket, head, port) => {
  server.handleUpgrade(request, socket, head, (client) => {
    const hub = new WebSocket(`ws://host.docker.internal:${port}${request.url}`);
    hub.on("message", (data, binary) => {
      const header = binary ? "" : data.toString();
      const event = header.match(
        /^4(?:2|5\d+-).*?\["(agents:command_response|relay:rpc\.response)"/,
      );
      if (event && exports.drop(event[1].startsWith("relay") ? "relay" : "socket")) {
        client.terminate();
        hub.terminate();
      } else if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
    });
    client.on("message", (data, binary) => hub.send(data, { binary }));
    client.on("error", () => hub.terminate()).on("close", () => hub.terminate());
    hub.on("error", () => client.terminate()).on("close", () => client.terminate());
  });
};
