# fcp-sfd-crm

![Publish](https://github.com/defra/fcp-sfd-crm/actions/workflows/publish.yml/badge.svg)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=DEFRA_fcp-sfd-crm&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=DEFRA_fcp-sfd-crm)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=DEFRA_fcp-sfd-crm&metric=coverage)](https://sonarcloud.io/summary/new_code?id=DEFRA_fcp-sfd-crm)
[![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=DEFRA_fcp-sfd-crm&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=DEFRA_fcp-sfd-crm)

CRM orchestration service for Single Front Door.
This service is part of the [Single Front Door (SFD)](https://github.com/defra/fcp-sfd-core) service.

## Prerequisites

### Environment variables

Create a `.env` file in the root of the project based on `.env.example`.

### Pre-commit hooks

This repo includes pre-commit hooks:
- **detect-secrets** — scans for accidentally committed secrets
- **eslint-fix** — runs ESLint with neostandard and `--fix`

Committing via the command line shows full hook output.

To install the pre-commit framework, you need Python and pip:

```bash
pip3 install pre-commit
```

Then activate the hooks:

```bash
pre-commit install
```

## Local development

### VS Code tasks

VS Code users can access tasks via the Command Palette → **Tasks: Run Task**.

- macOS: `Cmd+Shift+P`
- Windows: `Ctrl+Shift+P`

### Floci

The following instructions relate to interacting with Floci locally (outside of the Docker container) on host port `localhost:4566`.

Prerequisites:
- Docker stack is running (`npm run docker:dev`)
- AWS CLI is installed (`aws --version`)

Set these variables in your terminal session:

```bash
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_ENDPOINT_URL=http://localhost:4566
export AWS_REGION=eu-west-2
```

#### Examples

List queues:
```bash
aws sqs list-queues --endpoint-url http://localhost:4566
```

List topics:
```bash
aws sns list-topics --endpoint-url http://localhost:4566
```

Check approximate message counts on a queue:
```bash
aws sqs get-queue-attributes \
	--queue-url http://localhost:4566/000000000000/fcp_sfd_crm_requests \
	--attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible
```

Read a message (without deleting it):
``` bash
aws sqs receive-message \
	--queue-url http://localhost:4566/000000000000/fcp_sfd_crm_requests \
	--max-number-of-messages 1
```

Purge all messages from a queue:
```bash
aws sqs purge-queue \
	--queue-url http://localhost:4566/000000000000/fcp_sfd_crm_requests
```

Note: use `http://localhost:4566` from your host shell. The `http://floci:4566` endpoint is only resolvable from within the Docker container(s).

## Building and starting the service

This service has been configured to run in a Docker container and it is recommended to utilise Docker and Docker Compose for local development.

Build the container:

```bash
npm run docker:build
```

Start the container:

```bash
npm run docker:dev
```

Start the container in detached mode:

```bash
npm run docker:dev:d
```

Stop the container:

```bash
npm run docker:stop
```

Stop the container and delete volumes:

```bash
npm run docker:stop:v
```

## Debugging

Start in debug mode:

```bash
npm run docker:debug
```

Debug port: `9232`. Attach via VS Code or Chrome DevTools.

## Testing

Tests are configured to run in Docker.

Start the test container:

```bash
npm run docker:test
```

The test container can also be started in watch mode to support Test Driven Development (TDD):

```bash
npm run docker:test:watch
```

Direct local execution with `npm run test` or `npm run test:watch` is not a supported workflow unless you manually provide all required environment variables in your shell.

## Linting

Run the linter (neostandard):

```bash
npm run lint
```

Auto-fix linting issues:

```bash
npm run lint:fix
```

## SonarQube Cloud scan

Run a local scan against [SonarCloud](https://sonarcloud.io/project/overview?id=DEFRA_fcp-sfd-crm) for the current git branch. See the [DEFRA SonarCloud guide](https://github.com/DEFRA/cdp-documentation/blob/main/how-to/sonarcloud.md) for organisation access and CI setup.

### Setup

1. Log in to [SonarQube Cloud](https://sonarcloud.io) with your DEFRA GitHub account
2. Go to **My Account → Security → Generate Tokens** and create a personal token
3. Add `SONAR_TOKEN=<your-token>` to your `.env` file
4. Ensure Docker is running

### Run

Generate test coverage first, then scan:

```bash
npm run docker:test
npm run sonar
```

The script uploads results for the current branch and prints:

- Quality gate pass/fail and failed conditions
- Open issues on new code (when the gate fails)
- **Accepted / false-positive issues without comment** — DEFRA quality gates require a justification comment on each suppressed issue; add comments in SonarCloud under the issue **Activity** tab

Exit code is `0` when the gate passes and all suppressed issues are commented, `1` otherwise.

## HTTP Retry

Outbound HTTP calls (CRM API and auth token requests) use [`@fetchkit/ffetch`](https://github.com/fetch-kit/ffetch) with configurable retry and exponential backoff.

### Error classification

| Category | Triggers | Behaviour |
|---|---|---|
| `retryable` | 5xx responses, 429 Too Many Requests, network errors (`ECONNREFUSED`, `ETIMEDOUT`, etc.), timeout | Retried up to `HTTP_RETRY_MAX_ATTEMPTS` |
| `nonRetryable` | 4xx responses (excluding 429), user abort | Not retried — fails immediately |
| `unknown` | Unrecognised/unexpected errors | Retried up to `RETRY_UNKNOWN_MAX_ATTEMPTS` (conservative budget) |

### Retry metadata

The HTTP client preserves existing success response contracts. For terminal thrown errors (for example, timeout/network failures), the error is enriched with:

- `error.retryMetadata.attempts`
- `error.retryMetadata.category` (`retryable`, `non-retryable`, `unknown`)
- `error.retryMetadata.terminalReason`

Retry decisions, terminal failures, and retry recovery are logged from the HTTP client layer using ECS-style `event.*` fields.

### Configuration

| Variable | Default | Description |
|---|---|---|
| `HTTP_RETRY_MAX_ATTEMPTS` | `3` | Total attempts (including first) for retryable errors |
| `HTTP_RETRY_BASE_DELAY_MS` | `500` | Initial backoff delay in milliseconds |
| `HTTP_RETRY_BACKOFF_MULTIPLIER` | `1.5` | Multiplier applied each retry (500 → 750 → 1125 ms) |
| `HTTP_RETRY_JITTER_PERCENTAGE` | `15` | ±% random jitter added to each delay to avoid thundering herd |
| `HTTP_RETRY_MAX_DELAY_MS` | `15000` | Hard cap on any single retry delay |
| `CRM_HTTP_TIMEOUT_MS` | `10000` | Per-attempt timeout for CRM API calls |
| `CRM_AUTH_HTTP_TIMEOUT_MS` | `5000` | Per-attempt timeout for auth/token requests |
| `RETRY_UNKNOWN_MAX_ATTEMPTS` | `2` | Total attempts for unknown errors (1 retry) |
| `RETRY_UNKNOWN_MAX_DELAY_MS` | `10000` | Hard cap on unknown-error retry delays |

Two clients are exported: `httpClient` (CRM API) and `authHttpClient` (token endpoint) — both share the same retry policy but use different per-attempt timeouts.

See [`src/config/retry.js`](src/config/retry.js) and [`src/http/client.js`](src/http/client.js) for implementation details.

## Licence

THIS INFORMATION IS LICENSED UNDER THE CONDITIONS OF THE OPEN GOVERNMENT LICENCE found at:

<http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3>

The following attribution statement MUST be cited in your products and applications when using this information.

> Contains public sector information licensed under the Open Government license v3

### About the licence

The Open Government Licence (OGL) was developed by the Controller of His Majesty's Stationery Office (HMSO) to enable
information providers in the public sector to license the use and re-use of their information under a common open
licence.

It is designed to encourage use and re-use of information freely and flexibly, with only a few conditions.
