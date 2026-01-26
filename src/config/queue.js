export const queueConfig = {
    queue: {
        url: {
            doc: 'URL of the SQS queue for CRM case messages',
            format: String,
            default: null,
            env: 'CRM_QUEUE_URL'
        },
        region: {
            doc: 'AWS region for SQS',
            format: String,
            default: 'eu-west-2',
            env: 'AWS_REGION'
        },
        pollIntervalMs: {
            doc: 'Polling interval for queue consumer',
            format: 'nat',
            default: 5000,
            env: 'QUEUE_POLL_INTERVAL_MS'
        }
    }
}
