# Codex Thread Panel 分析记录

记录日期：2026-09-07

## Fact

- 本地路径：`D:\codex_panel\codex-thread-panel`
- 仓库：`https://github.com/fehuing/codex-thread-panel.git`
- 当前分支：`master`
- 当前上游提交：`2f7eff2 Remove local cross-thread bridge`
- 拉取方式：`git pull --ff-only origin master`
- 当前 README 运行方式：`.\Start-CodexThreadPanel.cmd`
- 当前代码文件搜索结果：`README.md`、`CodexThreadPanelTui.js`、`.gitignore` 中没有 `Bridge`、`ManagedSession`、`Send-CodexThreadMessage`、`thread_panel_bridge`、`node-pty`、`package.json`、`package-lock` 引用。
- 已删除本地 stash：`stash@{0}: local package-lock before pulling latest upstream`
- `node_modules/` 是旧版 npm 安装留下的本地残留；删除命令被当前命令策略拒绝，尚未移除。

## Inference

上游最新代码已经把本地跨线程 Bridge 功能完全移除。当前项目不再需要 `npm install`，也不再需要 `package.json`、`package-lock.json`、`CodexThreadBridge.js`、`CodexManagedSession.js`、`Send-CodexThreadMessage.ps1` 或 `@homebridge/node-pty-prebuilt-multiarch`。

不确定性：这是基于当前本地代码搜索、README 和提交内容的判断；如果后续上游重新加入相关功能，需要重新检查。

## 当前项目用途

这是一个 Windows 定向的 Codex 本地线程面板。它读取本机 `%USERPROFILE%\.codex` 下的会话索引、SQLite 状态库和 session jsonl 文件，提供终端 UI 来浏览、搜索、打开、重命名、归档 Codex 线程，并显示 Codex quota 信息。

## 主要文件

- `CodexThreadPanelTui.js`：主 TUI；负责读取线程、渲染面板、处理快捷键、启动 Codex 窗口。
- `Start-CodexThreadPanel.cmd`：默认启动脚本，执行 `node --no-warnings "%~dp0CodexThreadPanelTui.js"`。
- `Start-CodexThreadPanel-Maximized.cmd`：最大化启动脚本。
- `Start-CodexThreadPanel-Gui.cmd`：启动旧的 PowerShell/WinForms 原型。
- `Rename-CodexThread.ps1`：重命名辅助脚本；写入 `thread_title_overrides.json`，并尝试同步 `session_index.jsonl`。
- `Start-CodexLaunch.ps1`：打开可见 PowerShell Codex session 的辅助脚本。
- `CodexThreadPanel.ps1`：早期 PowerShell/WinForms 原型，保留参考。

## 数据来源

- Codex home：默认 `C:\Users\Administrator\.codex`，也支持 `CODEX_HOME` 覆盖。
- 正常线程列表来源：`state_5.sqlite`、`session_index.jsonl` 和桌面端 `.codex-global-state.json` 的 `pinned-thread-ids`；session jsonl 只在前两者均不可用时才会作为受限兜底读取。
- quota 来源：最近 20 个 session jsonl 尾部的全局 `codex` `rate_limits` 事件，每个文件最多读取 256 KiB；模型专属额度事件不参与账户全局额度显示。
- 标题覆盖文件：`thread_title_overrides.json`。

## 运行模型

普通打开线程时，面板会生成临时 PowerShell 脚本，再通过 `explorer.exe`、`wt.exe` 或 PowerShell launcher 打开一个新的 `codex resume` 窗口。启动参数会继承线程记录里的模型和 reasoning effort。

权限模式有四档：

- `1 Safe`：`read-only + on-request`
- `2 Normal`：`workspace-write + on-request`
- `3 Auto`：`workspace-write + never`
- `4 Full`：`danger-full-access + never`

## 已验证命令

