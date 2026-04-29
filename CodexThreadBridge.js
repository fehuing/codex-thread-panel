#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const {
  PERMISSION_MODES,
  bridgeHome,
  checkBridgeSendAllowed,
  clearBridgeMessages,
  defaultAgentName,
  findBridgeAgentByThread,
  listBridgeAgents,
  openThread,
  readBridgeLaunches,
  readBridgeMessages,
  readBridgeRules,
  readBridgeStats,
  readManagedSessions,
  readThreads,
  removeBridgeAgent,
  resolveBridgeAgent,
  startManagedThread,
  updateBridgeMessageStatus,
  upsertBridgeAgent,
  writeBridgeMessage,
  writeBridgeRules,
} = require("./CodexThreadPanelTui.js");

function usage() {
  console.log(`Codex Thread Bridge

Usage:
  node CodexThreadBridge.js list [--query TEXT] [--all] [--limit N] [--json]
  node CodexThreadBridge.js resolve --query TEXT [--json]
  node CodexThreadBridge.js send --to AGENT --prompt TEXT [--permission 2] [--mode inject]
  node CodexThreadBridge.js send --to AGENT --prompt TEXT --mode auto [--reply-to AGENT] [--require-reply]
  node CodexThreadBridge.js send --thread-id ID --prompt TEXT [--permission 2] [--mode launch]
  node CodexThreadBridge.js send --query TEXT --prompt-file prompt.txt [--mode launch|queue|inject|auto]
  node CodexThreadBridge.js inbox [--thread-id ID] [--json]
  node CodexThreadBridge.js mark --message-id ID --status done
  node CodexThreadBridge.js clear [--thread-id ID] [--status queued]
  node CodexThreadBridge.js agent list [--json]
  node CodexThreadBridge.js agent set --name AGENT --thread-id ID
  node CodexThreadBridge.js agent remove --name AGENT
  node CodexThreadBridge.js rules show [--json]
  node CodexThreadBridge.js rules set --default-allow true|false --block-self true|false
  node CodexThreadBridge.js managed list [--all] [--json]
  node CodexThreadBridge.js registry [--json]
  node CodexThreadBridge.js stats [--json]

Permission modes:
  1 Safe, 2 Normal, 3 Auto, 4 Full

Notes:
  launch opens a new Codex window. queue only records the message.
  inject writes to a running managed PTY session started with CodexManagedSession.js.
  auto injects if the managed session is online, otherwise it starts one and queues the prompt.
`);
}

