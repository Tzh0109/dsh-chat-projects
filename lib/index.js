/**
 * dsh-projects — Host half.
 *
 * Serves a tiny same-origin JSON API for the browser half:
 *   GET  /plugins/dsh-projects/api/state?session=<id>
 *   POST /plugins/dsh-projects/api/move      { sessionId, targetWorkspaceId }
 *   POST /plugins/dsh-projects/api/organize  {}
 *
 * The moving engine lives in ./mover.js; this file only wires HTTP, auth fence
 * and lifecycle.
 */
import { createMover, MoveError } from './mover.js'

export const name = 'dsh-projects'
export const inject = ['webServer', 'connection']

const API_PREFIX = '/plugins/dsh-projects/api'
const MAX_BODY_BYTES = 1024 * 1024

const STATUS_FOR_CODE = {
  BAD_REQUEST: 400,
  PROJECTS_UNAVAILABLE: 503,
  SESSION_NOT_FOUND: 404,
  SUBAGENT_SESSION: 409,
  SESSION_LIVE: 409,
  SESSION_BUSY: 409,
  SESSION_ACTIVITY_UNKNOWN: 409,
  NO_CWD: 409,
  TARGET_UNKNOWN: 404,
  TARGET_MISSING: 409,
  TARGET_EXISTS: 409,
  LOG_NOT_FOUND: 404,
  LOG_AMBIGUOUS: 409,
  LOG_CORRUPT: 500,
  SESSION_FORMAT_LEGACY: 409,
  ZSTD_UNAVAILABLE: 501,
  VERIFY_FAILED: 500,
  ATTACH_FAILED: 500,
  INTERNAL: 500,
}

const sendJson = (res, statusCode, payload) => {
  if (res.writableEnded === true) return
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

const sendError = (res, error, logger) => {
  if (error instanceof MoveError) {
    return sendJson(res, STATUS_FOR_CODE[error.code] ?? 500, {
      ok: false,
      error: { code: error.code, message: error.message, details: error.details ?? null },
    })
  }
  logger?.warn?.(`dsh-projects: unexpected API failure: ${error?.stack ?? String(error)}`)
  return sendJson(res, 500, { ok: false, error: { code: 'INTERNAL', message: String(error?.message ?? error) } })
}

/** Read one bounded JSON request body. */
const readJsonBody = async (req) => {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) throw new MoveError('BAD_REQUEST', 'request body is too large')
    chunks.push(chunk)
  }
  if (total === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new MoveError('BAD_REQUEST', 'request body must be a JSON object')
    }
    return parsed
  } catch (error) {
    if (error instanceof MoveError) throw error
    throw new MoveError('BAD_REQUEST', 'request body is not valid JSON')
  }
}

/** Wrap one handler with the composition's trust fence and JSON error mapping. */
const withFence = (ctx, handler) => {
  return async (req, res) => {
    const rejection = ctx.connection.requestRejection(req)
    if (typeof rejection === 'number') {
      res.statusCode = rejection
      res.end()
      return
    }
    try {
      await handler(req, res)
    } catch (error) {
      sendError(res, error, ctx.logger)
    }
  }
}

const requestedSession = (req) => {
  try {
    const url = new URL(String(req.url ?? '/'), 'http://localhost')
    const value = url.searchParams.get('session')
    return value === null || value.length === 0 ? undefined : value
  } catch {
    return undefined
  }
}

/**
 * Load the plugin.
 * @param {object} ctx - Cordis host context.
 * @param {{ sessionsRoot?: string, dataRoot?: string }} [config] - optional overrides.
 */
export const apply = (ctx, config) => {
  const mover = createMover(ctx, config ?? {})
  const routes = []

  const register = (method, pathName, handler) => {
    const wrapped = withFence(ctx, handler)
    const routeHandler = (req, res) => {
      const actual = String(req.method ?? 'GET').toUpperCase()
      const allowed = method === 'GET' ? new Set(['GET', 'HEAD']) : new Set([method])
      if (!allowed.has(actual)) {
        res.statusCode = 405
        res.setHeader('allow', [...allowed].join(', '))
        res.end()
        return
      }
      void wrapped(req, res)
    }
    routes.push(ctx.webServer.register({ kind: 'exact', path: pathName, handler: routeHandler }))
  }

  register('GET', `${API_PREFIX}/state`, async (req, res) => {
    const sessionId = requestedSession(req)
    const value = await mover.listState(sessionId === undefined ? {} : { sessionId })
    const body = JSON.stringify({ ok: true, ...value })
    res.statusCode = 200
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    if (String(req.method ?? 'GET').toUpperCase() === 'HEAD') res.end()
    else res.end(body)
  })

  register('POST', `${API_PREFIX}/move`, async (req, res) => {
    const body = await readJsonBody(req)
    const sessionId = body.sessionId
    const targetWorkspaceId = body.targetWorkspaceId === undefined ? null : body.targetWorkspaceId
    const result = await mover.moveSession({ sessionId, targetWorkspaceId })
    sendJson(res, 200, { ok: true, result })
  })

  // A session DSH has loaded keeps its log frozen until the process exits, so
  // the browser half queues the move instead of failing the user.
  register('POST', `${API_PREFIX}/queue`, async (req, res) => {
    const body = await readJsonBody(req)
    const sessionId = body.sessionId
    const targetWorkspaceId = body.targetWorkspaceId === undefined ? null : body.targetWorkspaceId
    const result = await mover.enqueueMove({ sessionId, targetWorkspaceId })
    sendJson(res, 200, { ok: true, result })
  })

  register('POST', `${API_PREFIX}/unqueue`, async (req, res) => {
    const body = await readJsonBody(req)
    const result = await mover.unqueueMove(body.sessionId)
    sendJson(res, 200, { ok: true, result })
  })

  register('POST', `${API_PREFIX}/organize`, async (req, res) => {
    await readJsonBody(req)
    const result = await mover.organize()
    sendJson(res, 200, { ok: true, result })
  })

  ctx.effect(() => () => {
    for (const dispose of routes) {
      try {
        dispose()
      } catch {
        /* route table teardown is best-effort */
      }
    }
    return undefined
  }, 'dsh-projects: http routes')

  // A crash between "log directory moved" and "accounting reconciled" leaves a
  // journal behind; finish or undo it once the workspace registry and session
  // persistence are actually mounted (they may initialize after this entry).
  // Queued moves run here too: at startup no agent can hold a session yet.
  ctx.inject(['workspaceRegistry', 'sessionPersistence'], () => {
    let retryTimer
    void Promise.resolve()
      .then(() => mover.recoverInterruptedMove())
      .then(() => mover.processQueuedMoves())
      .then((outcome) => {
        if (outcome.pending > 0) {
          retryTimer = setTimeout(() => {
            retryTimer = undefined
            void mover.processQueuedMoves().catch((error) => {
              ctx.logger?.warn?.(`dsh-projects: queued-move retry failed: ${String(error)}`)
            })
          }, 15000)
          retryTimer.unref?.()
        }
      })
      .catch((error) => ctx.logger?.warn?.(`dsh-projects: startup recovery failed: ${String(error)}`))
      .finally(() => void mover.markRuntimeLoaded())
    ctx.effect(() => () => {
      if (retryTimer !== undefined) clearTimeout(retryTimer)
    }, 'dsh-projects: queued-move retry timer')
  })

  ctx.logger?.info?.(`dsh-projects: ready (sessions root: ${mover.resolveSessionsRoot()})`)
}

export default { name, inject, apply }