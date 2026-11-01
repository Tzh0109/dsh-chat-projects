# dsh-chat-projects

[English](README.md) | [中文](README.zh.md)

[![test](https://github.com/Tzh0109/dsh-projects/actions/workflows/test.yml/badge.svg)](https://github.com/Tzh0109/dsh-projects/actions/workflows/test.yml)

ChatGPT Projects style chat organization for **DeepSeek Harness (DSH)**: move an
existing session between workspaces (projects) from the session row menu, or
file ungrouped sessions back into the project their recorded directory belongs
to — without replacing the native sidebar.

DSH binds a session to its workspace at creation time and ships no "move to
another project" operation. This plugin adds exactly that missing capability:
project creation, rename, reorder and delete stay native.

## Features

- Session row "…" menu → **Move to project…** opens a picker listing every
  project (path + session count); the current project is highlighted and offers
  "Ungrouped (leave the project)".
- **File ungrouped sessions** bulk action: files every ungrouped session whose
  recorded directory is already a registered project.
- Sessions DSH has loaded in the current run keep a frozen header and a write
  lease, so they cannot be relocated in place. Picking a target for such a
  session **queues** the move (`<DSH_HOME>/dsh-chat-projects/pending-moves.json`);
  it runs automatically on the next DSH start, before any agent resumes. The
  dialog can cancel the queued move.
- Refuses unsafe moves: running work, subagent sessions, sessions without a
  recorded directory, legacy on-disk formats, missing target directories.
- Journal + original-header-frame backup + automatic rollback and crash
  recovery.

## Requirements

- DSH desktop (`0.2.1-rc.x`) with its bundled runtime — the Host half needs
  Node's built-in Zstandard API (Node >= 22.15; DSH ships 24.x).
- No npm dependencies: the plugin is plain ESM + React (`react` comes from the
  DSH client baseline).

## Install

Use the CLI that ships with DSH desktop. The npm package is **`dsh-chat-projects`**
(the GitHub repository keeps its original name, `dsh-projects`):

```powershell
# from npm (easiest)
dsh plugin --profile desktop add dsh-chat-projects

# from GitHub (repository name is dsh-projects)
dsh plugin --profile desktop add github:Tzh0109/dsh-projects

# or from a local checkout (development)
dsh plugin --profile desktop add "link:C:\path\to\dsh-chat-projects"
```

If `dsh` is not on `PATH`, use the bundled entry point
`<DSH install>\resources\runtime\cli\bin\dsh.cmd`.

Restart the DSH desktop app once — the Host half needs a restart. After that,
edits to `lib/client.js` hot-reload through the client HMR channel.

Uninstall:

```powershell
dsh plugin --profile desktop remove dsh-chat-projects
```

## Usage

1. Hover a session row in the sidebar → "…" → **Move to project…**
2. Pick a target project. The current project is highlighted; choosing it is
   replaced by "Ungrouped (leave the project)".
3. The sidebar refreshes; the dialog reports success (or queues the move for
   the next start if the session is currently loaded).

The dialog footer also offers **File ungrouped sessions (N)**, which only
touches ungrouped sessions whose recorded directory is already a project
(archived sessions are skipped).

## How it works

In DSH a session belongs to a project because three things agree:

| # | Fact | Location |
|---|---|---|
| 1 | workspace record's ordered `sessionIds` | `~/.dsh/storages/workspace.json` |
| 2 | immutable `cwd` in the session header | frame 0 of the session log |
| 3 | log directory, a pure function of that `cwd` | `~/.dsh/sessions/--<project key>--/<session id>/session.v4.jsonl.zstd` |

They agree only at creation time, and DSH exposes a (restricted) write entry
point only for #1 (`attachSession` / `detachSession` on the workspace entity).
This plugin therefore performs a real move:

1. back up the original header frame and write a journal;
2. rewrite frame 0's `cwd`, keeping every committed event frame byte-for-byte;
3. relocate the session directory under the target project key;
4. detach from the old project and attach to the new one in the same window;
5. verify with DSH's own persistence backend (`stat` + one event page), and
   roll back automatically on failure;
6. patch the projection cache identity and `workingDirectory` so list titles
   and statistics survive the move.

`header.cwd` is also the `workspace-write` sandbox root, so a moved session's
tool boundary follows it to the new project.

### Safety boundaries

The plugin refuses instead of forcing a move when:

- a live agent has the session loaded (frozen header + write lease);
- the session still has running work (`workspace/session-activity` reports
  turns, subagents, jobs or schedules);
- it is a subagent session (`origin: subagent`);
- the header has no `cwd`;
- the target project directory is missing;
- the log still uses an older on-disk format (open it once so DSH migrates);
- the target project already contains a session directory with that id.

### Crash recovery and manual fallback

- runtime journal: `<DSH_HOME>/dsh-chat-projects/journal.json` (removed on success)
- original header frame backups: `<DSH_HOME>/dsh-chat-projects/backups/`
- staged old directory: `<DSH_HOME>/.dsh-chat-projects-trash/` (same-volume rename,
  removed on success)

On startup the plugin reads the journal: `old-moved` is rolled back,
`new-written` / `verified` are completed. If automatic recovery fails the
journal is kept and a warning is logged, and the trash directory can be renamed
back manually.

## Limitations

- **Unofficial storage semantics.** If a DSH update changes the session or
  workspace format, the plugin refuses the move (verification fails before
  anything is damaged). Re-run `npm test` after an upgrade, and try a throwaway
  session first.
- **Loaded sessions move on the next start.** Sessions opened during the
  current DSH run stay resident with a frozen header and a write lease; those
  moves are queued and execute on the next start, before any agent resumes.
  Never-opened sessions move immediately.
- **Refresh after moving an open conversation**: if the moved session was open
  in the main view, refresh the page; session data is untouched.
- **`workspace-write` sandbox**: the new project directory needs DSH's sandbox
  authorization (a DACL on Windows). With `danger-full-access` this is moot.
- **Nothing is ever deleted**: moving only changes ownership, and
  "Ungrouped" keeps the history.

## Development

```powershell
git clone https://github.com/Tzh0109/dsh-projects
cd dsh-projects
npm test        # node --test test/core.test.mjs
```

The suite is self-contained: it generates synthetic checksummed zstd session
logs and drives the mover with fake persistence/registry services (path
derivation, header rewriting, move, busy refusal, rollback, bulk organizer and
queued moves). No local DSH data is read.

Layout:

```
dsh-chat-projects/
├─ package.json          # dsh.bundle.patch + dsh.client declarations
├─ cordis.patch.yml      # Host-half loader entry
├─ lib/
│  ├─ index.js           # Host entry: same-origin JSON API
│  ├─ mover.js           # moving engine: path codec, zstd header rewrite,
│  │                     #   accounting, rollback, crash recovery
│  └─ client.js          # browser half: session row menu + project dialog
└─ test/core.test.mjs    # offline tests
```

Host API (same-origin, behind DSH's connection trust fence):

```
GET  /plugins/dsh-chat-projects/api/state?session=<id>
POST /plugins/dsh-chat-projects/api/move      {"sessionId": "...", "targetWorkspaceId": "..." | null}
POST /plugins/dsh-chat-projects/api/queue     {"sessionId": "...", "targetWorkspaceId": "..." | null}
POST /plugins/dsh-chat-projects/api/unqueue   {"sessionId": "..."}
POST /plugins/dsh-chat-projects/api/organize  {}
```

## License

MIT