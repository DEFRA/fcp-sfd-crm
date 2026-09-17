# Copilot Instructions for fcp-sfd-crm

## Overview

**fcp-sfd-crm** is a Node.js CRM orchestration service for the Single Front Door (SFD) platform. It consumes document upload events from SQS, orchestrates case creation in Dataverse CRM, publishes received and audit events to SNS, and uses MongoDB to coordinate idempotent case creation across multi-file submissions.

**Tech Stack:**
- Node.js 24+ (ES modules)
- Hapi.js for HTTP API
- MongoDB for data storage
- Dataverse CRM Web API
- AWS SQS/SNS for messaging
- Vitest for unit and integration tests
- Docker & Docker Compose for local development

## Running Commands

### Testing

Run tests with coverage (Docker — preferred):
```bash
npm run docker:test
```

Watch mode in Docker (for TDD):
```bash
npm run docker:test:watch
```

Single test file:
```bash
npx vitest run --no-coverage test/unit/server.test.js
```

> **Note:** `npm test` and `npx vitest run` work locally because `test/setup/env.js` seeds the minimum config required by Convict. Docker remains the standard path for full test runs and CI because it exercises the service with MongoDB and Floci.

**Coverage Requirements:** 90% statements, lines, branches, and functions. Excluded files: `src/index.js`, `src/data/db.js`, `src/messaging/sqs/client.js`.

### Linting

```bash
npm run lint
```

Uses **neostandard** (opinionated ESLint config).

### Local Development

Start in watch mode with hot reload:
```bash
npm run start:watch
```

Start with debugger enabled:
```bash
npm run start:debug
```

Debug port: 9232

### Docker

Build:
```bash
docker compose build
```

Run (auto-starts with `npm run start:watch`):
```bash
docker compose up
```

Debug mode:
```bash
npm run docker:debug
```

### CI Workflows

- **`.github/workflows/check-pull-request.yml`** builds the Docker image, runs the Docker based test stack, then runs SonarQube Cloud and Snyk scans.
- **`.github/workflows/publish.yml`** and **`publish-hotfix.yml`** rerun the Docker based tests before the CDP publish steps.

## Architecture

### Directory Structure

- **`src/index.js`** - Application entry point; starts HTTP server and messaging consumers
- **`src/server.js`** - Hapi server creation with request logging, tracing, secure context, and pulse plugins; intentionally registers no business routes
- **`src/api/`** - Shared Hapi helpers and Joi schemas for inbound, outbound, and HTTP payload validation; there are no application routes today
- **`src/services/`** - Business logic layer:
  - **`case.js`** - Case operations and lifecycle management
  - **`create-case-with-online-submission-in-crm.js`** - CRM case creation with online submission
  - **`crm-helpers.js`** - CRM integration utilities
- **`src/repos/`** - Data access layer for MongoDB and Dataverse:
  - **`cases.js`** - Case repository with indexing
  - **`crm.js`** - Dataverse reads and writes
  - **`dataverse-batch.js`** - `$batch` request construction and parsing
  - **`token.js`** - Authentication token storage
- **`src/messaging/`** - Event-driven messaging:
  - **`inbound/`** - SQS consumer for incoming CRM messages
  - **`outbound/audit/`** - Audit event publishing
  - **`outbound/received-event/`** - Received event publishing
  - **`sns/`** & **`sqs/`** - AWS client configuration
- **`src/auth/`** - CRM authentication:
  - **`generate-crm-auth-token.js`** - Token generation (OAuth2 client credentials)
  - **`get-crm-auth-token.js`** - Token retrieval/caching
  - **`strategies/`** - Client secret and federated credential auth strategies
- **`src/config/`** - Configuration management using Convict (validates against schema):
  - **`index.js`** - Main config aggregator
  - **`server.js`**, **`auth.js`**, **`crm.js`**, **`aws.js`**, **`messaging.js`**, **`retry.js`**, **`cases.js`** - Config schemas
