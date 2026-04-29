#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const pty = require("@homebridge/node-pty-prebuilt-multiarch");

const {
  PERMISSION_MODES,
  defaultAgentName,
  findBridgeAgentByThread,
  readBridgeMessages,
  readManagedSessions,
  readThreads,
  removeManagedSession,
  resolveBridgeAgent,
  updateBridgeMessageStatus,
  upsertBridgeAgent,
  writeBridgeEvent,
  writeManagedSessionHeartbeat,
} = require("./CodexThreadPanelTui.js");

function usage() {
  console.log(`Codex Managed Session

Usage:
  node CodexManagedSession.js start --thread-id ID --agent AGENT [--permission Normal] [--model MODEL] [--reasoning EFFORT]
  node CodexManagedSession.js start --to AGENT [--permission Normal] [--model MODEL] [--reasoning EFFORT]
  node CodexManagedSession.js start --to AGENT --history 0
  node CodexManagedSession.js start --to AGENT --history-skip-tail 4
  node CodexManagedSession.js list [--all] [--json]
  node CodexManagedSession.js self-test

Managed sessions own a ConPTY-backed Codex process. Messages sent with
CodexThreadBridge.js send --to AGENT --mode inject are written directly into
that running Codex TUI instead of opening a new window.
`);
}

function parseArgs(argv) {
  const aliases = {
    a: "agent",
    j: "json",
    p: "permission",
    t: "thread-id",
  };
  const options = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const raw = arg.slice(2);
      const eq = raw.indexOf("=");
      const key = eq >= 0 ? raw.slice(0, eq) : raw;
      if (eq >= 0) options[key] = raw.slice(eq + 1);
      else if (argv[i + 1] && !argv[i + 1].startsWith("-")) options[key] = argv[++i];
      else options[key] = true;
    } else if (arg.startsWith("-") && arg.length > 1) {
      const key = aliases[arg.slice(1)] || arg.slice(1);
      if (argv[i + 1] && !argv[i + 1].startsWith("-")) options[key] = argv[++i];
      else options[key] = true;
    } else {
      options._.push(arg);
    }
  }
  return options;
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function singleLine(value) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function setTerminalTitle(title) {
  const clean = singleLine(title);
  if (!clean) return;
  process.title = clean;
  process.stdout.write(`\x1b]0;${clean}\x07`);
}

function createTitleFilter() {
  let pending = "";
  return (data) => {
    const input = pending + String(data || "");
    let output = "";
    let index = 0;
    pending = "";

    while (index < input.length) {
      const match = /\x1b\](?:0|2);/.exec(input.slice(index));
      if (!match) {
        output += input.slice(index);
        break;
      }

      const start = index + match.index;
      output += input.slice(index, start);
      const bel = input.indexOf("\x07", start);
      const st = input.indexOf("\x1b\\", start);
      if (bel < 0 && st < 0) {
        pending = input.slice(start);
        break;
      }

      if (bel < 0) index = st + 2;
      else if (st < 0) index = bel + 1;
      else index = st < bel ? st + 2 : bel + 1;
    }

    if (pending.length > 4096) {
      output += pending;
      pending = "";
    }
    return output;
  };
}

function normalizePermission(value) {
  const input = String(value || "2").trim().toLowerCase();
  if (PERMISSION_MODES[input]) return PERMISSION_MODES[input];
  for (const mode of Object.values(PERMISSION_MODES)) {
    if (mode.name.toLowerCase() === input || mode.label.toLowerCase() === input) return mode;
  }
  fail(`Unknown permission mode: ${value}`);
}

