# Plan: LocalStack → Floci Migration

## TL;DR
Migrate from LocalStack (now requires paid license) to Floci (free, open-source AWS emulator). Replace LocalStack Docker service with Floci, update all endpoint URLs from `localhost/localstack` to `floci`, remove LocalStack initialization hooks, add separate Floci initialization service, and update documentation. Changes are straightforward and backward-compatible for Node.js/AWS SDK v3 apps.

---

## Steps

### Phase 1: Analyze Current Setup (parallel activities)
1. Identify all Docker Compose files that reference LocalStack (`compose.yaml`, `compose.override.yaml`, `compose.debug.yaml`, `compose.test.yaml`, etc.)
2. Locate all initialization scripts (e.g., `compose/start-localstack.sh`, `localstack/localstack.sh`)
3. Find all LocalStack endpoint references in:
   - Environment variable definitions (`AWS_ENDPOINT_URL`, `AWS_SQS_QUEUE_URL`, `S3_ENDPOINT`, `SNS_ENDPOINT`)
   - AWS SDK client configurations (S3, SNS, SQS clients)
   - Configuration files (convict schemas, AWS region/endpoint config)
4. Document what AWS services are used (S3, SNS, SQS, DynamoDB, etc.) to ensure Floci supports them

### Phase 2: Update Docker Compose Files (sequential, depends on Phase 1)
1. **Replace LocalStack service definition:**
   - Change `image: localstack/localstack:x.x.x` → `image: hectorvent/floci:latest` (or pinned version like `1.0.11`)
   - Remove LocalStack env vars: `LS_LOG`, `SERVICES`
   - Add Floci env vars:
     - `FLOCI_HOSTNAME: floci` (enables correct URLs from container-to-container communication)
     - `FLOCI_DEFAULT_REGION: <region>` (e.g., `eu-west-2`)
   - Keep: `AWS_ACCESS_KEY_ID: test`, `AWS_SECRET_ACCESS_KEY: test`
   - **Remove:** LocalStack healthcheck (`curl localhost:4566`)
   - Update volumes:
     - Remove: `-./localstack/init/ready.d/start-localstack.sh:/etc/localstack/init/ready.d/start-localstack.sh`
     - Change: `localstack-data:/var/lib/localstack` → `floci-data:/app/data`

2. **Add separate initialization service** (new `floci-init` service):
   - Image: `amazon/aws-cli:latest`
   - Entrypoint: `/bin/sh`
   - Command: `/setup/init.sh`
   - Depends on: `floci` (condition: `service_started`—no healthcheck needed)
   - Environment: AWS credentials + `AWS_ENDPOINT_URL: http://floci:4566`
   - Volumes: Mount initialization script at `/setup/init.sh`
   - **Rationale:** Floci doesn't have a built-in initialization hook like LocalStack's `/etc/localstack/init/ready.d/`. Using AWS CLI container is cleaner than running CLI tools inside the app container.

3. **Update service dependencies:**
   - Change: `localstack: { condition: service_healthy }` → `floci-init: { condition: service_completed_successfully }`
   - Ensures initialization runs before app starts

4. **Update endpoint environment variables in all services:**
   - Replace `http://localstack:4566` → `http://floci:4566` in all env vars across all services
   - For host access (e.g., in compose.override.yaml): `http://localhost:4566` remains the same

5. **Update volume declarations:**
   - In `volumes:` section, replace `localstack-data:` → `floci-data:`

6. **Repeat for all compose files:**
   - `compose.yaml` (main)
   - `compose.override.yaml` (local dev port exposure)
   - `compose.debug.yaml` (if exists)
   - `compose.test.yaml` (if exists)

### Phase 3: Update Initialization Scripts
1. **Delete LocalStack initialization file(s):**
   - Remove `localstack/localstack.sh` or `compose/start-localstack.sh`

