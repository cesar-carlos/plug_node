# Testing Strategy

## Local quality gates

- `npm run verify`
- `npm run test:e2e`
- `npm run pack:check`

## Unit coverage focus

- authentication and refresh flows
- REST vs Socket routing
- RPC normalization
- output shaping
- retry and timeout behavior
- relay cleanup and stream handling

## E2E coverage focus

- successful REST execution
- successful Socket execution
- authorization failures
- SQL validation failures
- multi-result behavior
- login and refresh behavior

## Infrastructure-aware behavior

Some E2E tests can skip when the agent or hub is temporarily unavailable. This avoids false negatives caused by external infrastructure instability rather than code regressions.
