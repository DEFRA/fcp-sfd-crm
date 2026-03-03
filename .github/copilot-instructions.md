# Copilot Instructions for fcp-sfd-crm

## Overview

**fcp-sfd-crm** is a Node.js CRM orchestration service for the Single Front Door (SFD) platform. It handles case management, messaging (SQS/SNS), authentication with external CRM systems, and integrates with MongoDB for persistence.

**Tech Stack:**
- Node.js 22+ (ES modules)
- Hapi.js for HTTP API
- MongoDB for data storage
- AWS SQS/SNS for messaging
- Docker & Docker Compose for local development

## Running Commands

### Testing

Run tests with coverage:
```bash
npm test
```

Watch mode (for TDD):
```bash
npm run test:watch
```

Run tests in Docker:
```bash
npm run docker:test
```

Watch mode in Docker:
```bash
npm run docker:test:watch
```

Single test file:
```bash
npx vitest run test/unit/path/to/test.test.js
```

**Coverage Requirements:** 100% statements, lines, branches; 97% functions. Excluded files: `src/index.js`, `src/data/db.js`, `src/messaging/sqs/client.js`.

### Linting

```bash
npm run test:lint
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
- SQS/SNS clients are configured with environment endpoint (supports LocalStack)
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
- Dependent services: MongoDB, LocalStack (mocks S3, SQS, SNS)
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
