# E2E Tests

## Goal

Exercise the real Plug API and relay socket integration with local credentials stored in `.env`.

## Required files

- `.env`
- `.env.example`

The tracked file is `.env.example`. Real credentials stay only in `.env`, which is ignored by Git.

## Commands

```bash
npm run test:e2e
npm run test:e2e:rest
npm run test:e2e:socket
```

## Scope

- real login
- real login endpoint contract
- real refresh-token contract
- real invalid refresh-token error contract
- real bearer-token refresh path when triggered by the API
- real REST bridge command execution
- real `/consumers` socket connection
- real relay `PayloadFrame` decode path
- real negative SQL cases for authorization and invalid syntax
- real `multi_result` behavior for success+success and success+error flows

## Query environment variables

Positive smoke queries:

- `PLUG_E2E_SQL_QUERY_CLIENTE`
- `PLUG_E2E_SQL_QUERY_MARCA`
- `PLUG_E2E_SQL_QUERY_GRUPO_PRODUTO`

Negative probes:

- `PLUG_E2E_SQL_QUERY_UNAUTHORIZED`
  - default: `SELECT * FROM Empresa`
- `PLUG_E2E_SQL_QUERY_INVALID`
  - default: `SELECT FROM Cliente`

Multi-result probes:

- `PLUG_E2E_SQL_QUERY_MULTI_RESULT_SUCCESS`
  - default: `SELECT * FROM Cliente; SELECT * FROM Marca`
- `PLUG_E2E_SQL_QUERY_MULTI_RESULT_MIXED`
  - default: `SELECT * FROM Cliente; SELECT * FROM Empresa`

## Notes

- E2E tests are intentionally not part of `npm run verify`.
- The suite runs sequentially to reduce noise and transport contention.
- Command-oriented checks can be skipped automatically when the target agent is offline.
- Command-oriented checks can also skip automatically when the hub returns transient `503`
  overload or "coming online" responses.