- **`src/http/`** - Outbound HTTP clients with retry policy for CRM and triage calls
- **`src/constants/`** - Constant definitions (events, audit, messages, source, environments, case-types, metrics, triage values)
- **`src/logging/`** - Pino logger setup with request/correlation tracking
- **`src/data/`** - MongoDB client initialization and index helpers
- **`src/utils/`** - Shared utility functions
- **`test/unit/`** - Unit tests (mirroring src structure)
- **`test/integration/narrow/`** - Narrow integration tests for repo, audit, and service boundaries
- **`test/setup/`** - Vitest environment bootstrapping
- **`test/helpers/`** - Shared test helpers
- **`test/mocks/`** - Shared test mocks

### Data Flow

1. **Inbound:** SQS queue → inbound CloudEvent validation → `services/case.js` → MongoDB creator-role state + Dataverse
2. **Outbound:** Service → `messaging/outbound/received-event` and `messaging/outbound/audit` → SNS topics
3. **HTTP:** Hapi server hosts platform plugins and pod liveness only; the service currently exposes no business routes

### Configuration

Configuration is centralized in `src/config/index.js` and loaded via environment variables. Config schemas are defined in separate files (`server.js`, `auth.js`, `crm.js`, `aws.js`, `messaging.js`, `retry.js`, `cases.js`). Validation uses `config.validate({ allowed: 'strict' })`, so undeclared config is rejected.

## Key Conventions

### Module Imports
- Use ES modules (`import`/`export`)
- Prefer relative paths from `src/` (e.g., `import { config } from '../config/index.js'`)

### Error Handling
- Use Joi schemas in `src/api/schemas/` for inbound, outbound, and HTTP payload validation
- If HTTP handlers are added later, use `@hapi/boom` for route errors
- Logs include trace IDs and correlation IDs for request tracing

### Testing Patterns
- **Setup:** Use `beforeEach(vi.clearAllMocks())` to reset mocks
- **Mocks:** Import modules dynamically after setting up mocks with `vi.mock()`
- **Assertions:** Expect exact calls: `expect(fn).toHaveBeenCalledWith(...)`
- Test files mirror source structure: `src/foo/bar.js` → `test/unit/foo/bar.test.js`

### Logging
- Create logger: `const logger = createLogger()`
- Log events with context: `logger.info('message')`, `logger.error(error)`
- Correlation ID is automatically attached from request or message context, alongside CDP trace IDs when present

### MongoDB
- Database collection access: `db.collection('collectionName')`
- Use `findOneAndUpdate` with `returnDocument: 'after'` for atomic operations
- Always create indexes for frequently queried fields

### AWS Integration
- SQS/SNS clients can target real AWS endpoints or local Floci endpoints
- CRM received events publish to `CRM_EVENTS_TOPIC_ARN`; audit events publish to `AUDIT_TOPIC_ARN`
- Region, credentials, and SNS timeout or retry settings come from env vars

### Environment Variables
Create a `.env` file from `.env.example`. Key variables:
- `PORT`, `HOST`, `SERVICE_VERSION`, `ENVIRONMENT`, `LOG_*`
- `MONGO_URI`, `MONGO_DATABASE`
- `CRM_AUTH_*` plus `CRM_AUTH_FEDERATED_DISABLED`, `CRM_AUTH_FEDERATED_AUDIENCE`, `CRM_AUTH_FEDERATED_MOCK`
- `CRM_API_BASE_URL`, `CRM_CASE_ORIGIN_CODE`, `CRM_WRITE_FILES_IN_SUBMISSION`, `CRM_INTEGRATION_INBOUND_FAILURE_PROCESSING_ENTITY`
- `CRM_QUEUE_URL`, `CRM_DEAD_LETTER_QUEUE_URL`, `CRM_EVENTS_TOPIC_ARN`, `AUDIT_TOPIC_ARN`
- `HTTP_RETRY_*`, `CRM_*_HTTP_TIMEOUT_MS`, `RETRY_UNKNOWN_*`, `RETRY_AFTER_MAX_DELAY_MS`, `CASE_CREATION_DEADLINE_MS`
- `AWS_*`, plus optional `AWS_SNS_REQUEST_TIMEOUT_MS` and `AWS_SNS_MAX_ATTEMPTS`

### Docker Development
- Source code and `package.json` are volume-mounted for local development; tests also mount `test/` and `coverage/`
- Dependent services: MongoDB, Floci, and `floci-init` for local SQS/SNS setup
- Tests run in isolated container with cleanup

## Common Tasks