```powershell
git fetch origin
git pull --ff-only origin master
git stash drop 'stash@{0}'
rg -n 'Bridge|ManagedSession|Send-CodexThreadMessage|thread_panel_bridge|node-pty|package-lock|package\.json' README.md CodexThreadPanelTui.js .gitignore
```

## 2026-09-07 性能优化记录

### Fact

- 本机 `sessions` 与 `archived_sessions` 共有 397 个 jsonl 文件，合计 20.87 GB；最大单文件为 4.32 GB。
- 外部 `sqlite3.exe` 在当前终端不可用；Node 24.13.0 提供可用的 `node:sqlite` 接口。
- 优化前的 TUI 会无条件读取全部 session jsonl；额度刷新每 10 秒会把最近文件完整读入内存。此前 `node CodexThreadPanelTui.js --check` 在 90 秒内没有返回。
- 优化后，`node --no-warnings .\CodexThreadPanelTui.js --check` 实际输出 395 个线程、22 个项目，耗时 321 ms。

### 改动

- `CodexThreadPanelTui.js` 优先通过 Node 内置 SQLite 查询线程列表，保留外部 sqlite3 的兼容回退。
- 有 SQLite 或 session index 数据时，列表页不读取任何 session jsonl；两类索引均不可用时，兜底扫描每个文件最多读取开头 256 KiB。
- 会话排序和显示时间优先使用 `state_5.sqlite` 的最近活动时间；`session_index.jsonl` 仅在其时间更晚时才覆盖。面板每 5 秒只检查状态库、WAL 和索引文件的元数据，检测到变更才刷新线程列表，并保留当前选中的项目或线程。
- quota 刷新改为仅读取最近 20 个文件各自末尾 256 KiB，不再全量读取，也不再在找不到结果时扫描全部历史文件。
- 渲染定时器从 250 ms 调整为 1000 ms，初始 quota 查询后延迟 10 秒再刷新。
- 两个 CLI 启动脚本使用 `--no-warnings`，避免 Node 内置 SQLite 的实验性提示干扰 TUI。
- 窗口缩放改为监听终端 resize 事件并在 75 ms 后合并重绘；尺寸变化不再清屏，只重画差异行。每秒一次的尺寸检查保留为不支持 resize 事件的终端兜底。

### 限制

- 已经打开的旧 Node 面板进程不会热更新；需要按 `Q` 退出后重新运行 `.\Start-CodexThreadPanel.cmd`。
- `Start-CodexThreadPanel-Gui.cmd` 启动的是另一套旧 PowerShell/WinForms 原型，不包含本次 TUI 性能优化。

## 2026-09-07 客户端列表对齐

### Fact

- 当前 Codex `threads` 表含有新的 `name`、`thread_source` 字段。官方客户端将 `name` 或 `session_index.jsonl` 的 `thread_name` 作为短标题来源；旧面板仅查询 `title`，因此会显示原始长提示词或 `Untitled thread`。
- 本机 `douyin` 项目顶部的无标题记录属于委派辅助线程；它们没有 `name`、`thread_name`、`title` 或首条用户消息。
- 官方客户端仍显示两条旧的委派任务“西语电影解说—独立校对与质检”和“西语电影解说—文案与配音”，因为它们在 `session_index.jsonl` 中有正式标题。
- 优化后的面板实测 `douyin` 项目无 `Untitled thread`，展示了上述两条西语任务，以及“分析TK视频复刻可行性”“定位短视频卡点原片位置”“解释视频剪辑显卡需求原理”。

### 改动

- 列表标题优先级调整为 `threads.name`、`session_index.thread_name`、旧 `title`、首条用户消息；不再使用面板私有的 `thread_title_overrides.json` 作为显示来源。
- 所有 `guardian_review` 内部审阅记录都会隐藏；无用户可见标题的 `subagent` 记录也会隐藏，保留拥有正式标题的历史委派任务。
- TUI 内按 `T` 改名不再开启旧 PowerShell 改名脚本，而是更新 `state_5.sqlite` 的 `threads.name`，并同步旧 session index 以保持兼容。

