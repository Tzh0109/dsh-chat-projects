/**
 * dsh-chat-projects — moving engine.
 *
 * A Session's project membership is decided by three things at once:
 *   1. the workspace record's ordered `sessionIds` (durable accounting),
 *   2. the immutable `cwd` in the Session header, and
 *   3. the on-disk log directory, which is a pure function of that cwd:
 *      `<sessionsRoot>/--<projectKey(cwd)>--/<encodeSegment(id)>/session.v4.jsonl.zstd`
 *
 * DSH ships no API to change 2 or 3 (the header is frozen at creation and the
 * persistence seam is append-only), so a real move has to rewrite the header
 * frame of the log, relocate the Session directory, and then reconcile the
 * workspace registry through the entity's own attach/detach accounting.
 *
 * Everything here is written defensively: one journal file records the
 * intermediate state, the original header frame is backed up, and a failure
 * after the files moved rolls the log directory back before reporting.
 */
import fs from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

/* ------------------------------------------------------------------------- *
 * Errors
 * ------------------------------------------------------------------------- */

export class MoveError extends Error {
  /**
   * @param {string} code - stable machine-readable error code.
   * @param {string} message - human-readable message (Chinese UI copy is mapped
   *   from `code` on the client, this one is for logs and API consumers).
   * @param {object} [details] - extra JSON details.
   */
  constructor(code, message, details) {
    super(message)
    this.name = 'MoveError'
    this.code = code
    this.details = details
  }
}

/* ------------------------------------------------------------------------- *
 * Path derivation — mirrors @deepseek-ai/dsh-session-persistence-jsonl
 * ------------------------------------------------------------------------- */

/**
 * Encode one session id into a safe single path segment.
 * @param {string} raw - session id.
 * @returns {string} filesystem-safe segment.
 */
export function encodeSegment(raw) {
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index)
    const char = raw[index]
    if (char !== '~' && /^[A-Za-z0-9._-]$/.test(char)) out += char
    else out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out
}

/**
 * Build the human-readable project directory key for a cwd.
 * @param {string} cwd - absolute project path.
 * @returns {string} `--<readable>--` project directory name.
 */