### Adding a New Route
1. This service currently registers no business routes; add one only if the service responsibility genuinely changes
2. Define validation alongside `src/api/schemas/`
3. Keep the handler thin and call the service layer for business logic
4. Return payload or Boom error
5. Register it in `src/server.js`
6. Add `server.inject()` coverage in `test/unit/server.test.js` or a neighbouring route test

### Adding a Service
1. Create `src/services/my-feature.js` with exported functions
2. Call repository functions for data access
3. Handle errors with context (use logger)
4. Add unit tests in `test/unit/services/my-feature.test.js` with mocked repos and add narrow integration tests if the change crosses repo or messaging boundaries

### Querying MongoDB
1. Use repository functions in `src/repos/` (cases.js, etc.)
2. Each repo function handles a specific operation
3. Create indexes if needed (see `setCorrelationIdIndex` in cases.js)

### Publishing Events
- Use `publishReceivedEvent` for CRM received events and `emitAuditEvent` for audit events
- Include correlation ID in event payloads and metadata for tracing

### Debugging
1. Start with `npm run start:debug` or `npm run docker:debug`
2. Attach debugger to localhost:9232 (VS Code/Chrome DevTools)
3. Use `node_modules/.bin/nodemon` for file watching during debugging


---

# Defra Standards Code Reviewer

You are an experienced code reviewer working on a Defra digital service. Review code systematically against Defra software development standards and common quality criteria.

## Review categories

Work through each category in order. Skip categories that do not apply to the change.

### 1. Correctness and behaviour
- The code does what the PR description says it does
- Edge cases are handled (null, empty, boundary values)
- Error paths return useful messages without leaking internals

### 2. Tests and coverage
- New code has unit tests covering the happy path and key error paths
- Test names describe the behaviour being verified
- Coverage does not decrease — target is 90% minimum (check SonarCloud quality gate)
- Route handlers include tests for validation failure, CSRF, and auth where applicable
- **Node.js**: Vitest for unit/integration tests, `server.inject()` for route testing (Hapi)

### 3. Security
- No secrets, API keys, or tokens in code (use environment variables)
- User input is validated and sanitised
- Dependencies are from trusted sources with no known vulnerabilities
- Logging does not contain PII (names, addresses, emails, NI numbers, bank details)
- SonarCloud security hotspots are reviewed and resolved
- No new vulnerabilities or code smells introduced (SonarWay profile)

### 4. Performance and reliability
- No blocking operations on the event loop (Node.js)
- Database queries are indexed and bounded
- External calls have timeouts and retry logic

### 5. Maintainability and readability
- No commented-out code
- Functions and variables have descriptive names
- Complex logic has explanatory comments or is split into named functions ("separate in order to name")
- No magic numbers or strings — use named constants

### 6. Architecture and boundaries
- Code follows the existing project structure
- Dependencies flow inward (controllers → services → repositories)
- No circular dependencies between modules

### 7. Documentation
- Public functions have JSDoc or XML doc comments
- README is updated if setup steps or prerequisites change
- Breaking changes are clearly documented

### 8. Accessibility (frontend changes only)
- HTML meets WCAG 2.2 Level AA
- Interactive elements are keyboard accessible
- Images have alt text, form fields have labels
- Error summaries link to the corresponding form field

## Severity levels

Use these labels for findings:

- **Blocking** — must fix before merge (security issues, incorrect behaviour, failing tests)
- **Recommended** — improves quality, discuss with author (readability, performance)
- **Nit** — minor preference, optional (formatting, naming style)

## Output format

Structure findings by file. For each file with issues, provide:
- **File:** `path/to/file.js` (line numbers)
- **Category & Severity:** Category name + [Blocking|Recommended|Nit]
- **Issue:** Clear description
- **Fix:** Suggested code snippet where helpful

Summarise at the end: total findings by severity, and whether the PR is ready to merge.

**Do not post comments about:**
- PR description or title
- Branch name or commit history
- Only post code review comments on the changed files themselves

## References

- [Defra common coding standards](https://github.com/DEFRA/software-development-standards/blob/main/docs/standards/common_coding_standards.md)
- [Defra security standards](https://github.com/DEFRA/software-development-standards/blob/main/docs/standards/security_standards.md)
- [Defra logging standards](https://github.com/DEFRA/software-development-standards/blob/main/docs/standards/logging_standards.md)