function resolveThread(options) {
  const threads = readThreads();
  const to = String(options.to || options.agent || "").trim();
  if (to) {
    const agent = resolveBridgeAgent(to);
    if (!agent) fail(`Agent not found: ${to}`);
    return threads.find((thread) => thread.id === agent.thread_id) || {
      id: agent.thread_id,
      title: agent.title || agent.name,
      cwd: agent.cwd || process.cwd(),
      project: agent.project || "",
      agent: agent.name,
    };
  }
  const threadId = String(options["thread-id"] || options.id || "").trim();
  if (!threadId) fail("Missing --thread-id or --to.");
  const exact = threads.find((thread) => thread.id === threadId);
  if (exact) return exact;
  const prefixed = threads.filter((thread) => thread.id.startsWith(threadId));
  if (prefixed.length === 1) return prefixed[0];
  if (prefixed.length > 1) fail(`Thread id prefix is ambiguous: ${threadId}`);
  fail(`Thread id not found: ${threadId}`);
}

function permissionArgs(permissionMode) {
  const mode = permissionMode || PERMISSION_MODES["2"];
  return mode.args.slice();
}

function threadModelArgs(thread, options) {
  const args = [];
  const model = options.model && options.model !== true ? String(options.model) : thread?.model || "";
  const reasoning = options.reasoning && options.reasoning !== true
    ? String(options.reasoning)
    : options["reasoning-effort"] && options["reasoning-effort"] !== true
      ? String(options["reasoning-effort"])
      : thread?.reasoningEffort || "";
  if (model) args.push("-m", model);
  if (reasoning) args.push("-c", `model_reasoning_effort=${JSON.stringify(reasoning)}`);
  return args;
}

function batchQuote(value) {
  return `"${String(value || "").replace(/"/g, '""')}"`;
}

function resolveCodexCommand() {
  try {
    const output = cp.execFileSync("where.exe", ["codex"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    });
    const candidates = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return candidates.find((item) => item.toLowerCase().endsWith(".cmd"))
      || candidates.find((item) => item.toLowerCase().endsWith(".exe"))
      || candidates[0]
      || "codex";
  } catch {
    return "codex";
  }
}

function buildCodexSpawn(args) {
  const codex = resolveCodexCommand();
  if (process.platform === "win32") {
    const dir = path.join(__dirname, ".codex-managed");
    fs.mkdirSync(dir, { recursive: true });
    const launcher = path.join(dir, `managed-${process.pid}-${Date.now()}.cmd`);
    const commandLine = [batchQuote(codex), ...args.map(batchQuote)].join(" ");
    fs.writeFileSync(launcher, `@echo off\r\n${commandLine}\r\n`, "utf8");
    return {
      file: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", launcher],
      display: `${codex} ${args.join(" ")}`,
    };
  }
  return {
    file: codex,
    args,
    display: `${codex} ${args.join(" ")}`,
  };
}

