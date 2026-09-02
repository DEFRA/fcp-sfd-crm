import { WebIdentityTokenProvider } from '@defra/hapi-auth-oidc'

const JWT_SEGMENT_COUNT = 3
const JWT_PAYLOAD_INDEX = 1
const EVENT_ACTION = 'web-identity-assertion'

/**
 * Decodes the payload of a JWT without verifying its signature.
 *
 * @param {string} token - The encoded JWT.
 * @returns {object|null} The decoded claims, or null if the token is malformed.
 */
const decodeClaims = (token) => {
  const segments = token.split('.')

  if (segments.length !== JWT_SEGMENT_COUNT) {
    return null
  }

  return JSON.parse(
    Buffer.from(segments[JWT_PAYLOAD_INDEX], 'base64url').toString()
  )
}

/**
 * A WebIdentityTokenProvider that additionally reports the issuer, subject and
 * audience of each newly issued assertion.
 *
 * These three claims are the values Entra ID matches against the registered
 * federated identity credential, so reporting them makes an AADSTS700213 "no
 * matching federated identity record" failure diagnosable. None of the three is
 * a secret or personal data, and the assertion itself is never logged.
 *
 * CDP filters logs down to roughly fifty permitted ECS fields before they reach
 * OpenSearch, so the claims are carried in `message` rather than as custom
 * top-level keys, which would be dropped. `event.action` and `event.outcome`
 * are permitted, and make these entries filterable.
 *
 * @see https://github.com/DEFRA/cdp-documentation/blob/main/how-to/logging.md
 */
export class LoggingWebIdentityTokenProvider extends WebIdentityTokenProvider {
  #lastLoggedToken = null

  async getCredentials (logger) {
    const token = await super.getCredentials(logger)

    if (!token) {
      logger?.error?.(
        { event: { action: EVENT_ACTION, outcome: 'failure' } },
        '[Web Identity] no assertion was issued, so no claims to report'
      )
      return token
    }

    if (token !== this.#lastLoggedToken) {
      this.#lastLoggedToken = token
      this.#logClaims(token, logger)
    }

    return token
  }

  #logClaims (token, logger) {
    try {
      const { iss, sub, aud } = decodeClaims(token) ?? {}

      logger?.info?.(
        { event: { action: EVENT_ACTION, outcome: 'success' } },
        `[Web Identity] assertion claims, to match against the Entra federated credential. iss=${iss} sub=${sub} aud=${JSON.stringify(aud)}`
      )
    } catch (err) {
      logger?.error?.(
        { err, event: { action: EVENT_ACTION, outcome: 'failure' } },
        '[Web Identity] could not decode the assertion claims'
      )
    }
  }
}