function parseArgs(argv) {
  const aliases = {
    a: "all",
    f: "prompt-file",
    j: "json",
    m: "mode",
    p: "prompt",
    q: "query",
    t: "thread-id",
    n: "name",
  };
  const options = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const raw = arg.slice(2);
      const eq = raw.indexOf("=");
      const key = eq >= 0 ? raw.slice(0, eq) : raw;
      if (eq >= 0) {
        options[key] = raw.slice(eq + 1);
      } else if (argv[i + 1] && !argv[i + 1].startsWith("-")) {
        options[key] = argv[++i];
      } else {
        options[key] = true;
      }
    } else if (arg.startsWith("-") && arg.length > 1) {
      const key = aliases[arg.slice(1)] || arg.slice(1);
      if (argv[i + 1] && !argv[i + 1].startsWith("-")) {
        options[key] = argv[++i];
      } else {
        options[key] = true;
      }
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

function truncate(value, length) {
  const text = String(value || "").replace(/[\r\n\t]+/g, " ").trim();
  return text.length > length ? `${text.slice(0, Math.max(0, length - 3))}...` : text;
}

function normalizePermission(value) {
  const input = String(value || "2").trim().toLowerCase();
  if (PERMISSION_MODES[input]) return PERMISSION_MODES[input];
  for (const mode of Object.values(PERMISSION_MODES)) {
    if (mode.name.toLowerCase() === input || mode.label.toLowerCase() === input) return mode;
  }
  fail(`Unknown permission mode: ${value}`);
}

function filterThreads(threads, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return threads;
  return threads.filter((thread) => {
    const haystack = `${thread.id}\n${thread.title}\n${thread.project}\n${thread.cwd}`.toLowerCase();
    return haystack.includes(q);
  });
}

function resolveThread(options) {
  const threads = readThreads();
  const to = String(options.to || options.agent || "").trim();
  if (to) {
    const agent = resolveBridgeAgent(to);
    if (!agent) fail(`Agent not found: ${to}`);
    const thread = threads.find((item) => item.id === agent.thread_id);
    return thread || {
      id: agent.thread_id,
      title: agent.title || agent.name,
      cwd: agent.cwd || "",
      project: agent.project || "",
      archived: false,
      updatedText: "",
      model: "",
      tokensUsed: 0,
      agent: agent.name,
    };
  }
  const id = String(options["thread-id"] || options.id || "").trim();
  if (id) {
    const exact = threads.find((thread) => thread.id === id);
    if (exact) return exact;
    const prefixed = threads.filter((thread) => thread.id.startsWith(id));
    if (prefixed.length === 1) return prefixed[0];
    if (prefixed.length > 1) fail(`Thread id prefix is ambiguous: ${id}`);
    fail(`Thread id not found: ${id}`);
  }

  const query = String(options.query || "").trim();
  if (!query) fail("Missing --thread-id or --query.");
  const matches = filterThreads(threads, query);
  if (!matches.length) fail(`No thread matched query: ${query}`);
  return matches[0];
}

function readPrompt(options) {
  if (options["prompt-file"]) {
    return fs.readFileSync(path.resolve(String(options["prompt-file"])), "utf8").replace(/^\uFEFF/, "");
  }
  if (options.stdin) {
    return fs.readFileSync(0, "utf8").replace(/^\uFEFF/, "");
  }
  if (options.prompt !== undefined && options.prompt !== true) {
    return String(options.prompt);
  }
  fail("Missing prompt. Use --prompt TEXT, --prompt-file FILE, or --stdin.");
}

function printThread(thread, json) {
  if (json) {
    console.log(JSON.stringify(thread, null, 2));
    return;
  }
  console.log(`Thread: ${thread.id}`);
  console.log(`Title:  ${thread.title}`);
  console.log(`Project:${thread.project}`);
  console.log(`Path:   ${thread.cwd || "-"}`);
  if (thread.agent) console.log(`Agent:  ${thread.agent}`);
}

function listCommand(options) {
  const includeArchived = Boolean(options.all || options.archived);
  const limit = Number(options.limit || 0);
  let threads = filterThreads(readThreads(), options.query)
    .filter((thread) => includeArchived || !thread.archived);
  if (limit > 0) threads = threads.slice(0, limit);

  if (options.json) {
    console.log(JSON.stringify(threads, null, 2));
    return;
  }

  for (const thread of threads) {
    const archived = thread.archived ? "A" : " ";
    const agent = findBridgeAgentByThread(thread.id)?.name || "-";
    console.log(`${archived} ${thread.id}  ${truncate(agent, 18).padEnd(18)}  ${truncate(thread.project, 18).padEnd(18)}  ${truncate(thread.title, 60)}`);
  }
}

function resolveCommand(options) {
  printThread(resolveThread(options), Boolean(options.json));
}

function findOnlineManagedSession(thread, agentName = "") {
  const targetAgent = String(agentName || "").trim().toLowerCase();
  return readManagedSessions(false).find((session) => {
    const sameThread = thread?.id && session.thread_id === thread.id;
    const sameAgent = targetAgent && String(session.agent || "").toLowerCase() === targetAgent;
    return sameThread || sameAgent;
  }) || null;
}

function booleanOption(options, name, fallback = false) {
  if (options[name] === true) return true;
  return parseBoolean(options[name], fallback);
}

function sendCommand(options) {
  const thread = resolveThread(options);
  const prompt = readPrompt(options);
  const mode = String(options.mode || "launch").toLowerCase();
  if (!["launch", "queue", "inject", "managed", "auto"].includes(mode)) fail(`Unknown mode: ${mode}`);

  let launched = false;
  let autoStarted = false;
  let managedOnline = false;
  let effectiveMode = mode;
  const permission = normalizePermission(options.permission || options["permission-mode"] || "2");
  const from = options.from || "bridge";
  const explicitAgent = options.to ? resolveBridgeAgent(options.to) : null;
  const existingAgent = explicitAgent || findBridgeAgentByThread(thread.id);
  const toAgent = existingAgent?.name || (mode === "auto" ? defaultAgentName(thread) : "");
  const requireReply = booleanOption(options, "require-reply", false);
  const replyToOption = options["reply-to"] || options.replyTo || options.reply || "";
  const genericFrom = ["", "manual", "bridge", "panel"].includes(String(from || "").trim().toLowerCase());
  const replyToFallback = requireReply && !replyToOption && !genericFrom ? from : "";
  const replyTo = replyToOption && replyToOption !== true ? String(replyToOption) : replyToFallback;
  if (requireReply && !replyTo) fail("Missing --reply-to for --require-reply.");
  const decision = checkBridgeSendAllowed({ from, to: toAgent || thread.id, prompt });
  if (!decision.allowed) fail(`Bridge send blocked: ${decision.reason}`);

  if (mode === "auto") {
    upsertBridgeAgent(toAgent || defaultAgentName(thread), thread, from || "bridge-auto");
    const session = findOnlineManagedSession(thread, toAgent);
    managedOnline = Boolean(session);
    if (!session) {
      autoStarted = startManagedThread(thread, permission, toAgent, "bridge-auto");
    }
    effectiveMode = "inject";
  }

  if (mode === "launch") {
    launched = openThread(thread, permission, prompt, from, toAgent);
  }
  const status = effectiveMode === "queue" || effectiveMode === "inject" || effectiveMode === "managed"
    ? "queued"
    : launched ? "launched" : "launch_failed";

  const message = writeBridgeMessage({
    from,
    fromAgent: from,
    toAgent,
    toThreadId: thread.id,
    toTitle: thread.title,
    cwd: thread.cwd,
    mode: effectiveMode,
    status,
    replyTo,
    requireReply,
    prompt,
  });

  const result = {
    ok: mode === "queue" || mode === "inject" || mode === "managed" || launched || managedOnline || autoStarted,
    message_id: message.id,
    status: message.status,
    thread_id: thread.id,
    to_agent: toAgent || "",
    title: thread.title,
    mode,
    effective_mode: effectiveMode,
    managed_online: managedOnline,
    auto_started: autoStarted,
    reply_to: message.reply_to || "",
    require_reply: Boolean(message.require_reply),
    bridge_home: bridgeHome(),
  };

  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Status: ${result.status}`);
    console.log(`Message: ${result.message_id}`);
    console.log(`Thread: ${result.thread_id}`);
    if (result.to_agent) console.log(`Agent: ${result.to_agent}`);
    console.log(`Title: ${result.title}`);
    if (mode === "auto") console.log(`Managed: ${managedOnline ? "online" : autoStarted ? "started" : "start_failed"}`);
    if (result.reply_to) console.log(`ReplyTo: ${result.reply_to}`);
  }

  if (!result.ok) process.exit(1);
}

function inboxCommand(options) {
  const threadId = options["thread-id"] || options.id || "";
  const messages = readBridgeMessages(threadId, Number(options.limit || 50));
  if (options.json) {
    console.log(JSON.stringify(messages, null, 2));
    return;
  }
  for (const message of messages) {
    console.log(`${message.created_at} ${message.status} ${message.to_thread_id} ${truncate(message.prompt, 90)}`);
  }
}

function registryCommand(options) {
  const launches = readBridgeLaunches(Number(options.limit || 50));
  if (options.json) {
    console.log(JSON.stringify(launches, null, 2));
    return;
  }
  for (const launch of launches) {
    console.log(`${launch.created_at} ${launch.kind} ${launch.thread_id || "-"} ${truncate(launch.launch_title, 80)}`);
  }
}

function statsCommand(options) {
  const stats = readBridgeStats();
  if (options.json) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }
  console.log(`BridgeHome: ${stats.home}`);
  console.log(`Agents: ${stats.agentCount}`);
  console.log(`Messages: ${stats.messageCount}`);
  console.log(`Queued: ${stats.queuedCount}`);
  console.log(`Launches: ${stats.launchCount}`);
  if (stats.lastMessage) console.log(`LastMessage: ${stats.lastMessage.status} -> ${stats.lastMessage.to_thread_id}`);
  if (stats.lastLaunch) console.log(`LastLaunch: ${stats.lastLaunch.kind} -> ${stats.lastLaunch.thread_id || stats.lastLaunch.cwd || "-"}`);
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === true) return fallback;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "allow"].includes(text)) return true;
  if (["0", "false", "no", "off", "deny", "block"].includes(text)) return false;
  return fallback;
}

function agentCommand(options) {
  const subcommand = String(options._[0] || "list").toLowerCase();
  if (subcommand === "list") {
    const agents = listBridgeAgents();
    if (options.json) {
      console.log(JSON.stringify(agents, null, 2));
      return;
    }
    for (const agent of agents) {
      console.log(`${agent.name.padEnd(24)} ${agent.thread_id}  ${truncate(agent.project, 18).padEnd(18)} ${truncate(agent.title, 60)}`);
    }
    return;
  }

  if (subcommand === "show") {
    const agent = resolveBridgeAgent(options.name || options.to || options._[1]);
    if (!agent) fail(`Agent not found: ${options.name || options.to || options._[1] || ""}`);
    if (options.json) console.log(JSON.stringify(agent, null, 2));
    else {
      console.log(`Agent: ${agent.name}`);
      console.log(`Thread: ${agent.thread_id}`);
      console.log(`Title: ${agent.title || "-"}`);
      console.log(`Project: ${agent.project || "-"}`);
      console.log(`Path: ${agent.cwd || "-"}`);
    }
    return;
  }

  if (subcommand === "set") {
    const thread = resolveThread(options);
    const name = options.name || defaultAgentName(thread);
    const agent = upsertBridgeAgent(name, thread, options.from || "bridge");
    if (options.json) console.log(JSON.stringify(agent, null, 2));
    else console.log(`Agent set: ${agent.name} -> ${agent.thread_id}`);
    return;
  }

  if (subcommand === "remove" || subcommand === "rm") {
    const name = options.name || options._[1];
    if (!name) fail("Missing --name.");
    const ok = removeBridgeAgent(name);
    if (options.json) console.log(JSON.stringify({ ok, name }, null, 2));
    else console.log(ok ? `Agent removed: ${name}` : `Agent not found: ${name}`);
    if (!ok) process.exit(1);
    return;
  }

  fail(`Unknown agent command: ${subcommand}`);
}

function rulesCommand(options) {
  const subcommand = String(options._[0] || "show").toLowerCase();
  const rules = readBridgeRules();
  if (subcommand === "show") {
    if (options.json) console.log(JSON.stringify(rules, null, 2));
    else {
      console.log(`default_allow: ${rules.default_allow}`);
      console.log(`block_self_send: ${rules.block_self_send}`);
      console.log(`max_prompt_chars: ${rules.max_prompt_chars}`);
      console.log(`allowed: ${rules.allowed.length}`);
      console.log(`blocked: ${rules.blocked.length}`);
    }
    return;
  }

  if (subcommand === "set") {
    const next = { ...rules };
    if (options["default-allow"] !== undefined) next.default_allow = parseBoolean(options["default-allow"], next.default_allow);
    if (options["block-self"] !== undefined) next.block_self_send = parseBoolean(options["block-self"], next.block_self_send);
    if (options["max-prompt-chars"] !== undefined) next.max_prompt_chars = Number(options["max-prompt-chars"]) || next.max_prompt_chars;
    const saved = writeBridgeRules(next);
    if (options.json) console.log(JSON.stringify(saved, null, 2));
    else console.log("Rules updated.");
    return;
  }

  if (subcommand === "allow" || subcommand === "block") {
    const pair = { from: options.from || "*", to: options.to || "*" };
    const listName = subcommand === "allow" ? "allowed" : "blocked";
    const next = { ...rules, [listName]: [...rules[listName], pair] };
    const saved = writeBridgeRules(next);
    if (options.json) console.log(JSON.stringify(saved, null, 2));
    else console.log(`Rule added to ${listName}: ${pair.from} -> ${pair.to}`);
    return;
  }

  if (subcommand === "clear") {
    const listName = String(options.list || "blocked").toLowerCase();
    if (!["allowed", "blocked"].includes(listName)) fail("Use --list allowed or --list blocked.");
    const next = { ...rules, [listName]: [] };
    const saved = writeBridgeRules(next);
    if (options.json) console.log(JSON.stringify(saved, null, 2));
    else console.log(`Rules cleared: ${listName}`);
    return;
  }

  fail(`Unknown rules command: ${subcommand}`);
}

function markCommand(options) {
  const messageId = options["message-id"] || options.id || options._[0];
  const status = options.status || options._[1] || "done";
  if (!messageId) fail("Missing --message-id.");
  const message = updateBridgeMessageStatus(messageId, status);
  if (options.json) console.log(JSON.stringify({ ok: Boolean(message), message }, null, 2));
  else console.log(message ? `Message marked: ${message.id} -> ${message.status}` : `Message not found: ${messageId}`);
  if (!message) process.exit(1);
}

function clearCommand(options) {
  if (!options.all && !options["thread-id"] && !options.id && !options.status) {
    fail("Refusing to clear every message without --all, --thread-id, or --status.");
  }
  const removed = clearBridgeMessages(options["thread-id"] || options.id || "", options.status || "");
  if (options.json) console.log(JSON.stringify({ removed }, null, 2));
  else console.log(`Messages removed: ${removed}`);
}

function managedCommand(options) {
  const subcommand = String(options._[0] || "list").toLowerCase();
  if (subcommand !== "list" && subcommand !== "status") fail(`Unknown managed command: ${subcommand}`);
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

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const options = parseArgs(rest);
  switch (String(command || "help").toLowerCase()) {
    case "help":
    case "--help":
    case "-h":
      usage();
      break;
    case "list":
      listCommand(options);
      break;
    case "resolve":
      resolveCommand(options);
      break;
    case "send":
      sendCommand(options);
      break;
    case "agent":
    case "agents":
      agentCommand(options);
      break;
    case "rules":
      rulesCommand(options);
      break;
    case "managed":
      managedCommand(options);
      break;
    case "inbox":
      inboxCommand(options);
      break;
    case "mark":
      markCommand(options);
      break;
    case "clear":
      clearCommand(options);
      break;
    case "registry":
      registryCommand(options);
      break;
    case "stats":
      statsCommand(options);
      break;
    default:
      usage();
      fail(`Unknown command: ${command || ""}`);
  }
}

main();
