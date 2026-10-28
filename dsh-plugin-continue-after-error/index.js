/**
 * Host half of `@local/dsh-plugin-continue-after-error`.
 *
 * Registers one JSON route, `/dsh-continue/rpc`:
 *  - `config` answers the profile-owned settings (continuation text, trigger
 *    reasons, diagnostics switch) so they can be retuned in `cordis.patch.yml`
 *    without rebuilding the Client bundle;
 *  - `report` appends a bounded diagnostics entry to
 *    `<workspace>/.dsh-continue-diagnostics.json`;
 *  - `status` reads that file back without creating it.
 *
 * The route is optional: without a Web carrier the Client half still renders the
 * button and uses its bundled defaults.
 */

import { createRpcHandler, normalizeConfig, ROUTE_PATH, VERSION } from './lib/rpc.js'

export const name = 'continue-after-error'

/**
 * Register the diagnostics/config route.
 * @param {object} ctx - Cordis context of this bundle row.
 * @param {unknown} config - row `config` from `cordis.patch.yml`.
 * @returns {unknown} disposer of the injected scope, when the runtime returns one.
 */
export function apply(ctx, config) {
  const settings = normalizeConfig(config)
  const logger = createLogger(ctx)

  return ctx.inject(['webServer'], (scope) => {
    const handler = createRpcHandler({ ctx: scope, settings, logger })
    scope.effect(
      () => scope.webServer.register({ kind: 'prefix', path: ROUTE_PATH, handler }),
      'continue-after-error: rpc route',
    )
    logger.info(`continue-after-error ${VERSION}: route ${ROUTE_PATH} is active`)
  })
}

/** Minimal logger facade: a missing logger must not throw. */
function createLogger(ctx) {
  const call = (level, message) => {
    try {
      const logger = ctx?.logger
      if (logger !== undefined && logger !== null && typeof logger[level] === 'function') logger[level](message)
    } catch {
      /* logging is best-effort */
    }
  }
  return {
    info: (message) => call('info', message),
    warn: (message) => call('warn', message),
    error: (message) => call('error', message),
  }
}
