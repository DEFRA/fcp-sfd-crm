# Runbook: CRM Inbound DLQ Recovery

**Queue:** `fcp_sfd_crm_requests-deadletter`  
**Service:** `fcp-sfd-crm`  
**Replay script:** `scripts/replay-dlq-messages.sh`

---

## Prerequisites

Before this runbook is applicable in production, the infra team must confirm:

- `MessageRetentionPeriod` on the DLQ is set to **1209600 seconds (14 days)**
- `maxReceiveCount` on the main queue redrive policy is set to **3**

These are defined in `cdp-tenant-config` under `sqs_queues[name=fcp_sfd_crm_requests]`.

---

## Step 1 — Monitor

Messages land on the DLQ under two conditions:

1. **Non-retryable failure** — consumer explicitly sent the message to the DLQ (4xx from CRM API, invalid JSON, schema validation failure). Log entry: `event.type = crm.dlq.message_received`.
2. **Retry exhaustion** — SQS automatically moved the message after `maxReceiveCount` receive attempts with retryable errors (5xx, timeouts).

Check DLQ depth:

```bash
aws sqs get-queue-attributes \
  --queue-url "$CRM_DEAD_LETTER_QUEUE_URL" \
  --attribute-names ApproximateNumberOfMessages
```

Inspect recent logs for `crm.dlq.message_received` entries to understand error classification and affected `fileId` values.

---

## Step 2 — Triage

Receive a message from the DLQ **without deleting it** (visibility timeout: 300s):

```bash
aws sqs receive-message \
  --queue-url "$CRM_DEAD_LETTER_QUEUE_URL" \
  --attribute-names All \
  --message-attribute-names All \
  --max-number-of-messages 1
```

Check the `error.errorClassification` in logs for this `MessageId`:

| Classification | Cause | Action |
|---|---|---|
| `non-retryable` | CRM returned 4xx (permanent rejection) | Investigate payload; fix data before replay |
| `retryable` (exhausted) | CRM returned 5xx / timeouts repeatedly | Check CRM health; replay when stable |
| `invalid_json` | Message body is malformed | Investigate upstream publisher; discard |
| `schema_invalid` | Message does not match CloudEvents schema | Investigate upstream publisher; discard |

---

## Step 3 — Decide

- **Replay**: message is structurally valid and failure was transient (CRM was down, rate-limited, etc.)
- **Discard**: message is permanently invalid (bad JSON, schema mismatch, data error that CRM will always reject)

To discard a specific message, delete it by receipt handle:

```bash
aws sqs delete-message \
  --queue-url "$CRM_DEAD_LETTER_QUEUE_URL" \
  --receipt-handle "<ReceiptHandle>"
```

---

## Step 4 — Replay

Use the replay script to move messages from the DLQ back to the main queue:

```bash
# Replay all messages currently visible on the DLQ
CRM_QUEUE_URL="<main-queue-url>" \
CRM_DEAD_LETTER_QUEUE_URL="<dlq-url>" \
  ./scripts/replay-dlq-messages.sh
```

The script:
1. Receives up to 10 messages at a time from the DLQ
2. Re-sends each to the main queue with `replayed_from=DLQ` and `replay_timestamp` message attributes
3. Deletes each message from the DLQ after successful re-send

When the consumer processes a replayed message it emits:

```json
{
  "event": {
    "type": "crm.dlq.message_replayed",
    "action": "process_replayed_message",
    "reference": "<MessageId>"
  }
}
```

---

## Step 5 — Verify

1. Confirm DLQ depth has dropped:
   ```bash
   aws sqs get-queue-attributes \
     --queue-url "$CRM_DEAD_LETTER_QUEUE_URL" \
     --attribute-names ApproximateNumberOfMessages
   ```

2. Check service logs for `crm.dlq.message_replayed` followed by successful case creation (`Case created` or `Metadata added to existing case`).

3. If the replayed message fails again:
   - Retryable error → it will be retried via visibility timeout; monitor for re-entry to DLQ
   - Non-retryable error → it will be re-routed to the DLQ; triage again from Step 2

---

## Environment variables

| Variable | Description |
|---|---|
| `CRM_QUEUE_URL` | Main inbound SQS queue URL |
| `CRM_DEAD_LETTER_QUEUE_URL` | DLQ URL |
| `AWS_REGION` | AWS region (default: `eu-west-2`) |
| `AWS_ACCESS_KEY_ID` | AWS credentials |
| `AWS_SECRET_ACCESS_KEY` | AWS credentials |
