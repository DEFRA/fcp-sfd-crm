export const awsConfig = {
  aws: {
    snsEndpoint: {
      doc: 'AWS SNS (Simple Notification Service) Endpoint',
      format: String,
      default: 'https://sns.eu-west-2.amazonaws.com',
      env: 'SNS_ENDPOINT'
    },
    region: {
      doc: 'AWS Region',
      format: String,
      default: 'eu-west-2',
      env: 'AWS_REGION'
    },
    accessKeyId: {
      doc: 'AWS Access Key ID',
      format: String,
      default: null,
      nullable: true,
      env: 'AWS_ACCESS_KEY_ID'
    },
    secretAccessKey: {
      doc: 'AWS Secret Access Key',
      format: String,
      default: null,
      nullable: true,
      env: 'AWS_SECRET_ACCESS_KEY'
    }
  }
}