function plainInjectText(prompt) {
  return String(prompt || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function bridgeHeaderForMessage(message, fallbackAgent, fallbackThreadId) {
  if (String(process.env.CODEX_MANAGED_BRIDGE_HEADER || "1").toLowerCase() === "0") return "";
  const from = message.from_agent || message.from || "unknown";
  const to = message.to_agent || fallbackAgent || message.to_thread_id || fallbackThreadId || "unknown";
  const messageId = message.id || "";
  const replyTo = message.reply_to || message.replyTo || "";
  const requireReply = Boolean(message.require_reply || message.requireReply);
  const lines = [
    "[Bridge message]",
    `From: ${from}`,
    `To: ${to}`,
  ];
  if (messageId) lines.push(`Message-Id: ${messageId}`);
  if (replyTo) lines.push(`Reply-To: ${replyTo}`);
  lines.push(`Require-Reply: ${requireReply ? "yes" : "no"}`);
  if (replyTo && requireReply) {
    lines.push(`Reply-Command: powershell -ExecutionPolicy Bypass -File "${path.join(__dirname, "Send-CodexThreadMessage.ps1")}" -To ${replyTo} -Mode auto -From ${to} -Prompt "<reply text>"`);
    lines.push("Reply-Note: If command execution requires approval, ask the user to approve it.");
  }
  lines.push("");
  return lines.join("\n");
}

function promptForMessage(message, fallbackAgent, fallbackThreadId) {
  const body = plainInjectText(message.prompt);
  const header = bridgeHeaderForMessage(message, fallbackAgent, fallbackThreadId);
  return header ? `${header}${body}` : body;
}

function messageText(payload) {
  if (!payload) return "";
  if (typeof payload.message === "string") return payload.message;
  if (typeof payload.text === "string") return payload.text;
  if (typeof payload.content === "string") return payload.content;
  if (Array.isArray(payload.content)) {
    return payload.content
      .map((part) => {
        if (!part) return "";
        if (typeof part === "string") return part;
        return part.text || part.input_text || part.output_text || "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

const STYLE = {
  reset: "\x1b[0m",
  dim: "\x1b[38;5;245m",
  dark: "\x1b[38;5;240m",
  user: "\x1b[38;5;81m",
  assistant: "\x1b[38;5;114m",
  white: "\x1b[38;5;255m",
};

function stripAnsi(value) {
  return String(value || "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function terminalWidth() {
  return Math.max(72, Math.min(120, process.stdout.columns || 100));
}

function line(width, char = "-") {
  return char.repeat(Math.max(1, width));
}

function formatReplayTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

function indentText(text, prefix = "  ") {
  return stripAnsi(text).trim().split("\n").map((row) => `${prefix}${row}`).join("\r\n");
}

function transcriptItems(thread) {
  const file = thread?.sourceFile || "";
  if (!file || !fs.existsSync(file)) return [];
  const items = [];
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let obj = null;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = obj.payload || {};
    if (obj.type !== "event_msg") continue;
    if (payload.type === "user_message") {
      items.push({ role: "User", timestamp: obj.timestamp || "", text: messageText(payload) });
    } else if (payload.type === "agent_message") {
      items.push({ role: "Assistant", timestamp: obj.timestamp || "", text: messageText(payload) });
    }
  }
  return items.filter((item) => item.text.trim());
}

function replayHistory(thread, options) {
  const enabled = String(options.history ?? process.env.CODEX_MANAGED_HISTORY_REPLAY ?? "1").toLowerCase() !== "0";
  if (!enabled) return;
  const allItems = transcriptItems(thread);
  const skipTail = Math.max(0, Number(options["history-skip-tail"] ?? process.env.CODEX_MANAGED_HISTORY_SKIP_TAIL ?? 4) || 0);
  const items = skipTail > 0 ? allItems.slice(0, Math.max(0, allItems.length - skipTail)) : allItems;
  if (!items.length) return;
  const maxChars = Number(options["history-max-chars"] || process.env.CODEX_MANAGED_HISTORY_REPLAY_MAX_CHARS || 2000000);
  let written = 0;
  const width = terminalWidth();
  process.stdout.write(`\r\n${STYLE.dark}${line(width)}${STYLE.reset}\r\n`);
  process.stdout.write(`${STYLE.white}Restored conversation history${STYLE.reset} ${STYLE.dim}${thread.title || thread.id}${STYLE.reset}\r\n`);
  const skippedText = skipTail > 0 ? `, skipped latest ${Math.min(skipTail, allItems.length)} to avoid duplicate resume output` : "";
  process.stdout.write(`${STYLE.dim}${items.length} messages loaded from local Codex session log${skippedText}${STYLE.reset}\r\n`);
  process.stdout.write(`${STYLE.dark}${line(width)}${STYLE.reset}\r\n\r\n`);
  for (const item of items) {
    const isUser = item.role === "User";
    const color = isUser ? STYLE.user : STYLE.assistant;
    const label = isUser ? "user" : "assistant";
    const time = formatReplayTime(item.timestamp);
    const body = indentText(item.text, "  ");
    const plainBlock = `${label} ${time}\n${stripAnsi(item.text).trim()}\n\n`;
    if (maxChars > 0 && written + plainBlock.length > maxChars) {
      process.stdout.write(`${STYLE.dim}[history replay truncated at ${maxChars} chars]${STYLE.reset}\r\n\r\n`);
      break;
    }
    process.stdout.write(`${color}${label}${STYLE.reset}${time ? ` ${STYLE.dim}${time}${STYLE.reset}` : ""}\r\n`);
    process.stdout.write(`${body}\r\n\r\n`);
    written += plainBlock.length;
  }
  process.stdout.write(`${STYLE.dark}${line(width)}${STYLE.reset}\r\n`);
  process.stdout.write(`${STYLE.dim}Live managed Codex session starts below.${STYLE.reset}\r\n\r\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writePromptToPty(term, prompt) {
  const text = plainInjectText(prompt);
  if (!text.trim()) return;
  const submitDelayMs = Number(process.env.CODEX_MANAGED_SUBMIT_DELAY_MS || 350);
  const retryDelayMs = Number(process.env.CODEX_MANAGED_SUBMIT_RETRY_MS || 1000);
  const enterCount = Math.max(1, Number(process.env.CODEX_MANAGED_SUBMIT_ENTER_COUNT || 2) || 2);
  term.write(`\x1b[200~${text}\x1b[201~`);
  for (let i = 0; i < enterCount; i++) {
    await sleep(Math.max(25, i === 0 ? submitDelayMs : retryDelayMs));
    term.write("\r");
  }
}

function listCommand(options) {
  const sessions = readManagedSessions(Boolean(options.all));
  if (options.json) {
    console.log(JSON.stringify(sessions, null, 2));
    return;
  }
  for (const session of sessions) {
    const state = session.online ? "online" : session.stale ? "stale" : session.status || "-";
    console.log(`${state.padEnd(8)} ${String(session.agent || "-").padEnd(24)} ${session.thread_id || "-"} pid=${session.pid || "-"}`);
  }
}

function startCommand(options) {
  const thread = resolveThread(options);
  const mode = normalizePermission(options.permission || options["permission-mode"] || "2");
  const agentRecord = upsertBridgeAgent(options.agent || options.to || findBridgeAgentByThread(thread.id)?.name || defaultAgentName(thread), thread, "managed-session");
  const agentName = agentRecord.name;
  const sessionId = `${agentName}-${process.pid}`;
  const cwd = thread.cwd && fs.existsSync(thread.cwd) ? thread.cwd : process.cwd();
  const modelArgs = threadModelArgs(thread, options);
  const inlineMode = String(options["alt-screen"] || process.env.CODEX_MANAGED_ALT_SCREEN || "0").toLowerCase() === "0";
  const args = ["resume", ...permissionArgs(mode), ...modelArgs];
  if (inlineMode) args.push("--no-alt-screen");
  args.push(thread.id);
  if (options.prompt && options.prompt !== true) args.push(String(options.prompt));

  const windowTitle = singleLine(options["window-title"]) || `Managed - ${thread.title || agentName} - ${mode.name}`;
  setTerminalTitle(windowTitle);
  console.log(`Managed agent: ${agentName}`);
  console.log(`Thread: ${thread.id}`);
  console.log(`Mode: ${mode.name}`);
  if (modelArgs.length) console.log(`Model: ${modelArgs.join(" ")}`);
  console.log(`Alt screen: ${inlineMode ? "off" : "on"}`);
  console.log("Injection: send --to " + agentName + " --mode inject");
  const spawnSpec = buildCodexSpawn(args);
  console.log(`Command: ${spawnSpec.display}`);
  replayHistory(thread, options);

  const term = pty.spawn(spawnSpec.file, spawnSpec.args, {
    name: "xterm-256color",
    cols: process.stdout.columns || 120,
    rows: process.stdout.rows || 36,
    cwd,
    env: {
      ...process.env,
      TERM: process.env.TERM || "xterm-256color",
      COLORTERM: process.env.COLORTERM || "truecolor",
    },
  });
  const filterTitle = createTitleFilter();
  const titleTimer = setInterval(() => setTerminalTitle(windowTitle), 2000);
  setTerminalTitle(windowTitle);

  const heartbeat = (status = "running") => writeManagedSessionHeartbeat({
    id: sessionId,
    agent: agentName,
    threadId: thread.id,
    title: thread.title,
    cwd,
    project: thread.project,
    pid: process.pid,
    ptyPid: term.pid,
    permission: mode.name,
    status,
  });

  heartbeat("running");
  writeBridgeEvent({ type: "managed_start", session_id: sessionId, agent: agentName, thread_id: thread.id, pid: process.pid, pty_pid: term.pid });

  term.onData((data) => process.stdout.write(filterTitle(data)));
  term.onExit(({ exitCode, signal }) => {
    clearInterval(titleTimer);
    heartbeat("stopped");
    removeManagedSession(sessionId);
    writeBridgeEvent({ type: "managed_exit", session_id: sessionId, agent: agentName, thread_id: thread.id, exit_code: exitCode, signal: signal || "" });
    cleanup();
    process.exit(exitCode || 0);
  });

  function cleanup() {
    clearInterval(titleTimer);
    try {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
    } catch {
    }
  }

  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (data) => term.write(data.toString("utf8")));

  process.stdout.on("resize", () => {
    try {
      term.resize(process.stdout.columns || 120, process.stdout.rows || 36);
    } catch {
    }
  });

  const seen = new Set();
  let injecting = false;
  const startedAtMs = Date.now();
  const initialInjectDelayMs = Number(options["initial-inject-delay"] || process.env.CODEX_MANAGED_INITIAL_INJECT_DELAY_MS || 5000);
  setInterval(() => heartbeat("running"), 3000);
  setInterval(async () => {
    if (injecting) return;
    if (Date.now() - startedAtMs < Math.max(0, initialInjectDelayMs)) return;
    injecting = true;
    const messages = readBridgeMessages(thread.id, 200)
      .filter((message) => !seen.has(message.id))
      .filter((message) => message.status === "queued")
      .filter((message) => ["inject", "managed", "auto"].includes(String(message.mode || "").toLowerCase()))
      .filter((message) => !message.to_agent || message.to_agent === agentName || message.to_thread_id === thread.id);

    try {
      for (const message of messages) {
        seen.add(message.id);
        updateBridgeMessageStatus(message.id, "injecting");
        await writePromptToPty(term, promptForMessage(message, agentName, thread.id));
        updateBridgeMessageStatus(message.id, "injected");
        writeBridgeEvent({ type: "managed_inject", session_id: sessionId, agent: agentName, thread_id: thread.id, message_id: message.id });
        await sleep(100);
      }
    } finally {
      injecting = false;
    }
  }, 700);

  process.on("SIGINT", () => {
    cleanup();
    try {
      term.kill();
    } catch {
    }
    removeManagedSession(sessionId);
    process.exit(0);
  });
}

function selfTestCommand() {
  const shell = process.env.ComSpec || "cmd.exe";
  const term = pty.spawn(shell, ["/d", "/s", "/c", "echo PTY_SELF_TEST_OK"], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: process.env,
  });
  let output = "";
  term.onData((data) => {
    output += data;
  });
  term.onExit(() => {
    if (output.includes("PTY_SELF_TEST_OK")) {
      console.log("PTY_SELF_TEST_OK");
      process.exit(0);
    }
    console.error(output || "PTY self-test produced no output.");
    process.exit(1);
  });
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const options = parseArgs(rest);
  switch (String(command || "help").toLowerCase()) {
    case "help":
    case "--help":
    case "-h":
      usage();
      break;
    case "start":
      startCommand(options);
      break;
    case "list":
    case "status":
      listCommand(options);
      break;
    case "self-test":
      selfTestCommand();
      break;
    default:
      usage();
      fail(`Unknown command: ${command || ""}`);
  }
}

main();
