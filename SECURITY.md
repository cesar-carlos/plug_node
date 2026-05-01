# Security Policy

## Supported scope

This repository contains the Plug Client workspace for n8n packages and shared transport/auth logic.

Security-sensitive areas include:

- authentication and refresh flows
- credential handling
- REST transport
- relay socket transport
- payload frame decoding
- logging and metadata shaping

## Reporting a vulnerability

Please do not open public GitHub issues for security vulnerabilities.

Use a private channel and include:

- a clear description of the issue
- affected files or package areas
- reproduction steps
- impact assessment
- whether secrets, tokens, or credentials are involved

If the issue relates to credentials or tokens:

- rotate affected credentials immediately
- avoid posting real secrets in screenshots, logs, or issue text

## Disclosure guidance

- keep the report private until a fix is available
- prefer the smallest reproducible example possible
- share sanitized logs only

## Repository-specific notes

- `.env` files are ignored and must not be committed
- `packages/*/dist` and `packages/*/generated` must not be committed
- node UI text is public-facing and should not expose internal technical details
- logs should never include passwords, access tokens, refresh tokens, or client tokens

## Verification before merge

For security-relevant changes, run:

```bash
npm run verify
```

And update the relevant documentation when behavior changes:

- `docs/architecture.md`
- `docs/communication-patterns.md`
- `docs/ux-decisions.md`
- `docs/testing-strategy.md`
