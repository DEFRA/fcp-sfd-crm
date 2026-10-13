import { createLogger } from '../../logging/logger.js'
import { config } from '../../config/index.js'
import { publish } from '../sns/publish.js'
import { sqsClient } from '../sqs/client.js'
import { sendToDlq } from '../sqs/send-to-dlq.js'
import {
  messagingActions,
  messagingCategories,
  messagingEventTypes,
  messagingOutcomes
} from '../../constants/messaging-events.js'

const logger = createLogger()

export const publishWithDurability = async (snsClient, topicArn, payload, context) => {
  const dlqUrl = config.get('messaging.crmEvents.publishDlqUrl')

  try {
    await publish(snsClient, topicArn, payload)
  } catch (err) {
    logger.error(
      {
        err,
        event: {
          type: messagingEventTypes.SNS_PUBLISH_FAILED,
          action: messagingActions.PUBLISH,
          category: messagingCategories.MESSAGING,
          outcome: messagingOutcomes.FAILURE,
          reference: context?.caseId
        },
        topicArn
      },
      'SNS publish failed, routing to DLQ'
    )

    const envelope = {
      originalPayload: payload,
      metadata: {
        caseId: context?.caseId,
        correlationId: context?.correlationId,
        topicArn,
        failedAt: new Date().toISOString(),
        errorMessage: err?.message ?? 'unknown',
        errorName: err?.name ?? 'Error',
        source: 'fcp-sfd-crm'
      }
    }

    try {
      await sendToDlq(sqsClient, dlqUrl, envelope)
      logger.info(
        { event: { reference: context?.caseId } },
        'Failed SNS publish routed to DLQ'
      )
    } catch (dlqErr) {
      logger.fatal(
        {
          err: dlqErr,
          originalErr: err,
          event: {
            type: messagingEventTypes.DLQ_SEND_FAILED,
            action: messagingActions.SEND_TO_DLQ,
            category: messagingCategories.MESSAGING,
            outcome: messagingOutcomes.FAILURE,
            reference: context?.caseId
          }
        },
        'CRITICAL: Failed to route SNS publish failure to DLQ — event may be lost'
      )
    }
  }
}
