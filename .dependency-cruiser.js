/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "socket-io-only-in-adapter",
      comment: "Socket.IO is wired exclusively by the package transport adapter",
      severity: "error",
      from: {
        pathNot:
          "^packages/n8n-nodes-plug-database/nodes/PlugDatabase/socketIoTransport\\.ts$",
      },
      to: { path: "(^|/)node_modules/socket\\.io-client(/|$)" },
    },
    {
      name: "core-no-n8n-or-tools",
      comment:
        "Protocol and policy modules cannot depend on n8n execution or tool implementations",
      severity: "error",
      from: {
        path: "^(shared|packages/n8n-nodes-plug-database/generated/shared)/(auth|contracts|rest|socket|mcp)/",
      },
      to: {
        path: "^(shared|packages/n8n-nodes-plug-database/generated/shared)/(n8n|tools)/",
      },
    },
    {
      name: "shared-no-packages",
      comment: "shared must not import from packages/**",
      severity: "error",
      from: { path: "^shared/" },
      to: { path: "^packages/" },
    },
    {
      name: "package-use-generated-shared",
      comment: "Package code must import shared modules via generated/shared",
      severity: "error",
      from: {
        path: "^packages/n8n-nodes-plug-database/",
        pathNot: "^packages/n8n-nodes-plug-database/generated/",
      },
      to: { path: "^shared/" },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsPreCompilationDeps: false,
  },
};
