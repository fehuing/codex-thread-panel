# Codex Thread Panel

A Windows-focused terminal UI for browsing local Codex projects and threads, opening/resuming threads, creating new threads, renaming local thread titles, archiving threads, and viewing Codex quota information from local session logs.

## Run

```powershell
.\Start-CodexThreadPanel.cmd
```

## Files

- `CodexThreadPanelTui.js`: main Node.js TUI.
- `Start-CodexThreadPanel.cmd`: default launcher.
- `Start-CodexThreadPanel-Maximized.cmd`: maximized launcher.
- `Rename-CodexThread.ps1`: Unicode-safe external rename helper.
- `Start-CodexLaunch.ps1`: helper for launching visible PowerShell Codex sessions.
- `CodexThreadPanel.ps1`: earlier PowerShell/WinForms prototype kept for reference.
