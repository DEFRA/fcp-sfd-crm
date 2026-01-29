import { ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs'
import { sqsClient } from '../sqs/client.js'
import { createLogger } from '../../logging/logger.js'
import { createCase } from '../../services/caseService.js'

const logger = createLogger()

/**
 * Polls inbound SQS messages and processes them.
 * @param {Function} delayFn - Function to delay between polls (for testability)
 */
export async function pollInboundMessages (delayFn = () => new Promise(resolve => setTimeout(resolve, 1000))) {
  const queueUrl = process.env.CRM_QUEUE_URL

  const receiveParams = {
    QueueUrl: queueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 1
  }

  const { Messages } = await sqsClient.send(new ReceiveMessageCommand(receiveParams))
  if (!Messages) return

  for (const msg of Messages) {
    let payload
    try {
      payload = JSON.parse(msg.Body)
    } catch (err) {
      logger.error('Invalid JSON in inbound message', err)
      await sqsClient.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: msg.ReceiptHandle }))
      continue
    }
    try {
      await createCase(payload)
    } catch (err) {
      logger.error('Failed to create case via CRM API', err)
    }
    await sqsClient.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: msg.ReceiptHandle }))
  }
  await delayFn()
}
