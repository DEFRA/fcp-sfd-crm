import { PublishCommand } from '@aws-sdk/client-sns'

const publish = async (snsClient, topicArn, message) => {
  const params = {
    TopicArn: topicArn,
    Message: JSON.stringify(message)
  }

  const command = new PublishCommand(params)

  await snsClient.send(command)
}

export { publish }
