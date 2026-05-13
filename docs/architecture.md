# Architecture

## Workspace Layout

- `packages/n8n-nodes-plug-database`
- `shared`
- `tests`
- `docs`

## Package Responsibility

`n8n-nodes-plug-database` is the single published Plug package. It includes:

- REST command execution
- consumer Socket command execution through `/consumers`
- Socket Event publish and one-shot wait operations
- Socket Event trigger
- Plura.ai Automations trigger
- PDF, barcode, document, image, data, security, date/value, identity, and Plug-specific tools

## Shared Core

The shared layer is copied into package-local `generated/shared` during build and test preparation.

Main shared areas:

- `auth`: login, refresh, session reuse
- `contracts`: REST, JSON-RPC, PayloadFrame, and error contracts
- `rest`: bridge execution and REST Socket Event publish
- `socket`: relay, consumer command, custom event sessions, and frame codec
- `output`: n8n item shaping
- `n8n`: node description builders and execution helpers

## Package-Local Wiring

n8n entry files stay thin. `Plug Database` gathers parameters and credentials, then delegates REST and Socket work to shared helpers. Package-local Socket.IO adapters are limited to transport wiring for `socket.io-client`; protocol decisions stay in `shared/socket`.
