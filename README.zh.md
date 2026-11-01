# dsh-projects — 像 ChatGPT Projects 一样整理 DSH 的会话与项目

[English](README.md) | [中文](README.zh.md)

[![test](https://github.com/Tzh0109/DSH-projects/actions/workflows/test.yml/badge.svg)](https://github.com/Tzh0109/DSH-projects/actions/workflows/test.yml)

DeepSeek Harness（DSH）里，**工作区（Workspace）= 项目文件夹**，会话在创建时绑死在该工作区，官方没有「把已有会话移动到另一个项目」的功能。本插件补上这块能力，并且**不替换原生侧栏**——项目的新建 / 改名 / 排序 / 删除仍然用 DSH 自带的那套。

- **会话行「…」菜单 →「移动到项目…」**：把已有会话移动到另一个项目（工作区），侧栏分组即时刷新。
- **「未分组（移出项目）」**：把会话从项目里摘出来，落到侧栏的 Ungrouped。
- **一键整理未分组会话**：把「原始目录已经是某个项目」的未分组会话批量归位（以前只能手改 `workspace.json` 的场景）。
- **打开中的会话排队移动**：DSH 在本次运行中会把打开过的会话常驻内存（header 冻结、写租约绑在旧路径），这类会话不能当场搬文件。插件会把它**排队**，在下次启动 DSH 时、任何代理加载之前自动完成；弹窗里可随时取消。

## 环境要求

- DSH 桌面版（`0.2.1-rc.x`，使用自带运行时）：Host 半依赖 Node 内置的 Zstandard API（Node >= 22.15，DSH 自带 24.x）。
- 无 npm 运行时依赖：纯 ESM + React（`react` 由 DSH 客户端基线提供）。

## 安装

用 DSH 桌面版自带的 CLI：

```powershell
# 从 GitHub 安装
dsh plugin --profile desktop add github:Tzh0109/DSH-projects

# 或从本地目录安装（开发用）
dsh plugin --profile desktop add "link:C:\path\to\dsh-projects"
```

如果 `dsh` 不在 PATH，用自带入口：
`<DSH 安装目录>\resources\runtime\cli\bin\dsh.cmd`。

装完**重启一次 DSH 桌面应用**（Host 半需要重启）；之后只改 `lib/client.js` 时前端 HMR 会热替换，不必重启。

卸载：

```powershell
dsh plugin --profile desktop remove dsh-projects
```

## 使用

1. 左侧栏某个会话行 → 悬停 →「…」菜单 → **移动到项目…**
2. 选择目标项目（弹窗里带路径与会话数）；当前所在项目会高亮，点它等于「移出项目」。
3. 成功后弹窗提示、左侧栏自动刷新；如果该会话当前被 DSH 载入，则显示「已排队」，下次启动自动完成。

弹窗底部还有 **整理未分组会话 (N)**：只处理「日志里记录的目录已经注册成项目」的未分组会话（归档会话会跳过）。

## 实现原理

DSH 里「会话属于哪个项目」由三样东西同时决定：

| # | 决定项 | 位置 |
|---|---|---|
| 1 | 工作区记录里的有序 `sessionIds`（持久记账） | `~/.dsh/storages/workspace.json` |
| 2 | 会话 header 里不可变的 `cwd` | 会话日志第 0 个 zstd 帧 |
| 3 | 会话日志目录（`cwd` 的纯函数） | `~/.dsh/sessions/--<目录编码>--/<会话ID>/session.v4.jsonl.zstd` |

三者只有在会话创建那一刻一致。官方只给了第 1 项一个受限写入口（工作区实体的 `attachSession` / `detachSession`），第 2、3 项没有任何 API（header 创建即冻结、持久化层只追加）。所以「真移动」必须：

1. 备份原始 header 帧并写 journal（崩溃可恢复）；
2. 重写日志**第 0 帧**的 `cwd`，其余已提交事件帧一个字节都不动；
3. 把会话目录搬到目标项目的目录键下；
4. 在同一窗口里「旧项目 detach → 新项目 attach」，避免一个会话被两个项目记账；
5. 用 DSH 自己的持久化后端校验移动结果（`stat` + 读一页事件），失败自动回滚；
6. 修补投影缓存（`session_projcache`）的身份与 `workingDirectory`，让列表标题/统计不因身份失配而短暂丢失。

`header.cwd` 同时是 `workspace-write` 沙箱的可写根，所以移动后该会话的工具边界也会跟着切到新项目。

### 安全边界（拒绝而不是硬来）

- 会话正被运行中的 Agent 加载（header 冻结 + 单写者写租约）；
- 会话还有运行中的回合 / 子代理 / 后台任务 / 定时提醒（`workspace/session-activity` 非空）；
- 子代理会话（`origin: subagent`）；
- header 没有 `cwd`；
- 目标项目目录不存在；
- 会话仍是旧版磁盘格式（先在界面里打开一次让 DSH 迁移）；
- 目标项目里已存在同 ID 会话目录。

### 崩溃恢复与手工兜底

- 运行期 journal：`<DSH_HOME>/dsh-projects/journal.json`（成功即删除）
- 原 header 帧备份：`<DSH_HOME>/dsh-projects/backups/`
- 旧目录暂存区：`<DSH_HOME>/.dsh-projects-trash/`（同卷 rename，成功后删除）

插件启动时读取 journal：`old-moved` 阶段回滚、`new-written` / `verified` 阶段补完。自动恢复失败时保留 journal 并写日志，可按上面的路径手工把 trash 目录 rename 回原项目目录。

## 限制与注意

- **属于非官方内部存储写法**：DSH 升级后会话/工作区格式若变化，插件会因校验失败而拒绝移动（不会损坏数据）。升级后建议先跑 `npm test`，再用一个无关会话试移动。
- **已载入的会话在下次启动时移动**：本次运行中打开过的会话常驻内存（header 冻结、写租约绑旧路径），移动会排队到下次启动、在任何代理加载之前执行；本次运行没打开过的会话可以立即移动。
- **移动「当前正在看」的会话后**：刷新一下页面即可，会话数据不受影响。
- **`workspace-write` 沙箱**：移动后新项目目录需要 DSH 的沙箱授权（Windows 上是 DACL）；`danger-full-access` 无此问题。
- **不删除任何会话**：移动只改归属；「移出项目」也不会删日志。

## 开发

```powershell
git clone https://github.com/Tzh0109/DSH-projects
cd DSH-projects
npm test        # node --test test/core.test.mjs
```

测试是自包含的：自己生成带校验和的 zstd 会话日志，用假的 persistence / registry 服务驱动移动引擎，覆盖路径编码、头帧改写、移动、忙碌拒绝、回滚、批量归位和排队移动，不读取本机 DSH 数据。

目录：

```
dsh-projects/
├─ package.json          # dsh.bundle.patch + dsh.client 声明
├─ cordis.patch.yml      # Host 半挂载行
├─ lib/
│  ├─ index.js           # Host 入口：同源 JSON API（state / move / queue / unqueue / organize）
│  ├─ mover.js           # 移动引擎：路径编码、zstd 头帧改写、记账、回滚、崩溃恢复
│  └─ client.js          # 浏览器半：会话行菜单 + 项目选择弹窗
└─ test/core.test.mjs    # 离线测试
```

Host API（同源，受 DSH connection 信任围栏保护）：

```
GET  /plugins/dsh-projects/api/state?session=<id>
POST /plugins/dsh-projects/api/move      {"sessionId": "...", "targetWorkspaceId": "..." | null}
POST /plugins/dsh-projects/api/queue     {"sessionId": "...", "targetWorkspaceId": "..." | null}
POST /plugins/dsh-projects/api/unqueue   {"sessionId": "..."}
POST /plugins/dsh-projects/api/organize  {}
```

## 已知问题 / 待办

- 没有跨组拖拽（原生拖拽只支持同组排序；跨组需要替换整个侧栏组件，风险高）。
- 没有「撤销上一次移动」按钮；用同样的菜单移回去即可，header 帧备份在 `dsh-projects/backups/`。
- 只适配 JSONL 持久化后端的磁盘布局（`compression: zstd` 与 `none`）。

## 许可

MIT