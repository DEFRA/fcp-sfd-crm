# Audit events emitted by fcp-sfd-crm

This service publishes audit events to the audit SNS topic (`fcp_audit_fcp_sfd_crm`
locally, see `AUDIT_TOPIC_ARN`) via `@defra/fcp-audit-publisher`, per the canonical
event table from Spike FLS1-21 ("Audited Events Across the System").

Every event is validated against the publisher's schema before a network call is
attempted, so a malformed event never reaches SNS and the schema-versus-transport
failure classification is deterministic rather than inferred from a third-party
error string. A failure to audit never affects message processing outcome, that
is acknowledgement, redelivery or DLQ routing. See
`src/messaging/outbound/audit/send-audit-event.js`.

## Events emitted

| # | Entity | Action | `entityid` | Trigger | Emitted from |
|---|--------|--------|------------|---------|--------------|
| 1 | document | created | `caseId` | Case created for an inbound document upload message | `src/services/case.js` (`createNewCase`) |
| 2 | document | created | `metadataId` | Document attached to an existing case | `src/services/case.js` (`addMetadataToExistingCase`) |
| 3 | person | read | `contactId` | `getContactIdFromCrn()` resolves a contact | `src/services/crm-helpers.js` (`ensureContactAndAccount`) |
| 4 | business | read | `accountId` | `getAccountIdFromSbi()` resolves an account | `src/services/crm-helpers.js` (`ensureContactAndAccount`) |
| 5 | person | read | `""` | CRN has no match | `src/services/crm-helpers.js` (`ensureContactAndAccount`) |
| 6 | business | read | `""` | SBI has no match | `src/services/crm-helpers.js` (`ensureContactAndAccount`) |

Rows 5 and 6 carry `audit.status: "failure"` with `audit.details.reason` of
`"CRN not found"` or `"SBI not found"`. Per the spike's "Standardised Entities and
Actions" note, a not-found is a read with a failure status rather than a separate
action. The schema requires `entityid`, so it is sent as an empty string rather
than omitted. Every other row carries `audit.status: "success"`.

`correlationid` is populated from the inbound CloudEvents message's
`correlationId`. `accounts` carries only the identifiers relevant to the event:
`crn` on rows 3 and 5, `sbi` on rows 4 and 6, both on rows 1 and 2. Absent keys
are omitted rather than sent as null.

## Values pending confirmation

| Value | Setting | Status |
|-------|---------|--------|
| `ip` sentinel for message consumers | `0.0.0.0` | Agreed with fcp-audit (FLS1-50 decision log) |

A message consumer has no meaningful client IP, so the sentinel stands in for the
schema's required `ip` field.

`mergeWithPublishDefaults` in `send-audit-event.js` mirrors the publisher's private
`applyDefaults`, which version 1.0.7 does not export. Nothing detects drift if the
dependency is bumped. Worth asking the fcp-audit team to export it, or better, to
return a classified result rather than a generic `Error`.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `AUDIT_TOPIC_ARN` | none, **required** | ARN of the audit SNS topic |
| `AWS_SNS_REQUEST_TIMEOUT_MS` | `3000` | Socket and connection timeout for SNS requests |
| `AWS_SNS_MAX_ATTEMPTS` | `2` | Total attempts, including the first, for an SNS request |

`AUDIT_TOPIC_ARN` is not nullable in `src/config/messaging.js`, so the service
fails to start without it rather than dropping every audit event at publish time.

The timeout and attempt bounds matter because publishing happens inside the SQS
`handleMessage` callback. Without them a degraded SNS endpoint could extend message
processing past the queue's visibility timeout and cause redelivery.

## Failure logging

An audit publish failure is logged, never thrown. The log carries a classification
only, never the event payload, auth tokens or CRM API responses, any of which may
contain PII:

- `event.type: "error"`, `event.action: "audit_publish_failed"`, `event.category: "process"`, `event.outcome: "failure"`
- `event.reason`: `schema_validation`, `transport` or `unexpected`
- `event.reference`: the `correlationid`, omitted when there is none
- `error.type`: the error class name on transport and unexpected failures
- `audit.validation.fields`: the failing field labels on a schema failure, never the joi message, since some joi rules interpolate the offending value

## Tests

- `test/unit/messaging/outbound/audit/build-audit-event.test.js` covers the builders.
- `test/unit/messaging/outbound/audit/send-audit-event.test.js` covers publishing, the failure classification and the non-throwing contract.
- `test/integration/narrow/audit/audit-events.test.js` validates every event against the publisher schema, reading the payload off the SNS command input rather than the builder output.
- `test/integration/narrow/audit/audit-failure-isolation.test.js` runs the real case service and audit path against a rejecting SNS client, and asserts that message processing outcome (delete, leave on queue, DLQ) is unchanged and that the not-found business errors are still thrown.
