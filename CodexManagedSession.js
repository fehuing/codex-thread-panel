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
  node CodexManagedSession.js start --thread-id ID --agent AGENT [--permission Normal]
  node CodexManagedSession.js start --to AGENT [--permission Normal]
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writePromptToPty(term, prompt) {
  const text = plainInjectText(prompt);
  if (!text.trim()) return;
  const submitDelayMs = Number(process.env.CODEX_MANAGED_SUBMIT_DELAY_MS || 200);
  term.write(`\x1b[200~${text}\x1b[201~`);
  await sleep(Math.max(25, submitDelayMs));
  term.write("\r");
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
  const args = ["resume", ...permissionArgs(mode), thread.id];
  if (options.prompt && options.prompt !== true) args.push(String(options.prompt));

  process.title = `Codex Managed - ${agentName}`;
  console.log(`Managed agent: ${agentName}`);
  console.log(`Thread: ${thread.id}`);
  console.log(`Mode: ${mode.name}`);
  console.log("Injection: send --to " + agentName + " --mode inject");
  const spawnSpec = buildCodexSpawn(args);
  console.log(`Command: ${spawnSpec.display}`);
  console.log("");

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

  term.onData((data) => process.stdout.write(data));
  term.onExit(({ exitCode, signal }) => {
    heartbeat("stopped");
    removeManagedSession(sessionId);
    writeBridgeEvent({ type: "managed_exit", session_id: sessionId, agent: agentName, thread_id: thread.id, exit_code: exitCode, signal: signal || "" });
    cleanup();
    process.exit(exitCode || 0);
  });

  function cleanup() {
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
  setInterval(() => heartbeat("running"), 3000);
  setInterval(async () => {
    if (injecting) return;
    injecting = true;
    const messages = readBridgeMessages(thread.id, 200)
      .filter((message) => !seen.has(message.id))
      .filter((message) => message.status === "queued")
      .filter((message) => ["inject", "managed"].includes(String(message.mode || "").toLowerCase()))
      .filter((message) => !message.to_agent || message.to_agent === agentName || message.to_thread_id === thread.id);

    try {
      for (const message of messages) {
        seen.add(message.id);
        updateBridgeMessageStatus(message.id, "injecting");
        await writePromptToPty(term, message.prompt);
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
