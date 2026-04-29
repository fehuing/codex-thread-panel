# Codex Thread Panel

A Windows-focused terminal UI for browsing local Codex projects and threads, opening/resuming threads, creating new threads, renaming local thread titles, archiving threads, and viewing Codex quota information from local session logs.

## Run

```powershell
npm install
.\Start-CodexThreadPanel.cmd
```

## Files

- `CodexThreadPanelTui.js`: main Node.js TUI.
- `CodexThreadBridge.js`: local bridge for agent aliases, message queue records, rules, and launching `codex resume`.
- `CodexManagedSession.js`: phase-3 ConPTY-backed runner that owns a live Codex session and can inject queued prompts.
- `Send-CodexThreadMessage.ps1`: PowerShell wrapper for the bridge; safe to call from another Codex thread.
- `Start-CodexThreadPanel.cmd`: default launcher.
- `Start-CodexThreadPanel-Maximized.cmd`: maximized launcher.
- `Rename-CodexThread.ps1`: Unicode-safe external rename helper.
- `Start-CodexLaunch.ps1`: helper for launching visible PowerShell Codex sessions.
- `CodexThreadPanel.ps1`: earlier PowerShell/WinForms prototype kept for reference.

## Bridge

From the panel, select a thread and press `P` to enter a prompt for that thread.

Press `G` on a selected thread to assign an agent alias such as `thread-a` or `frontend-agent`.

Press `M` on a selected thread to open it as a managed PTY session. Only managed sessions can receive direct injected prompts without opening another Codex window.

When opening/resuming a thread from the panel, the launcher uses that thread's last recorded Codex model and reasoning effort if available. For example, a thread last used with `gpt-5.5 / xhigh` is resumed with those options instead of whatever the current global default model is.

From another Codex thread, call:

```powershell
powershell -ExecutionPolicy Bypass -File D:\codex_chat\Send-CodexThreadMessage.ps1 -To frontend-agent -Prompt "your prompt" -Permission Normal -Mode launch -From thread-a
```

To inject into an already running managed session, use:

```powershell
powershell -ExecutionPolicy Bypass -File D:\codex_chat\Send-CodexThreadMessage.ps1 -To frontend-agent -Prompt "your prompt" -Mode inject -From thread-a
```

To inject if the target is online, or start a managed session first if it is offline, use:

```powershell
powershell -ExecutionPolicy Bypass -File D:\codex_chat\Send-CodexThreadMessage.ps1 -To frontend-agent -Prompt "your prompt" -Permission Normal -Mode auto -From thread-a
```

To request a reply back to the sender, add `-ReplyTo` and `-RequireReply`:

```powershell
powershell -ExecutionPolicy Bypass -File D:\codex_chat\Send-CodexThreadMessage.ps1 -To frontend-agent -Prompt "your prompt" -Permission Normal -Mode auto -From thread-a -ReplyTo thread-a -RequireReply
```

Useful bridge commands:

```powershell
node .\CodexThreadBridge.js list --query codex
node .\CodexThreadBridge.js resolve --query "thread title"
node .\CodexThreadBridge.js agent set --name frontend-agent --query "thread title"
node .\CodexThreadBridge.js agent list
node .\CodexThreadBridge.js send --to frontend-agent --prompt "your prompt" --from thread-a
node .\CodexThreadBridge.js send --to frontend-agent --prompt "your prompt" --mode inject --from thread-a
node .\CodexThreadBridge.js send --to frontend-agent --prompt "your prompt" --mode auto --from thread-a --reply-to thread-a --require-reply
node .\CodexThreadBridge.js inbox --thread-id <thread-id>
node .\CodexThreadBridge.js mark --message-id <message-id> --status done
node .\CodexThreadBridge.js rules show
node .\CodexThreadBridge.js managed list
node .\CodexManagedSession.js start --to frontend-agent --permission Normal
node .\CodexThreadBridge.js stats
```

Bridge data is stored under `%USERPROFILE%\.codex\thread_panel_bridge`.

`--mode launch` opens a new Codex resume window. `--mode queue` only records the message. `--mode inject` writes the prompt into a live managed PTY session; if no managed session is running, the message stays queued. `--mode auto` injects into an online managed session, or starts one first and then leaves the message queued for injection.

Injected messages are wrapped before they reach the target Codex session:

```text
[Bridge message]
From: thread-a
To: frontend-agent
Message-Id: msg-...
Reply-To: thread-a
Require-Reply: yes
Reply-Command: powershell -ExecutionPolicy Bypass -File "D:\codex_chat\Send-CodexThreadMessage.ps1" -To thread-a -Mode auto -From frontend-agent -Prompt "<reply text>"
Reply-Note: If command execution requires approval, ask the user to approve it.

your prompt
```

Set `CODEX_MANAGED_BRIDGE_HEADER=0` to inject the raw prompt without this header.

Phase 3 cannot inject into old windows opened with `O` or manually opened PowerShell. Those processes are not owned by the panel. Use `M` or `CodexManagedSession.js start` for sessions that need direct injection.

Managed sessions wait briefly before the first injection so a newly resumed Codex TUI can finish loading. Tune with `CODEX_MANAGED_INITIAL_INJECT_DELAY_MS`, `CODEX_MANAGED_SUBMIT_DELAY_MS`, `CODEX_MANAGED_SUBMIT_RETRY_MS`, and `CODEX_MANAGED_SUBMIT_ENTER_COUNT` if a local terminal behaves differently.

Panel-managed sessions restore the last 3 user turns by default, then start Codex with `--no-alt-screen` so the restored context remains visible in the same scrollback. Set `CODEX_MANAGED_HISTORY_TURNS` to tune the count, or `CODEX_MANAGED_HISTORY_REPLAY=0` to disable local replay for manual `CodexManagedSession.js` launches.
