import hapiPulse from 'hapi-pulse'
import { createLogger } from '../../../logging/logger.js'
import { closeDb } from '../../../data/db.js'

const tenSeconds = 10 * 1000

const pulse = {
  plugin: hapiPulse,
  options: {
    logger: createLogger(),
    timeout: tenSeconds,
    // Runs only on a shutdown signal; server.stop() in tests does not trigger
    // it. hapi-pulse awaits server.stop() before postServerStop, and hapi emits
    // the server 'stop' event, whose listener stops SQS messaging, during
    // server.stop(). The consumer is therefore told to stop before closeDb runs.
    postServerStop: closeDb
  }
}

export { pulse }
