import hapiPulse from 'hapi-pulse'
import { createLogger } from '../../../logging/logger.js'
import { closeDb } from '../../../data/db.js'
import { stopMessaging } from '../../../messaging/inbound/index.js'

const tenSeconds = 10 * 1000

const pulse = {
  plugin: hapiPulse,
  options: {
    logger: createLogger(),
    timeout: tenSeconds,
    // Both hooks run only on a shutdown signal; server.stop() in tests does not
    // trigger them. hapi-pulse awaits preServerStop before postServerStop, and
    // stopMessaging resolves only once in-flight messages have finished or the
    // drain window has passed, so closeDb does not run under a live handler.
    preServerStop: stopMessaging,
    postServerStop: closeDb
  }
}

export { pulse }
