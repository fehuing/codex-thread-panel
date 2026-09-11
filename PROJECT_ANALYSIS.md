# Codex Thread Panel 分析记录

更新日期：2026-09-12

## 目标

为 Windows 上已安装 Codex CLI / Desktop 的用户提供一个本地终端面板，解决大量长期会话下“查找、恢复和管理某个任务”不够轻快的问题。项目专注于列表浏览与会话入口，不替代 Codex Desktop。

## Fact：数据来源

- 默认 Codex 数据目录为 `%USERPROFILE%\.codex`，可由 `CODEX_HOME` 覆盖。
- 线程列表优先从 `state_5.sqlite` 读取；`session_index.jsonl` 用于补齐标题和更新时间。
- Desktop 的置顶状态来自 `.codex-global-state.json` 的 `pinned-thread-ids`，不是 SQLite 中的旧置顶字段。
- 线程的展示标题按 Desktop 的可用命名来源优先级合并：SQLite 原生名称、索引标题、其他标题字段和首条用户消息。无法获得标题时才使用稳定的占位标题。
- 日、周、月和账号累计 Token 统计优先来自本机 Codex `app-server` 的只读 `account/usage/read`；返回包含账户汇总和逐日 bucket。
- 若账户统计暂时不可用，面板降级为从 session JSONL 的已完成 `thread_token_usage.total_tokens` 汇总。这个降级值仅代表本机可读会话，不应标为账号总账。

## Fact：性能策略

- 列表页不读取每个 session JSONL 的会话内容；仅在 SQLite 和索引都不可用时，才对 JSONL 做受限元数据回退扫描。
- 主列表刷新只检查 SQLite、WAL、session 索引和置顶配置的文件签名；没有变化时不重建列表。
- quota 读取仅查看有限的近期 session 尾部区块，并且仅接受账户全局 `limit_id: codex` 额度事件，避免模型专属事件覆盖账户全局额度。
- 账户 Token 查询在 Worker 线程中执行，短生命周期 `app-server` 完成后立即退出；首次查询与周期刷新都不阻塞键盘输入。
- UI 每秒刷新一次，用于时钟、额度倒计时和宠物帧；不是高频全屏重绘。

## Fact：显示一致性

- 项目列表采用显示宽度感知的固定列布局：项目名称、会话数量和更新时间各自拥有固定区域。
- 详情和工作区统计采用固定的“标签 / 值”列，而不是直接拼接字符串。
- Unicode 宽度算法区分扩展拉丁、CJK、组合音标和 emoji，因此带重音字母的项目名不会把后续列推移。
- 置顶会话在顶部独立展示，遵循 Desktop 清单顺序，同时在详情区保留原项目归属；置顶会话不会在原项目下重复出现。

## Fact：功能范围

- 浏览、展开、搜索项目和会话。
- 在可见的 PowerShell / Windows Terminal 窗口中启动 `codex resume`。
- 在选中项目中创建会话，按本地状态库重命名或归档会话，打开项目文件夹。
- `L` 即时切换中文 / 英文。
- 常规状态下按 `1` 至 `4` 切换 Campy 猫、仓鼠、幽灵和机器人闲置动画；权限选择状态保留这些数字作为权限模式按键。
- 只展示 Desktop 已有的置顶状态；当前不提供新增或取消置顶操作。

## Fact：额度策略

- 账号套餐展示直接取 Codex 返回的套餐类型；`prolite` 显示为 `Pro $100/月 · 5x`，`pro` 显示为 `Pro $200/月 · 20x`。
- 额度状态同时比较剩余额度和本轮重置窗口的剩余时间：进度不落后为绿色；落后超过 10 个百分点，或剩余较少且仍有较长时间为橙色；耗尽、严重落后或极低余额为红色。
- 累计 Token 使用“亿”作为显示单位。后面的 API 金额是基于简化输入 / 输出比例的调侃式估算，不是任何实际账单。

## Inference：为什么这样做

长期积累的 session JSONL 可以很大；如果每次启动、刷新或窗口变化都完整读取每份历史记录，列表浏览的延迟会随历史体量放大。SQLite 和 session 索引已经提供了首屏所需的 ID、标题、路径、状态和更新时间，因此将 JSONL 限制在无索引时的回退路径，能把工作量压缩到与列表元数据相关的规模。

不确定性：Codex 的本地状态格式属于客户端实现细节，未来版本可能调整表结构、索引字段或 `app-server` 协议。代码保留多源合并与受限回退，但升级 Codex 后仍应执行下方验证。

## 隐私边界

- 项目树、标题、路径、归档和置顶数据只从本机 Codex 目录读取。
- 面板不要求额外 API Key，也不保存登录凭据。
- 开启、恢复会话均在本机启动 Codex CLI。
- 公开 README 中的截图由真实渲染函数喂入虚构 `REDACTED` 数据生成；不使用真实项目、路径或会话标题。

## 验证清单

```powershell
node --check .\CodexThreadPanelTui.js
node --no-warnings .\CodexThreadPanelTui.js --check
git diff --check
```

另外，针对 Campy 快捷键与布局执行了不启动 TUI 主循环的渲染测试，覆盖：

- 紧凑高度下的快捷键布局；
- 宽终端下右下角宠物的渲染；
- `1` 至 `4` 宠物切换；
- 权限模式不抢占 `1` 至 `4` 的权限选择。

## 第三方组件

四组 Campy ASCII 宠物闲置帧选自 `dropdevrahul/campy` 的 MIT 许可源码提交 `814566b7df24512c64884550bd22589d5fedd2d4`。项目不安装 Campy，也不接入其 MCP、hook 或自动配置能力；完整许可见 `THIRD_PARTY_NOTICES.md`。