export function projectKey(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let index = 0; index < cwd.length; index += 1) {
    const code = cwd.charCodeAt(index)
    const char = cwd[index]
    if (char === '/' || char === '\\' || char === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (char !== '~' && /^[A-Za-z0-9._-]$/.test(char)) {
      readable += char
      separatorRun = false
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

/* ------------------------------------------------------------------------- *
 * Zstandard frame handling
 * ------------------------------------------------------------------------- */

const ZSTD_MAGIC = 0xfd2fb528
const ZSTD_CHECKSUM_OPTIONS = { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } }

/** Whether the running Node exposes the built-in Zstandard API this plugin needs. */
export function hasZstdSupport() {
  return typeof zlib.zstdCompressSync === 'function' && typeof zlib.zstdDecompressSync === 'function'
}

/**
 * Locate the end offset of the complete Zstandard frame starting at `offset`.
 * Mirrors the persistence backend's scanner so a synthesized header frame and
 * the untouched event frames read back exactly as the backend expects.
 * @param {Buffer} buffer - file bytes.
 * @param {number} [offset] - frame start (default 0).
 * @returns {number} byte offset just past the frame.
 */
export function findFrameEnd(buffer, offset = 0) {
  if (buffer.length - offset < 4) throw new Error('truncated zstd frame: missing magic')
  if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`invalid zstd frame magic at byte ${offset}`)
  let cursor = offset + 4
  if (cursor === buffer.length) throw new Error('truncated zstd frame: missing frame header')
  const descriptor = buffer.readUInt8(cursor)
  cursor += 1
  if ((descriptor & 24) !== 0) throw new Error('reserved zstd frame-header bit set')
  const contentSizeFlag = descriptor >>> 6
  const singleSegment = (descriptor & 32) !== 0
  const checksum = (descriptor & 4) !== 0
  const dictionaryFlag = descriptor & 3
  const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
  const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
  cursor += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
  for (;;) {
    if (buffer.length - cursor < 3) throw new Error('truncated zstd frame: missing block header')
    const blockHeader = buffer.readUIntLE(cursor, 3)
    cursor += 3
    const lastBlock = (blockHeader & 1) !== 0
    const blockType = (blockHeader >>> 1) & 3
    const blockSize = blockHeader >>> 3
    if (blockType === 3) throw new Error('reserved zstd block type')
    cursor += blockType === 1 ? 1 : blockSize
    if (cursor > buffer.length) throw new Error('truncated zstd frame: short block payload')
    if (lastBlock) break
  }
  if (checksum) {
    if (buffer.length - cursor < 4) throw new Error('truncated zstd frame: missing checksum')
    cursor += 4
  }
  return cursor
}

/**
 * Decode the header frame (frame 0) of a zstd session log.
 * @param {Buffer} buffer - whole file bytes.
 * @returns {{ header: object, frameEnd: number, plaintext: string }}
 */
export function decodeHeaderFrame(buffer) {
  const frameEnd = findFrameEnd(buffer, 0)
  const plaintext = zlib.zstdDecompressSync(buffer.subarray(0, frameEnd))
  if (plaintext.length === 0 || plaintext.indexOf(10) !== plaintext.length - 1) {
    throw new Error('first zstd frame is not exactly one header line')
  }
  const header = JSON.parse(plaintext.subarray(0, plaintext.length - 1).toString('utf8'))
  if (header === null || typeof header !== 'object' || header.type !== 'session') {
    throw new Error('first zstd frame does not hold a session header record')
  }
  return { header, frameEnd, plaintext: plaintext.toString('utf8') }
}

/**
 * Re-encode a header record as one checksummed zstd frame.
 * @param {object} header - physical header record (`type: 'session'` included).
 * @returns {Buffer} complete frame.
 */
export function encodeHeaderFrame(header) {
  const line = `${JSON.stringify(header)}\n`
  return zlib.zstdCompressSync(Buffer.from(line, 'utf8'), ZSTD_CHECKSUM_OPTIONS)
}

/**
 * Produce new log bytes with only the header record's `cwd` replaced. Every
 * committed event frame is carried over byte for byte.
 * @param {Buffer} buffer - original log bytes.
 * @param {string} cwd - new absolute project directory.
 * @returns {{ bytes: Buffer, header: object }}
 */
export function rewriteHeaderCwd(buffer, cwd) {
  const { header, frameEnd } = decodeHeaderFrame(buffer)
  const nextHeader = {}
  for (const [key, value] of Object.entries(header)) nextHeader[key] = key === 'cwd' ? cwd : value
  if (!Object.hasOwn(header, 'cwd')) nextHeader.cwd = cwd
  const frame = encodeHeaderFrame(nextHeader)
  return { bytes: Buffer.concat([frame, buffer.subarray(frameEnd)]), header: nextHeader }
}

/* ------------------------------------------------------------------------- *
 * Small filesystem helpers
 * ------------------------------------------------------------------------- */

const exists = async (target) => {
  try {
    await fs.access(target, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

const fsyncFile = async (target) => {
  const handle = await fs.open(target, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

const writeFileDurable = async (target, bytes) => {
  const handle = await fs.open(target, 'w')
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

const GENERATION_RE = /^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/

/**
 * Pick the authoritative generation file of one session directory.
 * @param {string} dir - session directory.
 * @param {'zstd'|'none'} compression - selected physical encoding.
 * @returns {Promise<{ name: string, version: number, path: string }|undefined>}
 */
export async function selectGeneration(dir, compression) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') return undefined
    throw error
  }
  const wantedSuffix = compression === 'none' ? '' : '.zstd'
  const found = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const match = GENERATION_RE.exec(entry.name)
    if (match === undefined) continue
    const suffix = match[2] ?? ''
    if (suffix !== wantedSuffix) continue
    found.push({ name: entry.name, version: match[1] === undefined ? 0 : Number(match[1]) })
  }
  found.sort((left, right) => right.version - left.version)
  if (found.length === 0) return undefined
  return { ...found[0], path: path.join(dir, found[0].name) }
}

/* ------------------------------------------------------------------------- *
 * Mover
 * ------------------------------------------------------------------------- */

/**
 * Create the moving engine bound to one Host context.
 * @param {object} ctx - Cordis host context.
 * @param {{ sessionsRoot?: string, dataRoot?: string }} [config] - optional overrides.
 */
export function createMover(ctx, config = {}) {
  const logger = ctx.logger
  let stateCache
  let stateCacheAt = 0

  const getPersistence = () => ctx.get('sessionPersistence')
  const getRegistry = () => ctx.get('workspaceRegistry')

  const requireServices = () => {
    const persistence = getPersistence()
    const registry = getRegistry()
    if (persistence === undefined || registry === undefined) {
      throw new MoveError('PROJECTS_UNAVAILABLE', 'workspace registry or session persistence is not mounted')
    }
    return { persistence, registry }
  }

  /** Resolve the session log root the persistence backend actually uses. */
  const resolveSessionsRoot = () => {
    if (typeof config.sessionsRoot === 'string' && config.sessionsRoot.length > 0) return path.resolve(config.sessionsRoot)
    const persistence = getPersistence()
    if (persistence !== undefined && typeof persistence.root === 'string' && persistence.root.length > 0) {
      return path.resolve(persistence.root)
    }
    const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
    return path.join(home, 'sessions')
  }

  const resolveCompression = () => {
    const persistence = getPersistence()
    if (persistence !== undefined && persistence.compression === 'none') return 'none'
    return 'zstd'
  }

  const resolveDataRoot = () => {
    if (typeof config.dataRoot === 'string' && config.dataRoot.length > 0) return path.resolve(config.dataRoot)
    return path.join(path.dirname(resolveSessionsRoot()), 'dsh-chat-projects')
  }

  /**
   * Earlier builds shipped as `dsh-projects` and used that name for the runtime
   * data directory. Move it once on startup so queued moves, the journal and
   * header-frame backups survive the rename.
   */
  const migrateLegacyDataRoot = async () => {
    if (typeof config.dataRoot === 'string' && config.dataRoot.length > 0) return false
    const currentRoot = resolveDataRoot()
    const legacyRoot = path.join(path.dirname(resolveSessionsRoot()), 'dsh-projects')
    try {
      if (legacyRoot === currentRoot || !(await exists(legacyRoot)) || (await exists(currentRoot))) return false
      await fs.rename(legacyRoot, currentRoot)
      logger?.info?.(`dsh-chat-projects: migrated runtime data ${legacyRoot} -> ${currentRoot}`)
      return true
    } catch (error) {
      logger?.warn?.(`dsh-chat-projects: could not migrate legacy runtime data: ${String(error)}`)
      return false
    }
  }

  const journalPath = () => path.join(resolveDataRoot(), 'journal.json')

  const writeJournal = async (journal) => {
    const root = resolveDataRoot()
    await fs.mkdir(root, { recursive: true })
    const target = journalPath()
    const temp = `${target}.tmp`
    await writeFileDurable(temp, Buffer.from(JSON.stringify(journal), 'utf8'))
    await fs.rename(temp, target)
  }

  const clearJournal = async () => {
    try {
      await fs.rm(journalPath(), { force: true })
    } catch (error) {
      logger?.warn?.(`dsh-chat-projects: could not clear journal: ${String(error)}`)
    }
  }

  const readJournal = async () => {
    try {
      const text = await fs.readFile(journalPath(), 'utf8')
      return JSON.parse(text)
    } catch {
      return undefined
    }
  }

  // ── Pending (queued) moves ────────────────────────────────────────────────
  // A session that DSH has loaded into memory keeps its log frozen and its
  // write lease bound to the original path, so its files cannot be moved until
  // the process exits. A queued move is the one-click answer for that: it is
  // written here and executed on the next startup, before any agent resumes.

  const queuePath = () => path.join(resolveDataRoot(), 'pending-moves.json')

  const readQueue = async () => {
    try {
      const parsed = JSON.parse(await fs.readFile(queuePath(), 'utf8'))
      return Array.isArray(parsed?.moves) ? parsed.moves : []
    } catch {
      return []
    }
  }

  const writeQueue = async (moves) => {
    const root = resolveDataRoot()
    await fs.mkdir(root, { recursive: true })
    const target = queuePath()
    const temp = `${target}.tmp`
    await writeFileDurable(temp, Buffer.from(JSON.stringify({ version: 1, moves }, null, 2), 'utf8'))
    await fs.rename(temp, target)
  }

  const enqueueMove = async ({ sessionId, targetWorkspaceId }) => {
    const { persistence, registry } = requireServices()
    if (typeof sessionId !== 'string' || sessionId.length === 0) throw new MoveError('BAD_REQUEST', 'sessionId is required')
    if (targetWorkspaceId !== null && typeof targetWorkspaceId !== 'string') {
      throw new MoveError('BAD_REQUEST', 'targetWorkspaceId must be a string or null')
    }
    const snapshot = await persistence.stat(sessionId)
    if (snapshot === undefined) throw new MoveError('SESSION_NOT_FOUND', `no such session: ${sessionId}`)
    if (snapshot.header.origin === 'subagent') throw new MoveError('SUBAGENT_SESSION', 'subagent sessions cannot be moved between projects')
    let targetTitle = null
    if (targetWorkspaceId !== null) {
      const target = registry.get(targetWorkspaceId)
      if (target === undefined) throw new MoveError('TARGET_UNKNOWN', `no such workspace: ${targetWorkspaceId}`)
      await canonicalize(target.path)
      targetTitle = target.title
    }
    const moves = (await readQueue()).filter((entry) => entry.sessionId !== sessionId)
    moves.push({
      sessionId,
      targetWorkspaceId,
      targetTitle,
      queuedAt: new Date().toISOString(),
    })
    await writeQueue(moves)
    invalidateState()
    logger?.info?.(`dsh-chat-projects: queued move for "${sessionId}" (applies on next startup)`)
    return { queued: true, sessionId, targetWorkspaceId, targetTitle, pendingMoves: moves.length }
  }

  const unqueueMove = async (sessionId) => {
    if (typeof sessionId !== 'string' || sessionId.length === 0) throw new MoveError('BAD_REQUEST', 'sessionId is required')
    const moves = await readQueue()
    const remaining = moves.filter((entry) => entry.sessionId !== sessionId)
    if (remaining.length !== moves.length) await writeQueue(remaining)
    invalidateState()
    return { removed: remaining.length !== moves.length, pendingMoves: remaining.length }
  }

  /**
   * Execute every queued move. Called at startup (no agent can hold a session
   * yet) and once more on a short delay in case the client restored a session
   * before this plugin got its turn.
   */
  const processQueuedMoves = async () => {
    const moves = await readQueue()
    if (moves.length === 0) return { done: 0, pending: 0 }
    let done = 0
    const remaining = []
    for (const entry of moves) {
      try {
        await moveSession(entry)
        done += 1
        logger?.info?.(`dsh-chat-projects: queued move for "${entry.sessionId}" applied`)
      } catch (error) {
        const code = error instanceof MoveError ? error.code : 'INTERNAL'
        logger?.warn?.(`dsh-chat-projects: queued move for "${entry.sessionId}" deferred (${code}): ${String(error?.message ?? error)}`)
        remaining.push({ ...entry, lastError: code })
      }
    }
    if (remaining.length !== moves.length) await writeQueue(remaining)
    invalidateState()
    return { done, pending: remaining.length }
  }

  /** Drop registry caches for one id so the next header read comes from storage. */
  const forgetRegistryCaches = (registry, sessionId) => {
    for (const field of ['headers', 'sessionPaths', 'missingSessionPaths', 'invalidSessionPaths']) {
      const map = registry[field]
      if (map !== undefined && typeof map.delete === 'function') map.delete(sessionId)
    }
  }

  /** Find the workspace whose durable accounting currently lists this session. */
  const findAccounting = (registry, sessionId) => {
    for (const entity of registry.list()) {
      const record = entity.record
      if (record === undefined || !Array.isArray(record.sessionIds)) continue
      if (record.sessionIds.includes(sessionId)) return entity
    }
    return undefined
  }

  /** Resolve a directory's canonical path, or throw a typed error. */
  const canonicalize = async (target) => {
    try {
      const resolved = await fs.realpath(target)
      const info = await fs.stat(resolved)
      if (!info.isDirectory()) throw new MoveError('TARGET_MISSING', `target is not a directory: ${target}`)
      return resolved
    } catch (error) {
      if (error instanceof MoveError) throw error
      throw new MoveError('TARGET_MISSING', `target workspace directory is unavailable: ${target}`, { cause: String(error) })
    }
  }

  const collectActivity = async (sessionId) => {
    try {
      const reported = await ctx.waterfall('workspace/session-activity', { sessionId }, () => Promise.resolve([]))
      return Array.isArray(reported) ? reported : []
    } catch (error) {
      logger?.warn?.(`dsh-chat-projects: workspace/session-activity failed for "${sessionId}": ${String(error)}`)
      throw new MoveError('SESSION_ACTIVITY_UNKNOWN', 'could not determine whether the session is still working')
    }
  }

  const assertMovable = async (sessionId, header) => {
    if (header.origin === 'subagent') throw new MoveError('SUBAGENT_SESSION', 'subagent sessions cannot be moved between projects')
    const sessions = ctx.get('sessions')
    if (sessions !== undefined && sessions.get(sessionId) !== undefined) {
      throw new MoveError('SESSION_LIVE', 'the session is loaded by a running agent; stop it or switch to another session first')
    }
    const activity = await collectActivity(sessionId)
    if (activity.length > 0) throw new MoveError('SESSION_BUSY', 'the session still has running work', { activity })
  }

  /**
   * The named session's current projection for the dialog: header cwd, durable
   * accounting and (when it is ungrouped) the workspace its directory matches.
   */
  const describeSession = async (registry, sessionId) => {
    const { persistence } = requireServices()
    const snapshot = await persistence.stat(sessionId)
    if (snapshot === undefined) throw new MoveError('SESSION_NOT_FOUND', `no such session: ${sessionId}`)
    const header = snapshot.header
    const accounting = findAccounting(registry, sessionId)
    let canonicalCwd
    let matchWorkspaceId
    if (typeof header.cwd === 'string') {
      try {
        canonicalCwd = await fs.realpath(header.cwd)
        for (const entity of registry.list()) if (entity.path === canonicalCwd) matchWorkspaceId = entity.id
      } catch {
        canonicalCwd = undefined
      }
    }
    return {
      id: sessionId,
      cwd: header.cwd ?? null,
      canonicalCwd: canonicalCwd ?? null,
      origin: header.origin ?? null,
      live: ctx.get('sessions')?.get(sessionId) !== undefined,
      currentWorkspaceId: accounting === undefined ? null : accounting.id,
      matchWorkspaceId: matchWorkspaceId ?? null,
    }
  }

  /** The list the dialog renders, plus the ungrouped rollup for the bulk action. */
  const listState = async (options = {}) => {
    const { persistence, registry } = requireServices()
    const now = Date.now()
    const cacheKey = `${options.sessionId ?? ''}`
    if (stateCache !== undefined && stateCache.key === cacheKey && now - stateCacheAt < 2000) return stateCache.value

    const pendingMoves = await readQueue()
    const sessions = await persistence.list()
    const headers = new Map(sessions.map((snapshot) => [snapshot.header.id, snapshot.header]))
    const accounted = new Set()
    for (const entity of registry.list()) {
      const record = entity.record
      if (record !== undefined && Array.isArray(record.sessionIds)) for (const id of record.sessionIds) accounted.add(id)
    }
    const byPath = new Map()
    const workspaces = []
    for (const entity of registry.list()) {
      byPath.set(entity.path, entity)
      workspaces.push({
        id: entity.id,
        title: entity.title,
        path: entity.path,
        status: await entity.status(),
        sessionCount: entity.sessionIds.length,
      })
    }
    const archived = new Set(registry.archivedSessionIds)
    let ungrouped = 0
    let ungroupedMatched = 0
    let archivedUngrouped = 0
    for (const [id, header] of headers) {
      if (accounted.has(id)) continue
      if (header.origin === 'subagent') continue
      if (typeof header.cwd !== 'string') continue
      let canonical
      try {
        canonical = await fs.realpath(header.cwd)
      } catch {
        canonical = undefined
      }
      const matched = canonical !== undefined && byPath.has(canonical)
      ungrouped += 1
      if (archived.has(id)) archivedUngrouped += 1
      if (matched) ungroupedMatched += 1
    }
    const value = {
      version: 1,
      capabilities: { queue: true },
      sessionsRoot: resolveSessionsRoot(),
      compression: resolveCompression(),
      workspaces,
      ungrouped: { total: ungrouped, matched: ungroupedMatched, archived: archivedUngrouped },
      pendingMoves: pendingMoves.length,
    }
    if (typeof options.sessionId === 'string' && options.sessionId.length > 0) {
      value.session = await describeSession(registry, options.sessionId)
      const queued = pendingMoves.find((entry) => entry.sessionId === options.sessionId)
      if (queued !== undefined) {
        value.session.queued = true
        value.session.queuedTargetWorkspaceId = queued.targetWorkspaceId
        value.session.queuedTargetTitle = queued.targetTitle ?? null
        value.session.queuedError = queued.lastError ?? null
      }
    }
    stateCache = { key: cacheKey, value }
    stateCacheAt = now
    return value
  }

  const invalidateState = () => {
    stateCache = undefined
    stateCacheAt = 0
  }

  /** Patch the durable projection-cache record so the list keeps title/statistics. */
  const patchProjectionCache = async (sessionId, oldCwd, newCwd) => {
    const cache = ctx.get('sessionProjectionCache')
    if (cache === undefined || cache.table === undefined || typeof cache.put !== 'function') return false
    const record = cache.table.get(sessionId)
    if (record === undefined || record === null || typeof record !== 'object') return false
    const identity = record.identity
    const rows = {}
    for (const [key, row] of Object.entries(record.rows ?? {})) {
      if (key === 'workingDirectory' && row !== null && typeof row === 'object' && row.val === oldCwd) {
        rows[key] = { ...row, val: newCwd }
      } else {
        rows[key] = row
      }
    }
    await cache.put(sessionId, { ...identity, cwd: newCwd }, rows)
    return true
  }

  const verifyMoved = async (persistence, sessionId, expectedCwd) => {
    const snapshot = await persistence.stat(sessionId)
    if (snapshot === undefined) throw new MoveError('VERIFY_FAILED', 'session disappeared after the move')
    if (snapshot.header.cwd !== expectedCwd) {
      throw new MoveError('VERIFY_FAILED', `stored header still names ${String(snapshot.header.cwd)}`)
    }
    if (typeof persistence.open === 'function') {
      const reader = await persistence.open(sessionId, 'read')
      try {
        if (typeof reader.read === 'function') await reader.read(0, 2)
      } finally {
        if (typeof reader.close === 'function') await reader.close()
      }
    }
  }

  /**
   * Move one session into another workspace, or detach it from every workspace.
   * @param {{ sessionId: string, targetWorkspaceId: string|null }} request
   */
  const moveSession = async ({ sessionId, targetWorkspaceId }) => {
    const { persistence, registry } = requireServices()
    if (typeof sessionId !== 'string' || sessionId.length === 0) throw new MoveError('BAD_REQUEST', 'sessionId is required')
    if (targetWorkspaceId !== null && typeof targetWorkspaceId !== 'string') {
      throw new MoveError('BAD_REQUEST', 'targetWorkspaceId must be a string or null')
    }
    const snapshot = await persistence.stat(sessionId)
    if (snapshot === undefined) throw new MoveError('SESSION_NOT_FOUND', `no such session: ${sessionId}`)
    const header = snapshot.header
    const current = findAccounting(registry, sessionId)

    // "Remove from project": only the durable accounting changes; header and
    // log stay where they are, so the Session shows up under Ungrouped.
    if (targetWorkspaceId === null) {
      if (current === undefined) return { ok: true, unchanged: true, sessionId, movedFiles: false }
      await current.detachSession(sessionId)
      invalidateState()
      return { ok: true, sessionId, fromWorkspaceId: current.id, toWorkspaceId: null, movedFiles: false }
    }

    const target = registry.get(targetWorkspaceId)
    if (target === undefined) throw new MoveError('TARGET_UNKNOWN', `no such workspace: ${targetWorkspaceId}`)
    if (current !== undefined && current.id === target.id) {
      return { ok: true, unchanged: true, sessionId, fromWorkspaceId: current.id, toWorkspaceId: target.id, movedFiles: false }
    }
    await assertMovable(sessionId, header)
    const targetPath = await canonicalize(target.path)

    // The log already lives in the target directory (its cwd resolves to it):
    // only accounting is stale, so attach without touching the files.
    let cwdResolvesToTarget = false
    if (typeof header.cwd === 'string') {
      try {
        cwdResolvesToTarget = (await fs.realpath(header.cwd)) === targetPath
      } catch {
        cwdResolvesToTarget = false
      }
    }
    if (header.cwd === undefined) {
      throw new MoveError('NO_CWD', 'this session has no recorded project directory, so it cannot be relocated')
    }
    if (cwdResolvesToTarget) {
      await accountMove({ registry, sessionId, from: current, target, patch: undefined, oldCwd: undefined, newCwd: undefined })
      invalidateState()
      return { ok: true, sessionId, fromWorkspaceId: current?.id ?? null, toWorkspaceId: target.id, movedFiles: false }
    }

    if (!hasZstdSupport() && resolveCompression() === 'zstd') {
      throw new MoveError('ZSTD_UNAVAILABLE', 'this host runtime has no built-in Zstandard API; cannot rewrite the session header')
    }

    const root = resolveSessionsRoot()
    const compression = resolveCompression()
    const oldProjectDir = path.join(root, projectKey(header.cwd))
    let oldDir = path.join(oldProjectDir, encodeSegment(sessionId))
    if (!(await exists(oldDir))) {
      // Fall back to a bounded scan: the directory key is lossy and a legacy
      // move may have left the log under a different project key.
      const matches = []
      for (const entry of await fs.readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const candidate = path.join(root, entry.name, encodeSegment(sessionId))
        if (await exists(candidate)) matches.push(candidate)
      }
      if (matches.length === 0) throw new MoveError('LOG_NOT_FOUND', 'the stored session log directory was not found')
      if (matches.length > 1) throw new MoveError('LOG_AMBIGUOUS', 'the session id appears under more than one project directory')
      oldDir = matches[0]
    }
    const generation = await selectGeneration(oldDir, compression)
    if (generation === undefined) throw new MoveError('LOG_NOT_FOUND', 'the session log file was not found')
    if (generation.version !== 4) {
      throw new MoveError('SESSION_FORMAT_LEGACY', 'this session still uses an older on-disk format; open it once so DSH migrates it, then retry')
    }

    const original = await fs.readFile(generation.path)
    let rewritten
    if (compression === 'zstd') {
      rewritten = rewriteHeaderCwd(original, targetPath)
    } else {
      const newline = original.indexOf(10)
      if (newline < 0) throw new MoveError('LOG_CORRUPT', 'the session log has no header line')
      const parsed = JSON.parse(original.subarray(0, newline).toString('utf8'))
      const nextHeader = {}
      for (const [key, value] of Object.entries(parsed)) nextHeader[key] = key === 'cwd' ? targetPath : value
      if (!Object.hasOwn(parsed, 'cwd')) nextHeader.cwd = targetPath
      rewritten = {
        bytes: Buffer.concat([Buffer.from(`${JSON.stringify(nextHeader)}\n`, 'utf8'), original.subarray(newline + 1)]),
        header: nextHeader,
      }
    }
    if (rewritten.header.id !== sessionId) throw new MoveError('LOG_CORRUPT', 'header id does not match the session id')

    const newProjectDir = path.join(root, projectKey(targetPath))
    const newDir = path.join(newProjectDir, encodeSegment(sessionId))
    const trashRoot = path.join(path.dirname(root), '.dsh-chat-projects-trash')
    const trashDir = path.join(trashRoot, `${encodeSegment(sessionId)}.${Date.now()}`)
    const backupFile = path.join(resolveDataRoot(), 'backups', `${encodeSegment(sessionId)}.${Date.now()}.header-frame.bin`)

    const journal = {
      version: 1,
      sessionId,
      phase: 'prepared',
      startedAt: new Date().toISOString(),
      oldDir,
      newDir,
      trashDir,
      oldCwd: header.cwd,
      newCwd: targetPath,
      fromWorkspaceId: current?.id ?? null,
      toWorkspaceId: target.id,
      generationName: generation.name,
      backupFile,
    }

    await fs.mkdir(path.dirname(backupFile), { recursive: true })
    await writeFileDurable(backupFile, original.subarray(0, findFrameEnd(original, 0)))
    await writeJournal(journal)
    try {
      await fs.mkdir(newProjectDir, { recursive: true })
      if (await exists(newDir)) throw new MoveError('TARGET_EXISTS', 'a session directory already exists in the target project')
      await fs.mkdir(trashRoot, { recursive: true })
      await fs.rename(oldDir, trashDir)
    } catch (error) {
      await clearJournal()
      invalidateState()
      if (error instanceof MoveError) throw error
      throw new MoveError('INTERNAL', `could not stage the session log directory: ${String(error)}`)
    }
    journal.phase = 'old-moved'
    await writeJournal(journal)

    try {
      await fs.mkdir(newDir, { recursive: true })
      await writeFileDurable(path.join(newDir, generation.name), rewritten.bytes)
      journal.phase = 'new-written'
      await writeJournal(journal)
      for (const entry of await fs.readdir(trashDir, { withFileTypes: true })) {
        if (entry.name === generation.name) continue
        if (!entry.isFile()) continue
        if (/\.(lock|tmp)$/.test(entry.name)) continue
        await fs.copyFile(path.join(trashDir, entry.name), path.join(newDir, entry.name))
      }
      await verifyMoved(persistence, sessionId, targetPath)
      journal.phase = 'verified'
      await writeJournal(journal)
      await accountMove({
        registry,
        sessionId,
        from: current,
        target,
        patch: { oldCwd: header.cwd, newCwd: targetPath },
        oldCwd: header.cwd,
        newCwd: targetPath,
      })
      journal.phase = 'accounted'
      await writeJournal(journal)
      await fs.rm(trashDir, { recursive: true, force: true })
      await clearJournal()
      invalidateState()
      return { ok: true, sessionId, fromWorkspaceId: current?.id ?? null, toWorkspaceId: target.id, movedFiles: true }
    } catch (error) {
      await rollbackMove({ registry, sessionId, journal, fromWorkspaceId: current?.id ?? null })
      invalidateState()
      if (error instanceof MoveError) throw error
      throw new MoveError('INTERNAL', `move failed and was rolled back: ${String(error)}`)
    }
  }

  /** Reconcile durable accounting and the projection cache after files moved. */
  const accountMove = async ({ registry, sessionId, from, target, patch }) => {
    forgetRegistryCaches(registry, sessionId)
    if (from !== undefined) await from.detachSession(sessionId)
    try {
      await target.attachSession(sessionId)
    } catch (error) {
      throw new MoveError('ATTACH_FAILED', `session could not be attached to the target project: ${String(error)}`)
    }
    if (patch !== undefined) {
      try {
        await patchProjectionCache(sessionId, patch.oldCwd, patch.newCwd)
      } catch (error) {
        logger?.warn?.(`dsh-chat-projects: projection cache patch for "${sessionId}" failed (list title may need a refresh): ${String(error)}`)
      }
    }
  }

  /** Best-effort restore of the pre-move disk state. */
  const rollbackMove = async ({ registry, sessionId, journal, fromWorkspaceId }) => {
    try {
      if (journal.newDir !== undefined && (await exists(journal.newDir))) await fs.rm(journal.newDir, { recursive: true, force: true })
      let movedBack = false
      if (journal.trashDir !== undefined && (await exists(journal.trashDir))) {
        await fs.mkdir(path.dirname(journal.oldDir), { recursive: true })
        await fs.rm(journal.oldDir, { recursive: true, force: true })
        await fs.rename(journal.trashDir, journal.oldDir)
        movedBack = true
      }
      const persistence = getPersistence()
      if (movedBack && persistence !== undefined && typeof persistence.stat === 'function') {
        forgetRegistryCaches(registry, sessionId)
        const current = findAccounting(registry, sessionId)
        if (current !== undefined && current.id !== fromWorkspaceId) await current.detachSession(sessionId)
        if (fromWorkspaceId !== null && fromWorkspaceId !== undefined) {
          const workspace = registry.get(fromWorkspaceId)
          if (workspace !== undefined) {
            forgetRegistryCaches(registry, sessionId)
            try {
              await workspace.attachSession(sessionId)
            } catch (error) {
              logger?.warn?.(`dsh-chat-projects: rollback could not restore accounting for "${sessionId}": ${String(error)}`)
            }
          }
        }
      }
      await clearJournal()
    } catch (error) {
      logger?.error?.(`dsh-chat-projects: rollback for "${sessionId}" failed; journal kept at ${journalPath()}: ${String(error)}`)
    }
  }

  /**
   * File every ungrouped session whose recorded directory is a registered
   * workspace back into that workspace. Only accounting changes; no log is
   * rewritten because the recorded cwd already resolves to the target.
   */
  const organize = async () => {
    const { persistence, registry } = requireServices()
    const sessions = await persistence.list()
    const accounted = new Set()
    for (const entity of registry.list()) {
      const record = entity.record
      if (record !== undefined && Array.isArray(record.sessionIds)) for (const id of record.sessionIds) accounted.add(id)
    }
    const byPath = new Map()
    for (const entity of registry.list()) byPath.set(entity.path, entity)
    const archived = new Set(registry.archivedSessionIds)
    const attached = []
    const skipped = []
    for (const snapshot of sessions) {
      const header = snapshot.header
      if (accounted.has(header.id)) continue
      if (header.origin === 'subagent') continue
      if (typeof header.cwd !== 'string') {
        skipped.push({ id: header.id, reason: 'NO_CWD' })
        continue
      }
      let canonical
      try {
        canonical = await fs.realpath(header.cwd)
      } catch {
        skipped.push({ id: header.id, reason: 'CWD_UNRESOLVED' })
        continue
      }
      const workspace = byPath.get(canonical)
      if (workspace === undefined) {
        skipped.push({ id: header.id, reason: 'NO_WORKSPACE', cwd: canonical })
        continue
      }
      if (archived.has(header.id)) {
        skipped.push({ id: header.id, reason: 'ARCHIVED', workspaceId: workspace.id })
        continue
      }
      try {
        forgetRegistryCaches(registry, header.id)
        await workspace.attachSession(header.id)
        attached.push({ id: header.id, workspaceId: workspace.id })
      } catch (error) {
        skipped.push({ id: header.id, reason: 'ATTACH_FAILED', message: String(error) })
      }
    }
    invalidateState()
    return { attached, skipped }
  }

  /**
   * Complete or roll back a move interrupted by a crash, from the journal.
   * Called once at startup; never throws.
   */
  const recoverInterruptedMove = async () => {
    const journal = await readJournal()
    if (journal === undefined) return
    const registry = getRegistry()
    const persistence = getPersistence()
    logger?.warn?.(`dsh-chat-projects: recovering an interrupted move: ${JSON.stringify({ sessionId: journal.sessionId, phase: journal.phase })}`)
    try {
      if (journal.phase === 'accounted') {
        if (journal.trashDir !== undefined) await fs.rm(journal.trashDir, { recursive: true, force: true })
        await clearJournal()
        return
      }
      const newDirExists = journal.newDir !== undefined && (await exists(journal.newDir))
      const trashExists = journal.trashDir !== undefined && (await exists(journal.trashDir))
      if (newDirExists && persistence !== undefined && registry !== undefined) {
        // Roll forward: the new log is in place, so finish the accounting.
        const snapshot = await persistence.stat(journal.sessionId).catch(() => undefined)
        if (snapshot !== undefined && snapshot.header.cwd === journal.newCwd) {
          forgetRegistryCaches(registry, journal.sessionId)
          const current = findAccounting(registry, journal.sessionId)
          const target = registry.get(journal.toWorkspaceId)
          if (target !== undefined && current?.id !== target.id) {
            if (current !== undefined) await current.detachSession(journal.sessionId)
            await target.attachSession(journal.sessionId)
          }
          if (trashExists) await fs.rm(journal.trashDir, { recursive: true, force: true })
          await clearJournal()
          return
        }
      }
      // Roll back: put the original directory back.
      if (trashExists) {
        await fs.mkdir(path.dirname(journal.oldDir), { recursive: true })
        if (newDirExists) await fs.rm(journal.newDir, { recursive: true, force: true })
        await fs.rm(journal.oldDir, { recursive: true, force: true })
        await fs.rename(journal.trashDir, journal.oldDir)
        if (registry !== undefined && journal.fromWorkspaceId !== null) {
          const workspace = registry.get(journal.fromWorkspaceId)
          if (workspace !== undefined) {
            forgetRegistryCaches(registry, journal.sessionId)
            try {
              await workspace.attachSession(journal.sessionId)
            } catch (error) {
              logger?.warn?.(`dsh-chat-projects: recovery could not restore accounting: ${String(error)}`)
            }
          }
        }
      }
      await clearJournal()
    } catch (error) {
      logger?.error?.(`dsh-chat-projects: interrupted-move recovery failed; journal kept at ${journalPath()}: ${String(error)}`)
    }
  }

  /**
   * Write a small marker next to the journal so an operator (or the plugin's own
   * author) can tell from disk whether the Host half actually loaded in this run.
   */
  const markRuntimeLoaded = async (extra = {}) => {
    try {
      const root = resolveDataRoot()
      await fs.mkdir(root, { recursive: true })
      const payload = {
        plugin: 'dsh-chat-projects',
        loadedAt: new Date().toISOString(),
        pid: process.pid,
        sessionsRoot: resolveSessionsRoot(),
        compression: resolveCompression(),
        ...extra,
      }
      await fs.writeFile(path.join(root, 'runtime.json'), JSON.stringify(payload, null, 2), 'utf8')
    } catch (error) {
      logger?.warn?.(`dsh-chat-projects: could not write the runtime marker: ${String(error)}`)
    }
  }

  return {
    resolveSessionsRoot,
    resolveCompression,
    listState,
    describeSession: async (sessionId) => describeSession(requireServices().registry, sessionId),
    moveSession,
    enqueueMove,
    unqueueMove,
    processQueuedMoves,
    readQueue,
    organize,
    recoverInterruptedMove,
    migrateLegacyDataRoot,
    markRuntimeLoaded,
    invalidateState,
  }
}