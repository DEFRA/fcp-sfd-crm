# Copilot Instructions for fcp-sfd-crm

## Overview

**fcp-sfd-crm** is a Node.js CRM orchestration service for the Single Front Door (SFD) platform. It handles case management, messaging (SQS/SNS), authentication with external CRM systems, and integrates with MongoDB for persistence.

**Tech Stack:**
- Node.js 24+ (ES modules)
- Hapi.js for HTTP API
- MongoDB for data storage
- AWS SQS/SNS for messaging
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

Single test file (requires env vars from `.env` — run inside Docker or with env loaded):
```bash
npm run docker:test
```

> **Note:** Do not run `npm test` or `npx vitest run` directly — the config validation requires env vars that are only available inside the Docker environment.

**Coverage Requirements:** 100% statements, lines, branches; 97% functions. Excluded files: `src/index.js`, `src/data/db.js`, `src/messaging/sqs/client.js`.

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

## Architecture

### Directory Structure

- **`src/index.js`** - Application entry point; starts HTTP server and messaging consumers
- **`src/server.js`** - Hapi server creation with security/logging plugins
- **`src/routes/`** - HTTP route definitions (e.g., create-case-with-online-submission)
- **`src/api/`** - HTTP handlers and shared API utilities (plugins, middleware, helpers, proxy setup)
- **`src/services/`** - Business logic layer:
  - **`case.js`** - Case operations and lifecycle management
  - **`create-case-with-online-submission-in-crm.js`** - CRM case creation with online submission
  - **`crm-helpers.js`** - CRM integration utilities
- **`src/repos/`** - Data access layer for MongoDB:
  - **`cases.js`** - Case repository with indexing
  - **`crm.js`** - CRM-related data operations
  - **`token.js`** - Authentication token storage
- **`src/messaging/`** - Event-driven messaging:
  - **`inbound/`** - SQS consumer for incoming CRM messages
  - **`outbound/`** - SNS publisher for case events
  - **`outbound/received-event/`** - Event publishing utilities
  - **`sns/`** & **`sqs/`** - AWS client configuration
- **`src/auth/`** - CRM authentication:
  - **`generate-crm-auth-token.js`** - Token generation (OAuth2 client credentials)
  - **`get-crm-auth-token.js`** - Token retrieval/caching
- **`src/config/`** - Configuration management using Convict (validates against schema):
  - **`index.js`** - Main config aggregator
  - **`server.js`**, **`auth.js`**, **`crm.js`**, **`queue.js`**, **`aws.js`**, **`messaging.js`** - Config schemas
- **`src/constants/`** - Constant definitions (events, source, environments, case-types)
- **`src/logging/`** - Pino logger setup with request/correlation tracking
- **`src/data/`** - MongoDB client initialization
- **`src/utils/`** - Shared utility functions
- **`test/unit/`** - Unit tests (mirroring src structure)
- **`test/integration/`** - Integration tests
- **`test/mocks/`** - Shared test mocks

### Data Flow

1. **Inbound:** SQS queue → `messaging/inbound/consumer` → `services/case.js` → MongoDB
2. **Outbound:** Service → `messaging/outbound` → SNS topic
3. **HTTP:** Route handler → Service layer → Repository → MongoDB

### Configuration

Configuration is centralized in `src/config/index.js` and loaded via environment variables. Config schemas are defined in separate files (`server.js`, `auth.js`, `crm.js`, `queue.js`, `aws.js`, `messaging.js`). Validation is strict—all env vars must be declared in the schema.

## Key Conventions

### Module Imports
- Use ES modules (`import`/`export`)
- Prefer relative paths from `src/` (e.g., `import { config } from '../config/index.js'`)

### Error Handling
- Use `@hapi/boom` for HTTP errors in route handlers
- Validation uses Joi schemas defined in routes
- Logs include correlation IDs for request tracing

### Testing Patterns
- **Setup:** Use `beforeEach(vi.clearAllMocks())` to reset mocks
- **Mocks:** Import modules dynamically after setting up mocks with `vi.mock()`
- **Assertions:** Expect exact calls: `expect(fn).toHaveBeenCalledWith(...)`
- Test files mirror source structure: `src/foo/bar.js` → `test/unit/foo/bar.test.js`

### Logging
- Create logger: `const logger = createLogger()`
- Log events with context: `logger.info('message')`, `logger.error(error)`
- Correlation ID is automatically attached from request context

### MongoDB
- Database collection access: `db.collection('collectionName')`
- Use `findOneAndUpdate` with `returnDocument: 'after'` for atomic operations
- Always create indexes for frequently queried fields

### AWS Integration
- SQS/SNS clients are configured with environment endpoint (supports Floci)
- Region and credentials from env vars (`AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)

### Environment Variables
Create a `.env` file from `.env.example`. Key variables:
- `PORT` - HTTP port (default: 3009)
- `MONGO_URI` - MongoDB connection string
- `CRM_*` - CRM authentication and API endpoints
- `CRM_QUEUE_URL` / `CRM_DEAD_LETTER_QUEUE_URL` - SQS queue URLs
- `CRM_EVENTS_TOPIC_ARN` - SNS topic for publishing events
- `AWS_*` - AWS credentials and region

### Docker Development
- Source code volume-mounted for hot reload (`./src/:/home/node/src`)
- Dependent services: MongoDB, Floci (mocks S3, SQS, SNS)
- Tests run in isolated container with cleanup

## Common Tasks

### Adding a New Route
1. Create handler in `src/routes/my-route.js`, export a route factory function
2. Add Joi schema for validation in the route definition
3. Call service layer for business logic
4. Return payload or Boom error
5. Register in `src/server.js`
6. Add unit tests in `test/unit/routes/my-route.test.js`

### Adding a Service
1. Create `src/services/my-feature.js` with exported functions
2. Call repository functions for data access
3. Handle errors with context (use logger)
4. Add unit tests in `test/unit/services/my-feature.test.js` with mocked repos

### Querying MongoDB
1. Use repository functions in `src/repos/` (cases.js, etc.)
2. Each repo function handles a specific operation
3. Create indexes if needed (see `setCorrelationIdIndex` in cases.js)

### Publishing Events
- Use `publishMessage` from `src/messaging/outbound/` with SNS topic ARN
- Include correlation ID in message metadata for tracing

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