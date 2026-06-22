import { SendMessageCommand } from '@aws-sdk/client-sqs'

const sendToDlq = async (sqsClient, queueUrl, envelope) => {
  const command = new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(envelope),
    MessageAttributes: {
      eventType: {
        DataType: 'String',
        StringValue: envelope.originalPayload?.type ?? 'unknown'
      },
      source: {
        DataType: 'String',
        StringValue: envelope.metadata?.source ?? 'fcp-sfd-crm'
      },
      failureReason: {
        DataType: 'String',
        StringValue: (envelope.metadata?.errorMessage ?? 'unknown').substring(0, 256)
      }
    }
  })

  await sqsClient.send(command)
}

export { sendToDlq }
