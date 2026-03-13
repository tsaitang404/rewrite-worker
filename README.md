# rewrite-worker

Cloudflare Worker that rewrites the origin host and/or path of incoming requests — equivalent to Cloudflare's **Origin Rules** feature.

中文文档: [docs/zh-CN.md](docs/zh-CN.md)

## Features

- Match requests by hostname, path glob, or both
- Rewrite destination hostname, port, and/or path
- Wildcard (`*`) capture in path globs with back-reference substitution
- Rules evaluated in order — first match wins
- Zero-dependency pure TypeScript

## Configuration

Rules are configured via the `REWRITE_RULES` environment variable as a JSON array.

### Rule schema

```jsonc
[
  {
    "match": {
      "hostname": "example.com", // optional – exact hostname to match
      "path": "/api/*"           // optional – path prefix/glob (* wildcard)
    },
    "rewrite": {
      "hostname": "api.backend.internal", // optional – new origin hostname
      "port": 8080,                        // optional – new origin port
      "path": "/v2/*"                      // optional – new path (* = captured wildcard
    }
  }
]
```

- All `match` fields are **optional** – omitting both means the rule matches every request (catch-all).
- All `rewrite` fields are **optional** – only the specified fields are changed.
- The `*` wildcard in `match.path` captures any sequence of characters and can be referenced with `*` in `rewrite.path`.

### Examples

#### Rewrite API path to a different backend

```toml
# wrangler.toml
[vars]
REWRITE_RULES = '[{"match":{"hostname":"example.com","path":"/api/*"},"rewrite":{"hostname":"api.backend.internal","path":"/v2/*"}}]'
```

A request to `https://example.com/api/users?page=1` will be forwarded to
`https://api.backend.internal/v2/users?page=1`.

#### Route all traffic to a specific backend port

```toml
[vars]
REWRITE_RULES = '[{"match":{},"rewrite":{"hostname":"origin.internal","port":8443}}]'
```

## Development

```bash
# Install dependencies
npm install

# Create local config from templates (first run)
cp .env.example .env
cp .dev.vars.example .dev.vars

# Run locally with Wrangler dev server
npm run dev

# Run tests
npm test

# Type-check
npm run type-check

# Deploy
npm run deploy
```

### Local private config

- Commit-safe templates:
  - `.env.example` for deploy/auth variables
  - `.dev.vars.example` for local `wrangler dev` variables
- Machine-local files (ignored by git):
  - `.env`
  - `.dev.vars`

This keeps repository defaults reusable while still allowing each developer
to run locally with their own routes/rules/tokens.

## CI/CD (GitHub Actions)

This repository includes an automatic deploy workflow at `.github/workflows/deploy-worker.yml`.

- Trigger:
  - Push to `main`
  - Manual run via `workflow_dispatch`
- Pipeline steps:
  - Install dependencies
  - Run tests
  - Run type-check
  - Deploy with Wrangler

Before it can deploy, add these repository secrets in GitHub:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Also add these repository variables in GitHub:

- `REWRITE_RULES_JSON`
- `WORKER_ROUTES`
- `WORKER_ZONE_NAME`

Example variable values:

- `REWRITE_RULES_JSON` = `[{"match":{"hostname":"www.example.com"},"rewrite":{"hostname":"backend.example.net","path":"/share"}},{"match":{"hostname":"example.com"},"rewrite":{"hostname":"backend.example.net","path":"/share"}}]`
- `WORKER_ROUTES` =
  `example.com/*`
  `www.example.com/*`
- `WORKER_ZONE_NAME` = `example.com`

`WORKER_ROUTES` supports any number of routes, one route per line.

## How it works

1. Each incoming request is matched against the configured rules in order.
2. The first matching rule rewrites the destination URL (hostname, port, path).
3. The modified request is forwarded to the new origin using `fetch()`.
4. If no rule matches the request is proxied to the original origin unchanged.
