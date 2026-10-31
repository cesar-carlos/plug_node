// TLS terminator inside the disposable n8n container, for the node's fixed Hub URL.
const fs = require("node:fs");
const https = require("node:https");
const http = require("node:http");
const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw Error("Invalid fixture port");
const paths = new Set(["/api/v1/client-auth/login", "/api/v1/agents/commands"]);
const recovery = process.argv[3] === "recovery" ? require("./recovery-proxy.cjs") : null;
https
  .createServer(
    {
      key: fs.readFileSync("/tmp/plug-workflow.key"),
      cert: fs.readFileSync("/tmp/plug-workflow.crt"),
    },
    (req, res) => {
      if (req.method !== "POST" || !paths.has(req.url)) {
        res.writeHead(404).end();
        return;
      }
      const upstream = http.request(
        {
          hostname: "host.docker.internal",
          port,
          path: req.url,
          method: "POST",
          headers: { ...req.headers, host: `127.0.0.1:${port}` },
        },
        (response) => {
          if (
            recovery &&
            req.url === "/api/v1/agents/commands" &&
            recovery.drop("rest")
          ) {
            response.resume().once("end", () => res.destroy());
            return;
          }
          res.writeHead(response.statusCode, response.headers);
          response.pipe(res);
        },
      );
      upstream.on("error", () => res.writeHead(502).end());
      req.pipe(upstream);
    },
  )
  .on("upgrade", (req, socket, head) => {
    if (new URL(req.url, "https://localhost").pathname !== "/socket.io/") {
      socket.destroy();
      return;
    }
    if (recovery) return recovery.upgrade(req, socket, head, port);
    const upstream = http.request({
      hostname: "host.docker.internal",
      port,
      path: req.url,
      headers: { ...req.headers, host: `127.0.0.1:${port}` },
    });
    upstream.on("upgrade", (response, peer, extra) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          response.rawHeaders.reduce((s, v, i) => s + v + (i % 2 ? "\r\n" : ": "), "") +
          "\r\n",
      );
      if (extra.length) socket.write(extra);
      if (head.length) peer.write(head);
      socket.on("error", () => peer.destroy()).on("close", () => peer.destroy());
      peer.on("error", () => socket.destroy()).on("close", () => socket.destroy());
      socket.pipe(peer).pipe(socket);
    });
    upstream.on("error", () => socket.destroy()).end();
  })
  .listen(443, "127.0.0.1", () =>
    fs.writeFileSync("/tmp/plug-workflow-proxy.pid", String(process.pid), {
      mode: 0o600,
    }),
  );