### 置顶

- 桌面端置顶状态以 `.codex-global-state.json` 的 `pinned-thread-ids` 为准，而不是 `state_5.sqlite.is_pinned`；当前数据库字段全部为 `0`，而桌面端全局清单维护置顶线程。
- 面板在列表顶部显示独立的“置顶”区，严格按桌面端清单顺序排列；置顶线程不会在原项目列表中重复，选中后仍可在详情查看原项目归属。面板仅读取，不提供新增或取消置顶操作。

## 2026-09-07 界面语言

### Fact

- TUI 默认语言为中文；`L` 可在中文和英文界面之间即时切换。
- 本地化范围包括面板标题、分区标题、列表和详情标签、状态提示、搜索/路径/改名输入提示、权限模式、额度信息、滚动提示和快捷键说明。
- 工作区统计区按终端显示宽度统一标签和值的分隔列，中文标签与英文标签都保持值列对齐。
- 快捷键说明在空间足够时逐项竖排；窗口较矮时自动切换为四行紧凑版，并始终将 `L` 语言切换置于第一行。
- 已执行 `node --check CodexThreadPanelTui.js`、`git diff --check`、`node --no-warnings .\CodexThreadPanelTui.js --check`；线程索引检查正常完成，当前读取到 170 个线程、22 个项目。
- 使用不启动 TUI 主循环的 Node 验证脚本，确认默认渲染帧含“Codex 线程面板”和 `L：中英文切换`，按 `L` 后切换为“Codex Thread Panel”和 `L: switch Chinese / English`。
- 根因：项目行、详情行和统计行曾分别通过字符串拼接生成；可变长度的项目名或中文宽字符会推动后续字段，造成数量、日期或值列错位。
- 已统一为显示宽度感知的列布局函数：项目列表固定“名称 / 数量 / 更新时间”列，详情与统计区固定“标签 / 值”列。针对不同长度的中英文项目名和标题，已验证三类区域的列起始位置一致。
- 后续发现并修复 Unicode 宽度算法缺口：旧实现将全部非 ASCII 字符当作双宽，导致 `Pokémon` 中的 `é` 被错误计为双宽，使该项目行的数量和日期向左偏一格。现按 Unicode 类别处理单宽扩展拉丁字符、双宽 CJK、零宽组合音标和 emoji 图形，并让截断逻辑复用同一规则。
- Codex app-server 的 `GetAccountResponse` 将 `pro` 和 `prolite` 定义为不同的账户套餐类型；本机实时额度事件返回 `plan_type: pro`，且当前客户端套餐页显示 `$200/月`。面板据此直接显示 `Pro $200/月 · 20x`；`prolite` 显示 `Pro $100/月 · 5x`。不再使用任何手动设置或面板私有偏好。
- 根因：会话记录同时包含账户全局 `limit_id: codex` 和模型专属 `limit_id: codex_bengalfox`（`GPT-5.3-Codex-Spark`）的额度事件；后者的 `0%/0%` 曾因更新时间更新而覆盖前者。面板现仅读取 `codex`，并只渲染事件实际提供的额度窗口，不再把缺失窗口显示为 `100%`。
- 额度健康度按“剩余额度相对本轮重置窗口的剩余时间”判定：额度不落后于时间进度为良好（绿）；落后超过 10 个百分点，或额度低于 15% 且本轮仍剩超过 35% 时为中等（橙）；已耗尽、额度低于 5% 且本轮仍剩超过 15%、或落后超过 25 个百分点时为严重（红）。缺少有效重置时间时，按剩余 30% / 10% 作为中等 / 严重的保守兜底阈值。
- 官方当前说明：Pro $100 为 Plus 的 5x 用量，Pro $200 为 Plus 的 20x 用量。

### 限制

- 语言选择只保存在当前面板进程内；重新启动面板时会恢复默认中文。
