window.__ModuleLoader__.load({
  id: "dsh-chat-projects",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    const h = react.createElement;

    //#region i18n
    const ZH = {
      "menu.moveToProject": "移动到项目…",
      "menu.title": "移动到项目",
      "menu.subtitle": "把「{title}」放进另一个项目",
      "menu.untitled": "未命名会话",
      "dialog.current": "当前项目",
      "dialog.ungrouped": "未分组（移出项目）",
      "dialog.ungroupedHint": "会话保留在列表的「未分组」里，不再属于任何项目。",
      "dialog.chooseProject": "选择目标项目",
      "dialog.liveHint": "该会话已被 DSH 载入（打开过的会话在本次运行中会常驻内存），无法直接搬动它的日志文件。选择目标项目后会排队，重启 DSH 时自动完成移动。",
      "dialog.otherActions": "其他操作",
      "dialog.queuedHint": "已排队：重启 DSH 后会自动移动到「{name}」。",
      "dialog.queuedUngroupedHint": "已排队：重启 DSH 后会自动移出项目。",
      "dialog.queuedError": "上次启动时没能执行（{code}），排队已保留；可以取消后重新选择。",
      "dialog.cancelQueue": "取消排队",
      "dialog.restartForQueue": "该会话已被 DSH 载入，不能立即移动。当前运行的插件还是旧版本，请重启 DSH 后再试（重启后这类会话会自动排队，并在下次启动时完成移动）。",
      "dialog.loading": "正在读取项目…",
      "dialog.busy": "正在移动会话…",
      "dialog.empty": "还没有项目。先在左侧栏用「＋」添加一个项目文件夹，再回来移动。",
      "dialog.cancel": "取消",
      "dialog.close": "关闭",
      "dialog.organize": "整理未分组会话",
      "dialog.organizeHint": "把目录已在某个项目里的未分组会话归位（共 {matched} 个可归位，{total} 个未分组）。",
      "dialog.organizing": "正在整理…",
      "dialog.organizeResult": "已归位 {attached} 个会话，跳过 {skipped} 个。",
      "notice.moved": "已移动到「{name}」",
      "notice.removed": "已移出项目，会话现在在「未分组」",
      "notice.queued": "已排队：重启 DSH 后自动移动到「{name}」",
      "notice.queuedRemoved": "已排队：重启 DSH 后自动移出项目",
      "notice.unqueued": "已取消排队",
      "notice.refresh": "左侧栏正在刷新",
      "error.DEFAULT": "操作失败：{message}",
      "error.PROJECTS_UNAVAILABLE": "插件依赖的工作区服务没有启动，移动功能不可用。",
      "error.BAD_REQUEST": "请求参数不正确。",
      "error.SESSION_NOT_FOUND": "找不到这个会话。",
      "error.SUBAGENT_SESSION": "子代理会话不能移动项目。",
      "error.SESSION_LIVE": "该会话已被 DSH 载入，不能立即移动；已自动为你排队，重启 DSH 后完成。",
      "error.SESSION_BUSY": "这个会话还有正在运行的工作（回合、子代理或后台任务），请等它结束后再移动。",
      "error.SESSION_ACTIVITY_UNKNOWN": "无法确认会话是否仍在运行，已取消移动以确保安全。",
      "error.NO_CWD": "这个会话没有记录原始目录，无法确定它的目标位置。",
      "error.TARGET_UNKNOWN": "目标项目不存在，可能刚被删除。请重新打开对话框。",
      "error.TARGET_MISSING": "目标项目的文件夹不存在（被移动或删除了），请先在左侧栏修复该项目。",
      "error.TARGET_EXISTS": "目标项目里已经存在同名会话目录，已取消。",
      "error.LOG_NOT_FOUND": "找不到会话的日志文件，已取消。",
      "error.LOG_AMBIGUOUS": "会话日志出现在多个项目目录中，已取消以免损坏数据。",
      "error.LOG_CORRUPT": "会话日志格式异常，已取消。",
      "error.SESSION_FORMAT_LEGACY": "该会话还是旧版磁盘格式；先在界面里打开它一次让 DSH 完成迁移，再移动。",
      "error.ZSTD_UNAVAILABLE": "当前运行时没有内置 Zstandard，无法改写会话头，已取消。",
      "error.VERIFY_FAILED": "移动后校验失败，已自动回滚。",
      "error.ATTACH_FAILED": "无法把会话登记到目标项目，已自动回滚。",
      "error.INTERNAL": "内部错误，已自动回滚：{message}",
    };
    const EN = {
      "menu.moveToProject": "Move to project…",
      "menu.title": "Move to project",
      "menu.subtitle": "Move \"{title}\" into another project",
      "menu.untitled": "Untitled session",
      "dialog.current": "Current project",
      "dialog.ungrouped": "Ungrouped (leave the project)",
      "dialog.ungroupedHint": "The session stays under Ungrouped and no longer belongs to a project.",
      "dialog.chooseProject": "Choose a project",
      "dialog.liveHint": "DSH has this session loaded in memory (opened sessions stay resident for this run), so its log files cannot be moved right now. Pick a target project and the move is queued; it runs automatically on the next DSH start.",
      "dialog.otherActions": "Other actions",
      "dialog.queuedHint": "Queued: this session moves to \"{name}\" automatically on the next DSH start.",
      "dialog.queuedUngroupedHint": "Queued: this session leaves its project automatically on the next DSH start.",
      "dialog.queuedError": "The last startup could not run it ({code}); the queue entry was kept — cancel it and pick a target again if needed.",
      "dialog.cancelQueue": "Cancel queued move",
      "dialog.restartForQueue": "DSH has this session loaded, so it cannot be moved right now. The running plugin is an older build — restart DSH and retry (after the restart such sessions are queued and move on the following start).",
      "dialog.loading": "Loading projects…",
      "dialog.busy": "Moving the session…",
      "dialog.empty": "No projects yet. Add a project folder with the sidebar's + button, then come back.",
      "dialog.cancel": "Cancel",
      "dialog.close": "Close",
      "dialog.organize": "File ungrouped sessions",
      "dialog.organizeHint": "File ungrouped sessions whose directory already belongs to a project ({matched} can be filed, {total} ungrouped).",
      "dialog.organizing": "Filing…",
      "dialog.organizeResult": "Filed {attached} session(s), skipped {skipped}.",
      "notice.moved": "Moved to \"{name}\"",
      "notice.removed": "Removed from its project; the session is now Ungrouped",
      "notice.queued": "Queued: moves to \"{name}\" on the next DSH start",
      "notice.queuedRemoved": "Queued: leaves its project on the next DSH start",
      "notice.unqueued": "Queued move cancelled",
      "notice.refresh": "The sidebar is refreshing",
      "error.DEFAULT": "Failed: {message}",
      "error.PROJECTS_UNAVAILABLE": "The workspace service this plugin needs is not running; moving is unavailable.",
      "error.BAD_REQUEST": "Bad request.",
      "error.SESSION_NOT_FOUND": "Session not found.",
      "error.SUBAGENT_SESSION": "Subagent sessions cannot be moved between projects.",
      "error.SESSION_LIVE": "DSH has this session loaded; the move was queued and will run on the next DSH start.",
      "error.SESSION_BUSY": "The session still has running work (turn, subagent or background job). Try again once it settles.",
      "error.SESSION_ACTIVITY_UNKNOWN": "Could not verify the session is idle, so the move was cancelled.",
      "error.NO_CWD": "This session records no original directory, so it cannot be relocated.",
      "error.TARGET_UNKNOWN": "That project no longer exists. Reopen the dialog.",
      "error.TARGET_MISSING": "The project folder is missing (moved or deleted). Repair the project in the sidebar first.",
      "error.TARGET_EXISTS": "A session directory with this id already exists in the target project.",
      "error.LOG_NOT_FOUND": "The session log file was not found.",
      "error.LOG_AMBIGUOUS": "The session log appears in several project directories; cancelled to protect the data.",
      "error.LOG_CORRUPT": "The session log is malformed; cancelled.",
      "error.SESSION_FORMAT_LEGACY": "This session still uses an older on-disk format. Open it once so DSH migrates it, then retry.",
      "error.ZSTD_UNAVAILABLE": "This runtime has no built-in Zstandard, so the header cannot be rewritten.",
      "error.VERIFY_FAILED": "Post-move verification failed; the move was rolled back.",
      "error.ATTACH_FAILED": "The session could not be registered in the target project; rolled back.",
      "error.INTERNAL": "Internal error; the move was rolled back: {message}",
    };
    const LANG = (() => {
      try {
        const raw = String(
          (typeof navigator !== "undefined" && (navigator.language || "")) ||
            (typeof document !== "undefined" && document.documentElement && document.documentElement.lang) ||
            ""
        ).toLowerCase();
        return raw.startsWith("zh") ? "zh" : "en";
      } catch {
        return "zh";
      }
    })();
    const DICT = LANG === "zh" ? ZH : EN;
    const t = (key, vars) => {
      let text = DICT[key];
      if (typeof text !== "string") text = key;
      if (vars !== undefined && vars !== null) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.split(`{${name}}`).join(String(value));
        }
      }
      return text;
    };
    const errorText = (error) => {
      const code = error && typeof error.code === "string" ? error.code : "DEFAULT";
      const template = DICT[`error.${code}`] ?? DICT["error.DEFAULT"];
      return template.split("{message}").join(String((error && error.message) || code));
    };
    //#endregion

    //#region api
    const API = "/plugins/dsh-chat-projects/api";
    class ApiError extends Error {
      constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
      }
    }
    const errorFromResponse = (payload, status) => {
      const detail = payload && payload.error ? payload.error : undefined;
      return new ApiError(
        (detail && detail.code) || "INTERNAL",
        (detail && detail.message) || `HTTP ${status}`,
        detail ? detail.details : undefined
      );
    };
    const getJson = async (url) => {
      const response = await fetch(url, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok || payload === null || payload.ok !== true) throw errorFromResponse(payload, response.status);
      return payload;
    };
    const postJson = async (url, body) => {
      const response = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok || payload === null || payload.ok !== true) throw errorFromResponse(payload, response.status);
      return payload;
    };
    //#endregion

    //#region store
    const store = {
      open: false,
      sessionId: null,
      title: "",
      loading: false,
      busy: false,
      error: null,
      notice: null,
      workspaces: [],
      session: null,
      capabilities: {},
      ungrouped: { total: 0, matched: 0, archived: 0 },
      organizing: false,
      organizeResult: null,
      pendingTarget: null,
    };
    const listeners = new Set();
    const emit = () => {
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch (error) {
          console.warn("[dsh-chat-projects] listener failed", error);
        }
      }
    };
    const setStore = (patch) => {
      Object.assign(store, patch);
      emit();
    };
    const subscribe = (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    };
    const useStore = () => {
      const [, force] = react.useReducer((value) => value + 1, 0);
      react.useEffect(() => subscribe(force), []);
      return store;
    };

    let closeTimer = null;
    const clearCloseTimer = () => {
      if (closeTimer !== null) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
    };
    const closeDialog = () => {
      clearCloseTimer();
      setStore({
        open: false,
        loading: false,
        busy: false,
        error: null,
        notice: null,
        workspaces: [],
        session: null,
        organizing: false,
        organizeResult: null,
        pendingTarget: null,
      });
    };
    const loadState = async (sessionId) => {
      const payload = await getJson(`${API}/state${sessionId ? `?session=${encodeURIComponent(sessionId)}` : ""}`);
      setStore({
        workspaces: Array.isArray(payload.workspaces) ? payload.workspaces : [],
        session: payload.session ?? null,
        capabilities: payload.capabilities ?? {},
        ungrouped: payload.ungrouped ?? { total: 0, matched: 0, archived: 0 },
      });
    };
    const openDialog = async (sessionId, title) => {
      clearCloseTimer();
      setStore({
        open: true,
        sessionId,
        title: title || "",
        loading: true,
        busy: false,
        error: null,
        notice: null,
        workspaces: [],
        session: null,
        organizeResult: null,
        organizing: false,
        pendingTarget: null,
      });
      try {
        await loadState(sessionId);
      } catch (error) {
        setStore({ error: errorText(error) });
      } finally {
        setStore({ loading: false });
      }
    };
    const chooseTarget = async (targetWorkspaceId, name) => {
      if (store.busy) return;
      const session = store.session;
      const isLive = session !== null && session !== undefined && session.live === true;
      setStore({ busy: true, error: null, notice: null, pendingTarget: targetWorkspaceId });
      // DSH keeps every opened session loaded for the whole run; those can only
      // move on the next startup, so the click queues the move instead.
      const queueSupported = store.capabilities !== undefined && store.capabilities !== null && store.capabilities.queue === true;
      const queueMove = async () => {
        if (!queueSupported) {
          const unsupported = new Error("queue endpoint unavailable");
          unsupported.code = "QUEUE_UNSUPPORTED";
          throw unsupported;
        }
        await postJson(`${API}/queue`, { sessionId: store.sessionId, targetWorkspaceId });
        setStore({
          busy: false,
          pendingTarget: null,
          notice:
            targetWorkspaceId === null
              ? t("notice.queuedRemoved")
              : t("notice.queued", { name: name ?? "" }),
        });
        await loadState(store.sessionId);
      };
      try {
        if (isLive) {
          await queueMove();
          return;
        }
        try {
          await postJson(`${API}/move`, { sessionId: store.sessionId, targetWorkspaceId });
        } catch (error) {
          if (error && error.code === "SESSION_LIVE") {
            await queueMove();
            return;
          }
          throw error;
        }
        setStore({
          busy: false,
          pendingTarget: null,
          notice:
            targetWorkspaceId === null
              ? t("notice.removed")
              : t("notice.moved", { name: name ?? "" }),
        });
        await loadState(store.sessionId);
        clearCloseTimer();
        closeTimer = setTimeout(() => {
          closeTimer = null;
          closeDialog();
        }, 1400);
      } catch (error) {
        setStore({
          busy: false,
          pendingTarget: null,
          error: error && error.code === "QUEUE_UNSUPPORTED" ? t("dialog.restartForQueue") : errorText(error),
        });
      }
    };
    const cancelQueuedMove = async () => {
      if (store.busy) return;
      setStore({ busy: true, error: null, notice: null });
      try {
        await postJson(`${API}/unqueue`, { sessionId: store.sessionId });
        setStore({ busy: false, notice: t("notice.unqueued") });
        await loadState(store.sessionId);
      } catch (error) {
        setStore({ busy: false, error: errorText(error) });
      }
    };
    const organizeUngrouped = async () => {
      if (store.organizing || store.busy) return;
      setStore({ organizing: true, error: null, organizeResult: null });
      try {
        const payload = await postJson(`${API}/organize`, {});
        const result = payload.result ?? { attached: [], skipped: [] };
        setStore({
          organizing: false,
          organizeResult: t("dialog.organizeResult", {
            attached: Array.isArray(result.attached) ? result.attached.length : 0,
            skipped: Array.isArray(result.skipped) ? result.skipped.length : 0,
          }),
        });
        await loadState(store.sessionId);
      } catch (error) {
        setStore({ organizing: false, error: errorText(error) });
      }
    };
    //#endregion

    //#region styles
    const STYLE_ID = "dsh-chat-projects-styles";
    const CSS = `
.dshp-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--dsw-alias-bg-overlay,rgba(0,0,0,.4));pointer-events:auto;animation:dshp-fade .12s ease-out}
@keyframes dshp-fade{from{opacity:0}to{opacity:1}}
.dshp-card{width:min(460px,calc(100vw - 32px));max-height:min(72vh,640px);display:flex;flex-direction:column;border-radius:12px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.32));background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);box-shadow:0 18px 48px rgba(0,0,0,.28);overflow:hidden;font-size:13px;line-height:1.45}
.dshp-head{padding:14px 16px 10px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22))}
.dshp-title{font-size:15px;font-weight:600;margin:0}
.dshp-sub{margin-top:3px;font-size:12px;color:var(--dsw-alias-label-primary-dimmed,inherit);opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshp-body{padding:10px 12px;overflow:auto;flex:1 1 auto;min-height:60px}
.dshp-groupLabel{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-primary-dimmed,inherit);opacity:.7;padding:6px 6px 4px}
.dshp-row{display:flex;flex-direction:column;gap:2px;width:100%;text-align:left;font:inherit;color:inherit;background:transparent;border:1px solid transparent;border-radius:8px;padding:8px 10px;cursor:pointer}
.dshp-row:hover,.dshp-row:focus-visible{background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.14));outline:none}
.dshp-row[data-current="true"]{border-color:var(--dsw-alias-brand-primary,rgba(77,107,254,.55));background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 12%,transparent);cursor:default}
.dshp-row[disabled]{opacity:.65;cursor:default}
.dshp-rowTop{display:flex;align-items:center;gap:8px;justify-content:space-between}
.dshp-rowName{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshp-badge{font-size:11px;color:var(--dsw-alias-label-primary-dimmed,inherit);opacity:.85;white-space:nowrap}
.dshp-rowPath{font-size:11.5px;color:var(--dsw-alias-label-primary-dimmed,inherit);opacity:.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
.dshp-rowHint{font-size:11.5px;color:var(--dsw-alias-label-primary-dimmed,inherit);opacity:.75;line-height:1.4}
.dshp-danger{color:var(--dsw-alias-label-error,#b42318)}
.dshp-note{font-size:11.5px;color:var(--dsw-alias-label-primary-dimmed,inherit);opacity:.8;padding:4px 10px 0}
.dshp-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22))}
.dshp-btn{font:inherit;font-size:12.5px;padding:6px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l3,rgba(127,127,127,.35));background:transparent;color:inherit;cursor:pointer}
.dshp-btn:hover:not([disabled]){background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.14))}
.dshp-btn[disabled]{opacity:.55;cursor:default}
.dshp-btnPrimary{border-color:var(--dsw-alias-brand-primary,rgba(77,107,254,.55));color:var(--dsw-alias-brand-text,var(--dsw-alias-brand-primary,#3b5bdb))}
.dshp-status{padding:8px 16px;font-size:12px;min-height:0}
.dshp-statusWarn{padding:8px 16px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-error,#a15c00);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d48806) 10%,transparent);border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d48806) 22%,transparent)}
.dshp-statusError{color:var(--dsw-alias-label-error,#b42318);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#b42318) 10%,transparent);border-top:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#b42318) 22%,transparent);padding:8px 16px;font-size:12px}
.dshp-statusOk{color:var(--dsw-alias-state-success-primary,#1a7f37);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 10%,transparent);border-top:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 22%,transparent);padding:8px 16px;font-size:12px}
.dshp-spinner{display:inline-block;width:12px;height:12px;margin-right:6px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-top-color:var(--dsw-alias-brand-primary,rgba(77,107,254,.9));animation:dshp-spin .8s linear infinite;vertical-align:-2px}
@keyframes dshp-spin{to{transform:rotate(360deg)}}
.dshp-menuItem{display:flex;width:100%;align-items:center;gap:8px;padding:6px 10px;font:inherit;font-size:13px;color:inherit;background:transparent;border:none;border-radius:6px;cursor:pointer;text-align:left}
.dshp-menuItem:hover,.dshp-menuItem:focus-visible{background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.16));outline:none}
.dshp-menuIcon{color:var(--dsw-alias-label-primary-dimmed,inherit);opacity:.8;font-size:12px}
`;
    const injectStyles = (ctx) => {
      ctx.effect(() => {
        if (typeof document === "undefined") return () => {};
        let element = document.getElementById(STYLE_ID);
        if (element === null) {
          element = document.createElement("style");
          element.id = STYLE_ID;
          element.textContent = CSS;
          document.head.appendChild(element);
        }
        return () => {
          const current = document.getElementById(STYLE_ID);
          if (current !== null) current.remove();
        };
      }, "dsh-chat-projects: styles");
    };
    //#endregion

    //#region components
    const MoveMenuItem = (props) => {
      const displayTitle = props && typeof props.displayTitle === "string" ? props.displayTitle : "";
      const sessionId = props ? props.sessionId : undefined;
      const useMenuOpenState = props ? props.useMenuOpenState : undefined;
      const close = (() => {
        if (typeof useMenuOpenState !== "function") return () => {};
        try {
          const [, setMenuOpen] = useMenuOpenState();
          return () => setMenuOpen(false);
        } catch {
          return () => {};
        }
      })();
      if (sessionId === undefined) return null;
      return h(
        "button",
        {
          type: "button",
          role: "menuitem",
          className: "dshp-menuItem",
          onClick: () => {
            close();
            void openDialog(sessionId, displayTitle);
          },
        },
        h("span", { className: "dshp-menuIcon", "aria-hidden": "true" }, "→"),
        h("span", null, t("menu.moveToProject"))
      );
    };

    const SessionSubtitle = (props) => {
      const state = useStore();
      const title = state.title && state.title.length > 0 ? state.title : t("menu.untitled");
      return h("div", { className: "dshp-sub", title }, t("menu.subtitle", { title }));
    };

    const ProjectRow = (props) => {
      const state = useStore();
      const workspace = props.workspace;
      const isCurrent = state.session !== null && state.session !== undefined && state.session.currentWorkspaceId === workspace.id;
      const busy = state.busy;
      const target = state.pendingTarget === workspace.id;
      const count = typeof workspace.sessionCount === "number" ? workspace.sessionCount : 0;
      const missing = workspace.status !== undefined && workspace.status !== "ok";
      const session = state.session;
      const queueCapable = state.capabilities !== undefined && state.capabilities !== null && state.capabilities.queue === true;
      const blocked = isCurrent || busy || missing || (session !== null && session !== undefined && session.live === true && !queueCapable);
      const badge = isCurrent ? t("dialog.current") : missing ? "!" : `${count}`;
      return h(
        "button",
        {
          type: "button",
          className: "dshp-row",
          "data-current": isCurrent ? "true" : "false",
          disabled: blocked,
          title: workspace.path,
          onClick: () => {
            if (blocked) return;
            void chooseTarget(workspace.id, workspace.title);
          },
        },
        h(
          "span",
          { className: "dshp-rowTop" },
          h("span", { className: "dshp-rowName" }, workspace.title || workspace.path),
          h("span", { className: "dshp-badge" }, target ? h("span", { className: "dshp-spinner" }) : "", badge)
        ),
        h("span", { className: "dshp-rowPath" }, workspace.path)
      );
    };

    const MoveDialog = () => {
      const state = useStore();
      react.useEffect(() => {
        if (!state.open) return undefined;
        const onKeyDown = (event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            closeDialog();
          }
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
      }, [state.open]);
      if (!state.open) return null;
      const session = state.session;
      const isGrouped = session !== null && session !== undefined && session.currentWorkspaceId !== null;
      const body = [];
      if (state.loading) {
        body.push(
          h("div", { className: "dshp-status" }, h("span", { className: "dshp-spinner" }), t("dialog.loading"))
        );
      } else if (state.workspaces.length === 0 && state.error === null) {
        body.push(h("div", { className: "dshp-status" }, t("dialog.empty")));
      } else {
        const live = session !== null && session !== undefined && session.live === true;
        const queued = session !== null && session !== undefined && session.queued === true;
        if (queued) {
          const queuedName = session.queuedTargetTitle;
          const queuedHint =
            session.queuedTargetWorkspaceId === null
              ? t("dialog.queuedUngroupedHint")
              : t("dialog.queuedHint", { name: queuedName || session.queuedTargetWorkspaceId || "" });
          body.push(
            h(
              "div",
              { className: "dshp-statusWarn" },
              queuedHint,
              session.queuedError ? h("div", null, t("dialog.queuedError", { code: session.queuedError })) : null
            )
          );
        } else if (live) {
          const queueCapable = state.capabilities !== undefined && state.capabilities !== null && state.capabilities.queue === true;
          body.push(h("div", { className: "dshp-statusWarn" }, queueCapable ? t("dialog.liveHint") : t("dialog.restartForQueue")));
        }
        body.push(h("div", { className: "dshp-groupLabel" }, t("dialog.chooseProject")));
        for (const workspace of state.workspaces) {
          body.push(h(ProjectRow, { key: workspace.id, workspace }));
        }
        if (isGrouped) {
          body.push(h("div", { className: "dshp-groupLabel" }, t("dialog.otherActions")));
          body.push(
            h(
              "button",
              {
                type: "button",
                className: "dshp-row dshp-danger",
                disabled:
                  state.busy ||
                  (session !== null && session !== undefined && session.live === true && !(state.capabilities && state.capabilities.queue === true)),
                onClick: () => void chooseTarget(null, null),
              },
              h(
                "span",
                { className: "dshp-rowTop" },
                h("span", { className: "dshp-rowName" }, t("dialog.ungrouped")),
                state.pendingTarget === null && state.busy ? h("span", { className: "dshp-spinner" }) : null
              ),
              h("span", { className: "dshp-rowHint" }, t("dialog.ungroupedHint"))
            )
          );
        }
        const matched = state.ungrouped && typeof state.ungrouped.matched === "number" ? state.ungrouped.matched : 0;
        const total = state.ungrouped && typeof state.ungrouped.total === "number" ? state.ungrouped.total : 0;
        if (total > 0) {
          body.push(h("div", { className: "dshp-groupLabel" }, t("dialog.organize")));
          body.push(
            h("div", { className: "dshp-note" }, t("dialog.organizeHint", { matched, total })),
            h(
              "div",
              { style: { padding: "6px 6px 2px" } },
              h(
                "button",
                {
                  type: "button",
                  className: "dshp-btn dshp-btnPrimary",
                  disabled: state.organizing || state.busy || matched === 0,
                  onClick: () => void organizeUngrouped(),
                },
                state.organizing ? h("span", { className: "dshp-spinner" }) : null,
                state.organizing ? t("dialog.organizing") : `${t("dialog.organize")} (${matched})`
              )
            )
          );
        }
      }
      const statusLines = [];
      if (state.error !== null) statusLines.push(h("div", { key: "error", className: "dshp-statusError" }, state.error));
      if (state.notice !== null) {
        statusLines.push(
          h("div", { key: "notice", className: "dshp-statusOk" }, state.notice, h("span", { style: { opacity: 0.7 } }, " · " + t("notice.refresh")))
        );
      }
      if (state.organizeResult !== null) {
        statusLines.push(h("div", { key: "organize", className: "dshp-statusOk" }, state.organizeResult));
      }
      return h(
        "div",
        {
          className: "dshp-overlay",
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) closeDialog();
          },
        },
        h(
          "div",
          { className: "dshp-card", role: "dialog", "aria-modal": "true", "aria-label": t("menu.title") },
          h(
            "div",
            { className: "dshp-head" },
            h("h2", { className: "dshp-title" }, t("menu.title")),
            h(SessionSubtitle)
          ),
          h("div", { className: "dshp-body" }, body),
          statusLines,
          h(
            "div",
            { className: "dshp-foot" },
            h("span", { style: { fontSize: 11.5, opacity: 0.55 } }, state.busy ? t("dialog.busy") : ""),
            h(
              "span",
              { style: { display: "flex", gap: 8 } },
              session !== null && session !== undefined && session.queued === true
                ? h(
                    "button",
                    {
                      type: "button",
                      className: "dshp-btn",
                      onClick: () => void cancelQueuedMove(),
                      disabled: state.busy,
                    },
                    t("dialog.cancelQueue")
                  )
                : null,
              h(
                "button",
                { type: "button", className: "dshp-btn", onClick: () => closeDialog(), disabled: state.busy },
                t("dialog.cancel")
              )
            )
          )
        )
      );
    };
    //#endregion

    const inject = ["slots"];

    const apply = (ctx) => {
      injectStyles(ctx);
      ctx.effect(
        () =>
          ctx.slots.inject("sidebar.workspaces.session.menu.item", () =>
            ctx.slots.register(
              {
                name: "sidebar.workspaces.session.menu.item",
                id: "dsh-chat-projects.move-session",
                order: 410,
              },
              MoveMenuItem
            )
          ),
        "dsh-chat-projects: session row menu"
      );
      ctx.effect(
        () =>
          ctx.slots.inject("shell.overlay", () =>
            ctx.slots.register(
              {
                name: "shell.overlay",
                id: "dsh-chat-projects.move-dialog",
                order: 420,
              },
              MoveDialog
            )
          ),
        "dsh-chat-projects: move dialog"
      );
    };

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});