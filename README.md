# Codex Thread Panel

A Windows-focused terminal UI for browsing local Codex projects and threads, opening/resuming threads, creating new threads, renaming local thread titles, archiving threads, and viewing Codex quota information from local session logs.

## Run

```powershell
.\Start-CodexThreadPanel.cmd
```

## Files

- `CodexThreadPanelTui.js`: main Node.js TUI.
- `CodexThreadBridge.js`: phase-1 local bridge for sending prompts to a target thread by launching `codex resume`.
- `Send-CodexThreadMessage.ps1`: PowerShell wrapper for the bridge; safe to call from another Codex thread.
- `Start-CodexThreadPanel.cmd`: default launcher.
- `Start-CodexThreadPanel-Maximized.cmd`: maximized launcher.
- `Rename-CodexThread.ps1`: Unicode-safe external rename helper.
- `Start-CodexLaunch.ps1`: helper for launching visible PowerShell Codex sessions.
- `CodexThreadPanel.ps1`: earlier PowerShell/WinForms prototype kept for reference.

## Phase 1 Bridge

From the panel, select a thread and press `P` to enter a prompt for that thread. Phase 1 opens a new Codex window with `codex resume <thread> <prompt>` and records the message locally.

From another Codex thread, call:

```powershell
powershell -ExecutionPolicy Bypass -File D:\codex_chat\Send-CodexThreadMessage.ps1 -ThreadId <thread-id> -Prompt "your prompt" -Permission Normal -Mode launch -From thread-a
```

Useful bridge commands:

```powershell
node .\CodexThreadBridge.js list --query codex
node .\CodexThreadBridge.js resolve --query "thread title"
node .\CodexThreadBridge.js inbox --thread-id <thread-id>
node .\CodexThreadBridge.js stats
```

Bridge data is stored under `%USERPROFILE%\.codex\thread_panel_bridge`.
