/**
 * Offline checks for the dsh-chat-projects moving engine.
 *
 * These tests run outside DSH: they build throwaway sessions roots and drive
 * `createMover` with fake persistence/registry services that mimic the real
 * contracts closely enough to exercise path derivation, header rewriting,
 * accounting, rollback, the bulk organizer and queued moves. The session logs
 * are synthetic (checksummed zstd frames generated here), so no local DSH data
 * is needed and the suite runs the same on any machine or CI.
 *
 * Run with: node --test test/core.test.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import zlib from 'node:zlib'

import {
  MoveError,
  createMover,
  decodeHeaderFrame,
  encodeSegment,
  findFrameEnd,
  projectKey,
  rewriteHeaderCwd,
  selectGeneration,
} from '../lib/mover.js'

const SESSION_ID = 'session-00000000-0000-4000-8000-000000000001'
const CHECKSUM = { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } }

/** mkdtemp under the OS temp dir, canonicalized (Windows runners return 8.3 short paths). */
async function tempDir(prefix) {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)))
}

/** One checksummed zstd frame holding exactly one JSONL record. */
function frame(record) {
  return zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(record)}\n`, 'utf8'), CHECKSUM)
}

/** A self-contained session log: header frame + N committed event frames. */
function makeSessionLog({ id = SESSION_ID, cwd, events = 3 } = {}) {
  const header = {
    type: 'session',
    version: 4,
    id,
    createdAt: 1792000000000,
    ...(cwd === undefined ? {} : { cwd }),
    isSeeded: false,
    delegationDepth: 0,
    agentPreset: 'standard',
  }
  const frames = [frame(header)]
  for (let index = 0; index < events; index += 1) {
    frames.push(frame({ type: 'session/title', seq: index, time: 1792000000000 + index, data: { title: `event ${index}` } }))
  }
  return Buffer.concat(frames)
}

function fakeRegistry({ workspaces, onAttach }) {
  const entities = workspaces.map((workspace) => ({
    id: workspace.id,
    title: workspace.title,
    path: workspace.path,
    record: {
      path: workspace.path,
      title: workspace.title,
      sessionIds: [...workspace.sessionIds],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    status: async () => 'ok',
    async attachSession(sessionId) {
      if (typeof onAttach === 'function') onAttach(sessionId, workspace.id)
      if (!this.record.sessionIds.includes(sessionId)) this.record.sessionIds.unshift(sessionId)
    },
    async detachSession(sessionId) {
      this.record.sessionIds = this.record.sessionIds.filter((id) => id !== sessionId)
    },
    get sessionIds() {
      return this.record.sessionIds
    },
  }))
  const byId = new Map(entities.map((entity) => [entity.id, entity]))
  return {
    entities,
    archivedSessionIds: [],
    list: () => entities,
    get: (id) => byId.get(id),
  }
}

/** Mimics the JSONL backend: the log is found by scanning project dirs for the id. */
function fakePersistence({ root, header, fileName = 'session.v4.jsonl.zstd' }) {
  const state = { header }
  const findSessionFile = async (id) => {
    const matches = []
    for (const project of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!project.isDirectory()) continue
      const dir = path.join(root, project.name, encodeSegment(id))
      const generation = await selectGeneration(dir, 'zstd')
      if (generation !== undefined) matches.push(generation.path)
    }
    if (matches.length > 1) throw new Error(`duplicate session id "${id}"`)
    return matches[0]
  }
  return {
    root,
    compression: 'zstd',
    async stat(id) {
      if (id !== state.header.id) return undefined
      const file = await findSessionFile(id)
      if (file === undefined) return undefined
      const bytes = await fs.readFile(file)
      const decoded = decodeHeaderFrame(bytes)
      state.header = decoded.header
      return { header: decoded.header, revision: `${file}:${bytes.length}`, sizeBytes: bytes.length }
    },
    async list() {
      const files = []
      for (const project of await fs.readdir(root, { withFileTypes: true })) {
        if (!project.isDirectory()) continue
        for (const session of await fs.readdir(path.join(root, project.name), { withFileTypes: true }).catch(() => [])) {
          if (!session.isDirectory()) continue
          const dir = path.join(root, project.name, session.name)
          const generation = await selectGeneration(dir, 'zstd')
          if (generation === undefined) continue
          const bytes = await fs.readFile(generation.path)
          files.push({ header: decodeHeaderFrame(bytes).header })
        }
      }
      return files
    },
    async open(id) {
      if (id !== state.header.id) throw new Error('missing')
      return {
        async read() {
          return { eventState: 'detached', events: [] }
        },
        async close() {},
      }
    },
  }
}

function fakeCtx({ registry, persistence, activity, liveSessions }) {
  const services = new Map([
    ['workspaceRegistry', registry],
    ['sessionPersistence', persistence],
  ])
  if (liveSessions !== undefined) services.set('sessions', liveSessions)
  return {
    logger: { info() {}, warn() {}, error() {} },
    get: (name) => services.get(name),
    waterfall: async () => (typeof activity === 'function' ? activity() : activity ?? []),
  }
}

/** Stand-in for the host session store: only the listed ids are "loaded". */
const withLiveSession = (ids) => ({ get: (id) => (ids.includes(id) ? { id } : undefined) })

async function makeFixture(root, { cwd, id = SESSION_ID, logBytes, fileName = 'session.v4.jsonl.zstd' }) {
  const dir = path.join(root, projectKey(cwd), encodeSegment(id))
  await fs.mkdir(dir, { recursive: true })
  const logPath = path.join(dir, fileName)
  await fs.writeFile(logPath, logBytes)
  return { dir, logPath }
}

test('path derivation matches the persistence backend', () => {
  assert.equal(projectKey('C:\\Users\\tzh\\Desktop\\AI\\skill'), '--C-Users-tzh-Desktop-AI-skill--')
  assert.equal(projectKey('D:\\51_project\\class1'), '--D-51_project-class1--')
  assert.equal(projectKey('/home/user/project'), '--home-user-project--')
  assert.equal(encodeSegment('session-1146b4a7-0c2b-4173-931b-20e6bedb6ec6'), 'session-1146b4a7-0c2b-4173-931b-20e6bedb6ec6')
  assert.equal(encodeSegment('a/b:c'), 'a~002Fb~003Ac')
  assert.equal(encodeSegment('.'), '~002E')
})

test('zstd header frame can be rewritten without touching event frames', () => {
  const bytes = makeSessionLog({ cwd: 'C:\\projects\\old' })
  const { frameEnd } = decodeHeaderFrame(bytes)
  const target = path.join(os.tmpdir(), 'dsh-chat-projects-target')
  const rewritten = rewriteHeaderCwd(bytes, target)
  assert.equal(rewritten.header.cwd, target)
  assert.equal(rewritten.header.id, SESSION_ID)
  const newFrameEnd = findFrameEnd(rewritten.bytes, 0)
  const decoded = zlib.zstdDecompressSync(rewritten.bytes.subarray(0, newFrameEnd))
  const parsed = JSON.parse(decoded.subarray(0, decoded.length - 1).toString('utf8'))
  assert.equal(parsed.cwd, target)
  assert.equal(parsed.type, 'session')
  // every event byte after the header frame is preserved verbatim
  assert.deepEqual(
    Buffer.from(rewritten.bytes.subarray(newFrameEnd)),
    Buffer.from(bytes.subarray(frameEnd))
  )
  // remaining frames still decode
  let offset = newFrameEnd
  while (offset < rewritten.bytes.length) {
    const end = findFrameEnd(rewritten.bytes, offset)
    zlib.zstdDecompressSync(rewritten.bytes.subarray(offset, end))
    offset = end
  }
})

test('moveSession relocates the log and reconciles accounting', async () => {
  const root = await tempDir('dsh-chat-projects-move-')
  const oldCwd = await tempDir('dsh-chat-projects-old-')
  const newCwd = await tempDir('dsh-chat-projects-new-')
  const dataRoot = path.join(root, '..', `dsh-chat-projects-data-${Date.now()}`)
  try {
    const patched = rewriteHeaderCwd(makeSessionLog({ cwd: oldCwd }), oldCwd).bytes
    await makeFixture(root, { cwd: oldCwd, logBytes: patched })
    const header = decodeHeaderFrame(patched).header
    const registry = fakeRegistry({
      workspaces: [
        { id: 'ws-old', title: 'old', path: oldCwd, sessionIds: [SESSION_ID] },
        { id: 'ws-new', title: 'new', path: newCwd, sessionIds: [] },
      ],
    })
    const persistence = fakePersistence({ root, header: { ...header, cwd: oldCwd } })
    const ctx = fakeCtx({ registry, persistence, activity: () => [] })
    const mover = createMover(ctx, { sessionsRoot: root, dataRoot })
    const result = await mover.moveSession({ sessionId: SESSION_ID, targetWorkspaceId: 'ws-new' })
    assert.equal(result.ok, true)
    assert.equal(result.movedFiles, true)
    assert.equal(result.toWorkspaceId, 'ws-new')

    const newDir = path.join(root, projectKey(newCwd), encodeSegment(SESSION_ID))
    const moved = await fs.readFile(path.join(newDir, 'session.v4.jsonl.zstd'))
    assert.equal(decodeHeaderFrame(moved).header.cwd, newCwd)
    await assert.rejects(fs.access(path.join(root, projectKey(oldCwd), encodeSegment(SESSION_ID))))
    assert.deepEqual(registry.get('ws-old').record.sessionIds, [])
    assert.deepEqual(registry.get('ws-new').record.sessionIds, [SESSION_ID])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(oldCwd, { recursive: true, force: true })
    await fs.rm(newCwd, { recursive: true, force: true })
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})

test('a busy session is refused before anything moves', async () => {
  const root = await tempDir('dsh-chat-projects-busy-')
  const oldCwd = await tempDir('dsh-chat-projects-old-')
  const newCwd = await tempDir('dsh-chat-projects-new-')
  const dataRoot = path.join(root, '..', `dsh-chat-projects-data-${Date.now()}`)
  try {
    const patched = rewriteHeaderCwd(makeSessionLog({ cwd: oldCwd }), oldCwd).bytes
    const { logPath } = await makeFixture(root, { cwd: oldCwd, logBytes: patched })
    const header = decodeHeaderFrame(patched).header
    const registry = fakeRegistry({
      workspaces: [
        { id: 'ws-old', title: 'old', path: oldCwd, sessionIds: [SESSION_ID] },
        { id: 'ws-new', title: 'new', path: newCwd, sessionIds: [] },
      ],
    })
    const persistence = fakePersistence({ root, header: { ...header, cwd: oldCwd } })
    const ctx = fakeCtx({ registry, persistence, activity: () => [{ kind: 'turn' }] })
    const mover = createMover(ctx, { sessionsRoot: root, dataRoot })
    await assert.rejects(
      () => mover.moveSession({ sessionId: SESSION_ID, targetWorkspaceId: 'ws-new' }),
      (error) => error instanceof MoveError && error.code === 'SESSION_BUSY'
    )
    assert.deepEqual(registry.get('ws-old').record.sessionIds, [SESSION_ID])
    assert.deepEqual(registry.get('ws-new').record.sessionIds, [])
    assert.equal((await fs.readFile(logPath)).equals(patched), true)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(oldCwd, { recursive: true, force: true })
    await fs.rm(newCwd, { recursive: true, force: true })
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})

test('attach failure rolls the log directory and accounting back', async () => {
  const root = await tempDir('dsh-chat-projects-rollback-')
  const oldCwd = await tempDir('dsh-chat-projects-old-')
  const newCwd = await tempDir('dsh-chat-projects-new-')
  const dataRoot = path.join(root, '..', `dsh-chat-projects-data-${Date.now()}`)
  try {
    const patched = rewriteHeaderCwd(makeSessionLog({ cwd: oldCwd }), oldCwd).bytes
    await makeFixture(root, { cwd: oldCwd, logBytes: patched })
    const header = decodeHeaderFrame(patched).header
    const registry = fakeRegistry({
      workspaces: [
        { id: 'ws-old', title: 'old', path: oldCwd, sessionIds: [SESSION_ID] },
        { id: 'ws-new', title: 'new', path: newCwd, sessionIds: [] },
      ],
      onAttach: (sessionId, workspaceId) => {
        if (workspaceId === 'ws-new') throw new Error('simulated attach failure')
      },
    })
    const persistence = fakePersistence({ root, header: { ...header, cwd: oldCwd } })
    const ctx = fakeCtx({ registry, persistence, activity: () => [] })
    const mover = createMover(ctx, { sessionsRoot: root, dataRoot })
    await assert.rejects(
      () => mover.moveSession({ sessionId: SESSION_ID, targetWorkspaceId: 'ws-new' }),
      (error) => error instanceof MoveError && (error.code === 'ATTACH_FAILED' || error.code === 'INTERNAL')
    )
    // original directory is back, header still names the old project, accounting intact
    const restored = await fs.readFile(path.join(root, projectKey(oldCwd), encodeSegment(SESSION_ID), 'session.v4.jsonl.zstd'))
    assert.equal(decodeHeaderFrame(restored).header.cwd, oldCwd)
    assert.deepEqual(registry.get('ws-old').record.sessionIds, [SESSION_ID])
    assert.deepEqual(registry.get('ws-new').record.sessionIds, [])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(oldCwd, { recursive: true, force: true })
    await fs.rm(newCwd, { recursive: true, force: true })
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})

test('organize files ungrouped sessions whose directory is a project', async () => {
  const root = await tempDir('dsh-chat-projects-organize-')
  const projectDir = await tempDir('dsh-chat-projects-project-')
  const dataRoot = path.join(root, '..', `dsh-chat-projects-data-${Date.now()}`)
  try {
    const patched = rewriteHeaderCwd(makeSessionLog({ cwd: projectDir }), projectDir).bytes
    await makeFixture(root, { cwd: projectDir, logBytes: patched })
    const header = decodeHeaderFrame(patched).header
    const registry = fakeRegistry({ workspaces: [{ id: 'ws', title: 'p', path: projectDir, sessionIds: [] }] })
    const persistence = fakePersistence({ root, header: { ...header, cwd: projectDir } })
    const ctx = fakeCtx({ registry, persistence, activity: () => [] })
    const mover = createMover(ctx, { sessionsRoot: root, dataRoot })
    const result = await mover.organize()
    assert.equal(result.attached.length, 1)
    assert.equal(result.attached[0].workspaceId, 'ws')
    assert.deepEqual(registry.get('ws').record.sessionIds, [SESSION_ID])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(projectDir, { recursive: true, force: true })
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})

test('a loaded session can be queued and the move runs on the next startup', async () => {
  const root = await tempDir('dsh-chat-projects-queue-')
  const oldCwd = await tempDir('dsh-chat-projects-old-')
  const newCwd = await tempDir('dsh-chat-projects-new-')
  const dataRoot = path.join(root, '..', `dsh-chat-projects-data-${Date.now()}`)
  const makeWorkspaces = () => [
    { id: 'ws-old', title: 'old', path: oldCwd, sessionIds: [SESSION_ID] },
    { id: 'ws-new', title: 'new', path: newCwd, sessionIds: [] },
  ]
  try {
    const patched = rewriteHeaderCwd(makeSessionLog({ cwd: oldCwd }), oldCwd).bytes
    await makeFixture(root, { cwd: oldCwd, logBytes: patched })
    const header = decodeHeaderFrame(patched).header
    const persistence = fakePersistence({ root, header: { ...header, cwd: oldCwd } })

    // Running app: the session is loaded by DSH, so the immediate move refuses.
    const liveCtx = fakeCtx({
      registry: fakeRegistry({ workspaces: makeWorkspaces() }),
      persistence,
      activity: () => [],
      liveSessions: withLiveSession([SESSION_ID]),
    })
    const liveMover = createMover(liveCtx, { sessionsRoot: root, dataRoot })
    await assert.rejects(
      () => liveMover.moveSession({ sessionId: SESSION_ID, targetWorkspaceId: 'ws-new' }),
      (error) => error instanceof MoveError && error.code === 'SESSION_LIVE'
    )
    const queued = await liveMover.enqueueMove({ sessionId: SESSION_ID, targetWorkspaceId: 'ws-new' })
    assert.equal(queued.queued, true)
    assert.equal((await liveMover.readQueue()).length, 1)

    // Next startup: nothing is loaded yet, so the queued move applies.
    const startupCtx = fakeCtx({
      registry: fakeRegistry({ workspaces: makeWorkspaces() }),
      persistence,
      activity: () => [],
    })
    const startupMover = createMover(startupCtx, { sessionsRoot: root, dataRoot })
    const outcome = await startupMover.processQueuedMoves()
    assert.equal(outcome.done, 1)
    assert.equal(outcome.pending, 0)

    const moved = await fs.readFile(path.join(root, projectKey(newCwd), encodeSegment(SESSION_ID), 'session.v4.jsonl.zstd'))
    assert.equal(decodeHeaderFrame(moved).header.cwd, newCwd)
    assert.deepEqual(startupCtx.get('workspaceRegistry').get('ws-old').record.sessionIds, [])
    assert.deepEqual(startupCtx.get('workspaceRegistry').get('ws-new').record.sessionIds, [SESSION_ID])
    assert.deepEqual(await startupMover.readQueue(), [])
    await assert.rejects(fs.access(path.join(dataRoot, 'journal.json')))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(oldCwd, { recursive: true, force: true })
    await fs.rm(newCwd, { recursive: true, force: true })
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})

test('the legacy dsh-projects runtime directory is migrated once', async () => {
  const parent = await tempDir('dsh-chat-projects-legacy-')
  const sessionsRoot = path.join(parent, 'sessions')
  await fs.mkdir(sessionsRoot)
  const legacyRoot = path.join(parent, 'dsh-projects')
  await fs.mkdir(legacyRoot)
  await fs.writeFile(path.join(legacyRoot, 'journal.json'), '{}')
  try {
    const persistence = fakePersistence({
      root: sessionsRoot,
      header: { type: 'session', version: 4, id: SESSION_ID, cwd: sessionsRoot },
    })
    const ctx = fakeCtx({ registry: fakeRegistry({ workspaces: [] }), persistence, activity: () => [] })
    const mover = createMover(ctx, { sessionsRoot })

    assert.equal(await mover.migrateLegacyDataRoot(), true)
    assert.equal(await fs.stat(path.join(parent, 'dsh-chat-projects')).then(() => true, () => false), true)
    assert.equal(await fs.stat(legacyRoot).then(() => true, () => false), false)
    // idempotent: the new directory now exists, so nothing moves again
    assert.equal(await mover.migrateLegacyDataRoot(), false)
  } finally {
    await fs.rm(parent, { recursive: true, force: true })
  }
})