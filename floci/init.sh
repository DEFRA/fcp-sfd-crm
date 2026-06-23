#!/usr/bin/env sh

echo "Waiting for Floci to be ready..."
until aws sqs list-queues > /dev/null 2>&1; do
  sleep 1
done
echo "Floci is ready. Configuring SQS and SNS..."

create_queue() {
  local QUEUE_NAME=$1
  local DLQ_NAME="${QUEUE_NAME}-deadletter"

  aws sqs create-queue --queue-name "${DLQ_NAME}" --region "${AWS_REGION}" \
    --attributes '{
      "VisibilityTimeout": "300",
      "MessageRetentionPeriod": "1209600"
    }'

  DLQ_ARN=$(aws sqs get-queue-attributes \
    --queue-url "${AWS_ENDPOINT_URL}/000000000000/${DLQ_NAME}" \
    --attribute-names QueueArn \
    --query 'Attributes.QueueArn' \
    --output text)

  aws sqs create-queue --queue-name "${QUEUE_NAME}" --region "${AWS_REGION}" \
    --attributes '{
      "VisibilityTimeout": "60",
      "RedrivePolicy": "{\"deadLetterTargetArn\":\"'"${DLQ_ARN}"'\",\"maxReceiveCount\":\"3\"}"
    }'
}

create_topic() {
  local TOPIC_NAME=$1
  aws sns create-topic --name "${TOPIC_NAME}" --region "${AWS_REGION}"
}

create_queue "fcp_sfd_crm_requests"
create_topic "fcp_sfd_crm_events"
create_topic "fcp_audit_fcp_sfd_crm"

echo "SQS and SNS configuration complete."
