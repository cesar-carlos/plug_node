# n8n-nodes-plug-database-advanced

## 2.0.0

### Major Changes

- 200779f: Unify every authenticated Plug node around the shared `Plug Database Account API` credential, remove the legacy access-only and socket publisher compatibility nodes, and treat simultaneous installation of the public and advanced packages as unsupported.

## 1.4.2

### Patch Changes

- Improve custom socket event publish metadata and harden socket event session ordering.

  Published socket events now expose `requestId`, `idempotentReplay`, and delivery status metadata in node output.
  The socket session flow also avoids dropping events that arrive immediately after subscription acknowledgement and disconnects transports cleanly on readiness timeouts.

## 1.4.1

### Patch Changes

- b60d23b: Bundle Playwright Chromium for PDF rendering, switch the default browser channel to Auto, add the generic `PLUG_TOOLS_BROWSER_EXECUTABLE_PATH` alias, and return actionable browser setup errors instead of raw Playwright launch failures.

## 1.4.0

### Minor Changes

- d021800: Add the Plura.ai Automations Trigger webhook node and its credential to the advanced package.

## 1.3.0

### Minor Changes

- 5c7f2de: Expose PDF, barcode, and socket event publishing under the consolidated Plug Database Tools resource.

## 1.2.0

### Minor Changes

- 65e0957: Add and harden advanced Socket event UX: publish `client:custom.*` events over REST or Socket, support binary attachments with server-aligned local limits, trigger on custom events or `client:agent.profile.updated`, add backpressure/signature/deduplication/reconnect controls, and document the public and internal Custom Socket Event flows.
- 65e0957: Add Plug Advanced PDF and barcode tool nodes for HTML-to-PDF, QR code, and barcode binary generation.

  Include configurable metadata/base64 JSON fields, QR error correction, PDF media emulation, and deployment-level output size guardrails.

  Keep the public REST-only package dependency-light for the verified-node path.

## 1.1.2

### Patch Changes

- Refresh the main node icons with the packaged Plug blockchain artwork so published builds pick up the updated branding reliably.

## 1.1.1

### Patch Changes

- Consolidate the public nodes around Resource-based navigation while keeping legacy access nodes hidden for compatibility.

## 1.1.0

### Minor Changes

- Add client and user access nodes, SQL agent and token overrides, and the new consumer socket transport with relay compatibility fallback.

## 1.0.0

### Major Changes

- 34ac072: Prepare GitHub Actions provenance publish after initial npm release

### Patch Changes

- d383dd3: Establish Changesets-based version control and release automation for the Plug Database workspace packages.
