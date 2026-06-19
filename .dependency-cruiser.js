/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
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
