#!/usr/bin/env sh
# Replay messages from the CRM inbound DLQ back to the main queue.
#
# Each replayed message is annotated with:
#   replayed_from = DLQ
#   replay_timestamp = <ISO 8601>
#
# The fcp-sfd-crm consumer detects these attributes and emits a
# crm.dlq.message_replayed structured log entry on pickup.
#
# Usage:
#   CRM_QUEUE_URL=<main-queue-url> \
#   CRM_DEAD_LETTER_QUEUE_URL=<dlq-url> \
#     ./scripts/replay-dlq-messages.sh
#
# Optional env vars:
#   AWS_REGION            (default: eu-west-2)
#   AWS_ENDPOINT_URL      (set to http://localhost:4566 for local Floci)
#   MAX_MESSAGES          max messages to replay in one run (default: unlimited)

set -e

REGION="${AWS_REGION:-eu-west-2}"
MAX_MESSAGES="${MAX_MESSAGES:-}"
REPLAYED=0

if [ -z "$CRM_QUEUE_URL" ]; then
  echo "ERROR: CRM_QUEUE_URL is required" >&2
  exit 1
fi

if [ -z "$CRM_DEAD_LETTER_QUEUE_URL" ]; then
  echo "ERROR: CRM_DEAD_LETTER_QUEUE_URL is required" >&2
  exit 1
fi

AWS_ARGS="--region $REGION"
if [ -n "$AWS_ENDPOINT_URL" ]; then
  AWS_ARGS="$AWS_ARGS --endpoint-url $AWS_ENDPOINT_URL"
fi

REPLAY_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "Replaying DLQ messages from: $CRM_DEAD_LETTER_QUEUE_URL"
echo "Destination queue:           $CRM_QUEUE_URL"
echo "Replay timestamp:            $REPLAY_TIMESTAMP"
echo ""

while true; do
  if [ -n "$MAX_MESSAGES" ] && [ "$REPLAYED" -ge "$MAX_MESSAGES" ]; then
    echo "Reached MAX_MESSAGES ($MAX_MESSAGES). Stopping."
    break
  fi

  BATCH_SIZE=10
  if [ -n "$MAX_MESSAGES" ]; then
    REMAINING=$((MAX_MESSAGES - REPLAYED))
    if [ "$REMAINING" -lt "$BATCH_SIZE" ]; then
      BATCH_SIZE=$REMAINING
    fi
  fi

  # shellcheck disable=SC2086
  RESPONSE=$(aws sqs receive-message $AWS_ARGS \
    --queue-url "$CRM_DEAD_LETTER_QUEUE_URL" \
    --max-number-of-messages "$BATCH_SIZE" \
    --visibility-timeout 30 \
    --attribute-names All \
    --message-attribute-names All \
    --output json 2>/dev/null || echo '{}')

  # node is used for JSON parsing — guaranteed available in CDP Node.js container images.
  PARSE="node scripts/lib/parse-sqs-batch.js"
  MESSAGE_COUNT=$(echo "$RESPONSE" | $PARSE count 2>/dev/null || echo 0)

  if [ "$MESSAGE_COUNT" -eq 0 ]; then
    echo "No more messages on DLQ. Done."
    break
  fi

  i=0
  while [ "$i" -lt "$MESSAGE_COUNT" ]; do
    MSG_ID=$(echo "$RESPONSE" | $PARSE get "$i" MessageId)
    RECEIPT=$(echo "$RESPONSE" | $PARSE get "$i" ReceiptHandle)
    BODY=$(echo "$RESPONSE" | $PARSE get "$i" Body)

    # Send to main queue with replay attributes
    # shellcheck disable=SC2086
    aws sqs send-message $AWS_ARGS \
      --queue-url "$CRM_QUEUE_URL" \
      --message-body "$BODY" \
      --message-attributes "{
        \"replayed_from\": {\"DataType\": \"String\", \"StringValue\": \"DLQ\"},
        \"replay_timestamp\": {\"DataType\": \"String\", \"StringValue\": \"$REPLAY_TIMESTAMP\"}
      }" \
      --output json > /dev/null

    # Delete from DLQ only after successful send
    # shellcheck disable=SC2086
    aws sqs delete-message $AWS_ARGS \
      --queue-url "$CRM_DEAD_LETTER_QUEUE_URL" \
      --receipt-handle "$RECEIPT"

    echo "Replayed: $MSG_ID"
    REPLAYED=$((REPLAYED + 1))
    i=$((i + 1))
  done
done

echo ""
echo "Total replayed: $REPLAYED"
