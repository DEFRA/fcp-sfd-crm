import AWS from 'aws-sdk'
import { config } from '../../config/index.js'
import { handleMessage } from './messageHandler.js'
import { createLogger } from './logging/logger.js'

const logger = createLogger()

AWS.config.update({ region: config.get('queue.region') })

const sqs = new AWS.SQS({ apiVersion: '2012-11-05' })

export async function pollInboundMessages() {
    try {
        const data = await sqs.receiveMessage({
            QueueUrl: config.get('queue.url'),
            MaxNumberOfMessages: 5,
            WaitTimeSeconds: 10
        }).promise()

        if (data.Messages) {
            await Promise.all(data.Messages.map(async (msg) => {
                try {
                    await handleMessage(msg)
                } catch (err) {
                    logger.error('Inbound message handling failed', err)
                } finally {
                    await sqs.deleteMessage({
                        QueueUrl: config.get('queue.url'),
                        ReceiptHandle: msg.ReceiptHandle
                    }).promise()
                }
            }))
        }
    } catch (err) {
        logger.error('Inbound polling error', err)
    }

    setTimeout(pollInboundMessages, config.get('queue.pollIntervalMs'))
}
