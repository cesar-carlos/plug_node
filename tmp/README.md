# tmp/

Local scratch only. Keep the repository root clean.

## Layout

| Path            | Use                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------- |
| `tmp/e2e-logs/` | Captured stdout/stderr from local `npm run test:e2e*` runs (for example `tmp-e2e-*.log`) |
| `tmp/`          | Other short-lived dumps, benches, or debug artifacts that must not land in the repo root |

## Rules

- Do not commit files under `tmp/` except this README.
- Prefer `tmp/e2e-logs/<name>.log` when redirecting e2e output (`>` / `tee`).
- Do not store `.env`, tokens, or credentials here.
- Delete stale captures when they are no longer useful.
