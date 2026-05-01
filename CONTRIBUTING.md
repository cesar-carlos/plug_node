# Contributing

## Goal

This repository hosts the Plug Client workspace for n8n community and internal packages.

Please keep contributions aligned with the main product goal:

- make the node easy to use in n8n
- preserve the 4-field credential flow
- keep REST and SOCKET behavior consistent
- prefer source changes over checked-in generated or build artifacts

## Setup

Recommended Node.js version:

- `22.22.0`

Install dependencies:

```bash
npm ci
```

Verify the whole workspace before opening a pull request:

```bash
npm run verify
```

## Project structure

Important areas:

- `packages/n8n-nodes-plug-client`
- `packages/n8n-nodes-plug-client-internal`
- `shared`
- `tests`
- `docs`
- `.cursor/rules`

Read [AGENTS.md](./AGENTS.md) first, then use the real project rules under [`.cursor/rules`](./.cursor/rules).

## Contribution rules

- do not commit `node_modules`
- do not commit `packages/*/dist`
- do not commit `packages/*/generated`
- keep node UI labels and descriptions in English
- keep internal documentation clear and consistent with implemented behavior
- preserve the fixed Plug API base URL unless the project direction changes explicitly

## Pull request checklist

- update docs when behavior or UX changes
- add or update tests when logic changes
- run `npm run verify`
- keep commits focused and easy to review

## Notes

If you are changing transport, auth, relay, or output shaping, update these docs too:

- `docs/project-summary.md`
- `docs/architecture.md`
- `docs/communication-patterns.md`
- `docs/ux-decisions.md`
- `docs/testing-strategy.md`
