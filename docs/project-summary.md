# Project Summary

The published `n8n-nodes-plug-database` package connects n8n to the Plug Hub and agents. The **Plug Database** node exposes six resources: SQL, Agent Action I/O, SQL Extensions, Client Access, User Access and Tools. The account credential authenticates with the Hub. Agent Action I/O and SQL Extensions also use a Plug Agent API credential for the target computer.

## Nodes shipped

- **Plug Database** executes SQL, controls saved remote actions, manages access and runs local tools.
- **Plug Database Socket Event Trigger** listens for custom events and agent profile updates.
- **Plug Database Plura.ai Automations Trigger** receives automation webhooks.
- **Plug MCP Server** lists, validates and executes governed capabilities.
- **Plug AI Hub** provides prompts and tool-call limits for agent workflows.

## Setup and compatibility

The default Hub API is `https://plug-server.se7esistemassinop.com.br/api/v1`. Use the [package README](../packages/n8n-nodes-plug-database/README.md#supported-operations) for the operation inventory and the [team guide](./guia-acoes-remotas-n8n.md) for remote actions and SQL Extensions. See [communication patterns](./communication-patterns.md) for channel selection, the [testing strategy](./testing-strategy.md) for supported installation profiles, and the [package changelog](../packages/n8n-nodes-plug-database/CHANGELOG.md) for release history.