2. **Create Floci initialization script** (e.g., `floci/init.sh`):
   - Uses AWS CLI commands (standard `aws sqs`, `aws sns`, `aws s3` commands—no LocalStack-specific syntax)
   - Structure:
     ```bash
     #!/usr/bin/env sh
     
     # Wait for Floci to be ready
     until aws sqs list-queues > /dev/null 2>&1; do
       sleep 1
     done
     
     # Create SQS queues with DLQs
     create_queue() {
       local QUEUE_NAME=$1
       local DLQ_NAME="${QUEUE_NAME}-deadletter"
       
       aws sqs create-queue --queue-name "${DLQ_NAME}" --region "${AWS_REGION}" ...
       aws sqs create-queue --queue-name "${QUEUE_NAME}" --region "${AWS_REGION}" \
         --attributes '{"VisibilityTimeout":"60","RedrivePolicy":"..."}'
     }
     
     # Create SNS topics
     create_topic() {
       local TOPIC_NAME=$1
       aws sns create-topic --name "${TOPIC_NAME}" --region "${AWS_REGION}"
     }
     
     # Subscribe queues to topics
     subscribe_queue_to_topic() { ... }
     
     # Call setup functions for each resource
     create_queue "my_queue"
     create_topic "my_topic"
     subscribe_queue_to_topic "my_topic" "my_queue"
     ```
   - **Key difference:** No LocalStack-specific `--endpoint-url=http://localhost:4566/...` needed; AWS CLI reads `AWS_ENDPOINT_URL` env var automatically via compose environment

3. **Make script executable:**
   - `chmod +x floci/init.sh`

### Phase 4: Update AWS SDK Client Configurations
1. **Rename config object keys** to remove LocalStack naming:
   - Rename config schema object: `aws.localstack` → `aws.local`
   - Update all references: `config.get('aws.localstack.*')` → `config.get('aws.local.*')`
   - This is a simple find/replace in config files and SDK client code
   
2. **Remove stray environment variables:**
   - Remove any `LOCALSTACK_ENDPOINT` env vars from compose files (replace with unified `AWS_ENDPOINT_URL`)
   - Search all compose files for `LOCALSTACK_ENDPOINT` references

3. **Review S3 client implementation:**
   - Verify `forcePathStyle: true` config is used (Floci compatible)
   - Ensure endpoint config uses `aws.local.s3Endpoint` or `AWS_ENDPOINT_URL`

4. **Update documentation strings:**
   - Config doc comments should reference "local AWS emulator (Floci)" instead of "localstack"

### Phase 5: Update Configuration & Documentation
1. **Config files:**
   - Update comments in convict schemas: "AWS endpoint URL for LocalStack" → "AWS endpoint URL for local AWS emulation"
   - Ensure `aws.region`, `aws.endpoint`, `aws.snsEndpoint`, `aws.s3Endpoint` configs remain unchanged (values will be set via env vars)

2. **README.md:**
   - Replace all "LocalStack" references → "Floci"
   - Update setup instructions (point to new `floci/init.sh` instead of old LocalStack script)
   - Update compose.yaml example to show Floci service + `floci-init` initialization
   - Remove LocalStack-specific configuration docs (e.g., LocalStack licensing, startup behavior)
   - Add note about Floci benefits (free, native binary, ~90 MB image, ~24 ms startup)

3. **Copilot instructions:**
   - Update references: "Spins up MongoDB, LocalStack, ..." → "Spins up MongoDB, Floci, ..."

4. **AsyncAPI / OpenAPI docs:**
   - Update server descriptions: "LocalStack SQS for local development" → "Floci SQS for local development"

### Phase 6: Testing & Validation (parallel activities)
1. **Local testing:**
   - Run `npm run docker:dev` (or equivalent) and verify:
     - Floci service starts successfully
     - `floci-init` service creates queues/topics and completes with exit code 0
     - Application service starts after `floci-init` completes
     - Application can connect to Floci at `http://floci:4566`
     - S3/SNS/SQS operations work as expected

