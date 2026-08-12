# Audit events emitted by fcp-sfd-crm

This service publishes audit events to the shared `fcp-audit` SNS topic via
`@defra/fcp-audit-publisher`, per the canonical event table from Spike FLS1-21
("Audited Events Across the System"). Every event is validated against the
publisher's schema before it is sent; a failure to audit never affects
message processing outcome (see `src/messaging/outbound/audit/send-audit-event.js`).

| # | Entity | Action | entityid | Trigger | Emitted from |
|---|--------|--------|----------|---------|---------------|
| 1 | document | created | caseId | Case created for an inbound document upload message | `src/services/case.js` (`createNewCase`) |
| 2 | document | created | metadataId | Document attached to an existing case | `src/services/case.js` (`addMetadataToExistingCase`) |
| 3 | person | read | contactId | `getContactIdFromCrn()` resolves a contact | `src/services/crm-helpers.js` (`ensureContactAndAccount`) |
| 4 | business | read | accountId | `getAccountIdFromSbi()` resolves an account | `src/services/crm-helpers.js` (`ensureContactAndAccount`) |
| 5 | person | read | — (`status: "failure"`) | CRN has no match | `src/services/crm-helpers.js` (`ensureContactAndAccount`) |
| 6 | business | read | — (`status: "failure"`) | SBI has no match | `src/services/crm-helpers.js` (`ensureContactAndAccount`) |
| 7 | — (security event) | — | — | Invalid or missing `x-api-key` on `/create-case-with-online-submission` | `src/routes/create-case-with-online-submission.js` |

All events (except row 7) carry `accounts.crn` and/or `accounts.sbi` when
available, and `correlationid` populated from the inbound CloudEvents
message's `correlationId`. Row 7 carries both `security` and `audit` objects
so SOC can query it in MongoDB.

See `test/integration/narrow/audit/audit-events.test.js` for tests that
validate every emitted event against the publisher schema, and
`test/unit/messaging/inbound/consumer.test.js` for tests confirming audit
failures never change message processing outcome.
