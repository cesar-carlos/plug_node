# n8n-nodes-plug-database

## 1.4.2

### Patch Changes

- Improve custom socket event publish metadata and harden socket event session ordering.

  Published socket events now expose `requestId`, `idempotentReplay`, and delivery status metadata in node output.
  The socket session flow also avoids dropping events that arrive immediately after subscription acknowledgement and disconnects transports cleanly on readiness timeouts.

## 1.4.1

### Patch Changes

- b60d23b: Bundle Playwright Chromium for PDF rendering, switch the default browser channel to Auto, add the generic `PLUG_TOOLS_BROWSER_EXECUTABLE_PATH` alias, and return actionable browser setup errors instead of raw Playwright launch failures.

## 1.4.0

## 1.3.0

### Minor Changes

- 5c7f2de: Expose PDF, barcode, and socket event publishing under the consolidated Plug Database Tools resource.

## 1.2.0

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