2. **Test suite:**
   - Run `npm run docker:test` (or equivalent) to ensure integration tests pass
   - Tests using real AWS SDK against Floci should work out-of-the-box (no SDK changes needed)
   - Verify mocked tests still pass (they don't depend on real Floci)

3. **Verify initialization:**
   - Manually check Floci queues/topics exist:
     ```bash
     aws sqs list-queues --endpoint-url http://localhost:4566
     aws sns list-topics --endpoint-url http://localhost:4566
     ```

4. **CI/CD smoke test:**
   - If using Docker-based CI (GitHub Actions, etc.), verify compose.yaml changes work in containerized test environment
   - Run linter on any modified files

### Phase 7: Cleanup & Finalize
1. **Remove LocalStack references:**
   - Delete `localstack/` directory (or `compose/start-localstack.sh`, depending on repo structure)
   - Remove any LocalStack-specific ignore patterns from `.gitignore`

2. **Update .gitignore (if needed):**
   - Ensure `floci-data/` volume directory is ignored (if persisting LocalState)

3. **Commit organization:**
   - **Option A (atomic):** Single commit with all changes if repo is small
   - **Option B (staged):** Separate commits:
     1. Docker Compose changes + initialization script
     2. Config/documentation updates
     3. Cleanup

4. **PR/Merge:**
   - Create PR with clear title: "Migrate from LocalStack to Floci"
   - In PR description, note: "Floci is free and open-source; LocalStack now requires paid license"
   - Reference Floci GitHub repo for any questions

---

## Relevant files

### Docker Compose files (update):
- `compose.yaml` — Main service definitions, environment vars, dependencies
- `compose.override.yaml` — Port mappings, volume overrides
- `compose.debug.yaml` — If it exists; inherits from base
- `compose.test.yaml` — If it overrides LocalStack config

### Initialization scripts (replace):
- `localstack/localstack.sh` or `compose/start-localstack.sh` — Delete
- `floci/init.sh` (new) — Create with AWS CLI commands

### AWS SDK & config (review, likely no changes):
- `src/s3/client.js` — Verify `forcePathStyle` and endpoint logic
- `src/messaging/sns/client.js` — Verify endpoint config
- `src/config/aws.js` — Verify region, endpoint keys; update comments
- `src/config/server.js` — If it has LocalStack-specific settings

### Documentation (update):
- `README.md` — Update setup instructions, remove LocalStack specifics
- `.github/copilot-instructions.md` — Update comments
- `docs/asyncapi/v1.yaml` — Update server descriptions

---

## Verification

1. **Docker Compose startup:**
   - Run `docker compose up --build` and verify no errors
   - Floci service healthiness (no explicit check; AWS CLI in `floci-init` waits for it)
   - `floci-init` exits with code 0 after creating resources

2. **Connectivity test:**
   - From app container: `curl http://floci:4566/health` (or list SQS queues)
   - From host (if override exposes port): `curl http://localhost:4566/health`

3. **Integration tests:**
   - `npm run docker:test` passes all tests
   - S3, SNS, SQS operations work as before

4. **Code quality:**
   - `npm run lint` passes (no new linting issues)
   - No hardcoded "LocalStack" strings remain in comments/strings (unless in git history or docs)

5. **Documentation review:**
   - All Floci references are consistent
   - Setup instructions are clear and accurate
   - No breaking changes documented

---

## Decisions

1. **Floci image versioning:** Use `latest` tag initially; consider pinning a stable version (e.g., `1.0.11`) in production once stable
2. **Initialization pattern:** Use separate `floci-init` service with AWS CLI container instead of LocalStack's inline hooks—cleaner separation of concerns
3. **Healthcheck removal:** Floci doesn't expose a standard healthcheck endpoint; `floci-init` relies on polling SQS list-queues
4. **Backwards compatibility:** No changes needed to application code—only Docker Compose and init scripts

---

## Further Considerations

1. **Multi-repo rollout strategy:**
   - **Recommendation:** Start with 1−2 repos to validate the pattern, then create a reusable "Floci migration checklist" template across all repos
   - Document any repo-specific variations (e.g., if some repos use SQS only vs. S3 + SNS + SQS)
   - Consider adding Floci notes to your agent instructions for consistency

2. **Storage persistence (optional):**
   - Floci supports `FLOCI_STORAGE_MODE` (memory, persistent, hybrid, wal)
   - Default is `memory` (matches LocalStack behavior in dev)
   - If needing persistent state across restarts: set `FLOCI_STORAGE_MODE: persistent`

3. **Regional configuration:**
   - Ensure `FLOCI_DEFAULT_REGION` matches your app's `AWS_REGION` (both should be `eu-west-2` in your example)
   - Floci supports any AWS region name, but local default account ID is always `000000000000`
