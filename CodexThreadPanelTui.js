#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const RESET = "\x1b[0m";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const ALT_SCREEN = "\x1b[?1049h";
const MAIN_SCREEN = "\x1b[?1049l";
const DISABLE_MOUSE_INPUT = "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1015l";

const COLORS = {
  gray: "\x1b[38;5;250m",
  dark: "\x1b[38;5;245m",
  dim: "\x1b[38;5;240m",
  white: "\x1b[38;5;255m",
  cyan: "\x1b[38;5;81m",
  yellow: "\x1b[38;5;221m",
  green: "\x1b[38;5;114m",
  red: "\x1b[38;5;203m",
  selected: "\x1b[38;5;16;48;5;250m",
};

function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function normalizeCodexPath(value) {
  if (!value) return "";
  let text = String(value);
  if (text.startsWith("\\\\?\\UNC\\")) return `\\\\${text.slice(8)}`;
  if (text.startsWith("\\\\?\\")) return text.slice(4);
  return text;
}

function singleLine(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function displayLine(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[\r\n\t]+/g, " ");
}

function isRolloutName(value) {
  return /^rollout-\d{4}-\d{2}-\d{2}T/i.test(singleLine(value));
}

function isMojibakeTitle(value) {
  const text = singleLine(value);
  return /^\?{3,}$/.test(text) || text.includes("\uFFFD");
}

function displayWidth(value) {
  let width = 0;
  for (const ch of String(value || "")) {
    const code = ch.codePointAt(0);
    width += code > 0x7f ? 2 : 1;
  }
  return width;
}

function truncate(value, maxWidth) {
  const text = displayLine(value);
  if (maxWidth < 4) return "";
  if (displayWidth(text) <= maxWidth) return text;
  let width = 0;
  let out = "";
  const target = maxWidth - 3;
  for (const ch of text) {
    const charWidth = ch.codePointAt(0) > 0x7f ? 2 : 1;
    if (width + charWidth > target) break;
    out += ch;
    width += charWidth;
  }
  return `${out}...`;
}

function pad(value, width) {
  const text = truncate(value, width);
  const current = displayWidth(text);
  return current < width ? text + " ".repeat(width - current) : text;
}

function style(value, color) {
  return `${color || ""}${value}${RESET}`;
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function toDate(value) {
  if (!value && value !== 0) return null;
  try {
    if (typeof value === "number" || /^\d+$/.test(String(value))) {
      const n = Number(value);
      return new Date(n > 999999999999 ? n : n * 1000);
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function formatDate(value, withSeconds = false) {
  const d = value instanceof Date ? value : toDate(value);
  if (!d) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return withSeconds ? `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}` : `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function projectName(cwd) {
  const normalized = normalizeCodexPath(cwd);
  if (!normalized) return "(unknown project)";
  const trimmed = normalized.replace(/[\\/]+$/, "");
  return path.basename(trimmed) || normalized;
}

function walkFiles(root, suffix = ".jsonl") {
  const files = [];
  if (!fs.existsSync(root)) return files;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith(suffix)) {
        try {
          const stat = fs.statSync(full);
          files.push({ path: full, mtimeMs: stat.mtimeMs, size: stat.size });
        } catch {
          files.push({ path: full, mtimeMs: 0, size: 0 });
        }
      }
    }
  }
  return files;
}

function runSqliteJson(dbPath, query) {
  try {
    const output = cp.execFileSync("sqlite3", ["-json", dbPath, query], {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (!output.trim()) return [];
    return JSON.parse(output);
  } catch {
    return [];
  }
}

function runSqliteExec(dbPath, query) {
  try {
    cp.execFileSync("sqlite3", [dbPath], {
      input: query,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

function sqliteLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function chooseTitle(...values) {
  for (const value of values) {
    const text = singleLine(value);
    if (!text) continue;
    if (isRolloutName(text)) continue;
    if (isMojibakeTitle(text)) continue;
    return text;
  }
  return "Untitled thread";
}

function extractTextFromContent(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part) return "";
        if (typeof part === "string") return part;
        return part.text || part.input_text || part.output_text || "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return content.text || content.input_text || "";
}

function scanSessionFile(filePath) {
  let text = "";
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  const result = {
    id: "",
    cwd: "",
    timestamp: null,
    archived: filePath.toLowerCase().includes(`${path.sep}archived_sessions${path.sep}`),
    sourceFile: filePath,
    model: "",
    firstUserMessage: "",
  };

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length && i < 800; i++) {
    const line = lines[i];
    if (!line) continue;
    const obj = parseJsonLine(line);
    if (!obj) continue;

    if (obj.type === "session_meta" && obj.payload) {
      result.id = obj.payload.id || result.id;
      result.cwd = normalizeCodexPath(obj.payload.cwd || result.cwd);
      result.timestamp = toDate(obj.payload.timestamp) || result.timestamp;
      result.model = obj.payload.model || result.model;
    }

    if (!result.firstUserMessage && obj.type === "response_item" && obj.payload) {
      const payload = obj.payload;
      if (payload.type === "message" && payload.role === "user") {
        result.firstUserMessage = extractTextFromContent(payload.content);
      }
    }

    if (result.id && result.firstUserMessage) break;
  }

  return result.id ? result : null;
}

function readSessionIndex(home) {
  const indexPath = path.join(home, "session_index.jsonl");
  const byId = new Map();
  if (!fs.existsSync(indexPath)) return byId;
  try {
    const lines = fs.readFileSync(indexPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      const obj = parseJsonLine(line);
      if (!obj || !obj.id) continue;
      byId.set(obj.id, {
        id: obj.id,
        title: obj.thread_name || "",
        updated: toDate(obj.updated_at),
      });
    }
  } catch {
  }
  return byId;
}

function readTitleOverrides(home) {
  const filePath = path.join(home, "thread_title_overrides.json");
  const map = new Map();
  if (!fs.existsSync(filePath)) return map;
  try {
    const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    const data = JSON.parse(raw);
    for (const [id, title] of Object.entries(data || {})) {
      if (id && title) map.set(id, String(title));
    }
  } catch {
  }
  return map;
}

function rewriteSessionIndexTitle(id, title) {
  const indexPath = path.join(codexHome(), "session_index.jsonl");
  if (!fs.existsSync(indexPath)) return false;
  try {
    const lines = fs.readFileSync(indexPath, "utf8").split(/\r?\n/);
    let changed = false;
    const next = lines
      .filter((line) => line.trim())
      .map((line) => {
        const obj = parseJsonLine(line);
        if (!obj || obj.id !== id) return line;
        obj.thread_name = title;
        changed = true;
        return JSON.stringify(obj);
      });
    if (!changed) return false;
    fs.copyFileSync(indexPath, `${indexPath}.bak-${Date.now()}`);
    fs.writeFileSync(indexPath, `${next.join("\n")}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

function archiveThread(thread) {
  if (!thread?.id) return false;
  const dbPath = path.join(codexHome(), "state_5.sqlite");
  if (!fs.existsSync(dbPath)) return false;
  const now = Math.floor(Date.now() / 1000);
  return runSqliteExec(
    dbPath,
    `update threads set archived=1, archived_at=${now} where id=${sqliteLiteral(thread.id)};`,
  );
}

function renameThread(thread, title) {
  const nextTitle = singleLine(title);
  if (!thread?.id || !nextTitle) return false;
  return rewriteSessionIndexTitle(thread.id, nextTitle);
}

function readSqliteThreads(home) {
  const dbPath = path.join(home, "state_5.sqlite");
  if (!fs.existsSync(dbPath)) return new Map();
  const rows = runSqliteJson(
    dbPath,
    `select id, title, cwd, archived, rollout_path, tokens_used, model, reasoning_effort,
            updated_at_ms, updated_at, first_user_message
       from threads
      order by coalesce(updated_at_ms, updated_at * 1000) desc, id desc;`,
  );
  const byId = new Map();
  for (const row of rows) {
    if (!row.id) continue;
    byId.set(row.id, {
      id: row.id,
      title: row.title || "",
      cwd: normalizeCodexPath(row.cwd || ""),
      archived: Boolean(row.archived),
      sourceFile: row.rollout_path || "",
      tokensUsed: Number(row.tokens_used || 0),
      model: row.model || "",
      reasoningEffort: row.reasoning_effort || "",
      updated: toDate(row.updated_at_ms || row.updated_at),
      firstUserMessage: row.first_user_message || "",
      source: "sqlite",
    });
  }
  return byId;
}

function readThreads() {
  const home = codexHome();
  const byId = readSqliteThreads(home);
  const index = readSessionIndex(home);
  const titleOverrides = readTitleOverrides(home);
  const sessionRoots = [path.join(home, "sessions"), path.join(home, "archived_sessions")];
  const sessionFiles = sessionRoots.flatMap((root) => walkFiles(root));

  const metaById = new Map();
  for (const file of sessionFiles) {
    const meta = scanSessionFile(file.path);
    if (!meta) continue;
    const existing = metaById.get(meta.id);
    if (!existing || ((meta.timestamp || 0) > (existing.timestamp || 0))) {
      metaById.set(meta.id, meta);
    }
  }

  for (const [id, item] of index) {
    const current = byId.get(id);
    const meta = metaById.get(id);
    if (current) {
      current.indexTitle = item.title;
      if (item.updated) current.updated = item.updated;
      if (meta) {
        current.cwd ||= meta.cwd;
        current.sourceFile ||= meta.sourceFile;
        current.firstUserMessage ||= meta.firstUserMessage;
        current.model ||= meta.model;
      }
    } else {
      byId.set(id, {
        id,
        title: item.title || "",
        indexTitle: item.title || "",
        cwd: meta ? meta.cwd : "",
        archived: meta ? meta.archived : false,
        sourceFile: meta ? meta.sourceFile : "",
        tokensUsed: 0,
        model: meta ? meta.model : "",
        reasoningEffort: "",
        updated: item.updated || (meta ? meta.timestamp : null),
        firstUserMessage: meta ? meta.firstUserMessage : "",
        source: "index",
      });
    }
  }

  for (const [id, meta] of metaById) {
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      title: "",
      indexTitle: "",
      cwd: meta.cwd || "",
      archived: meta.archived,
      sourceFile: meta.sourceFile,
      tokensUsed: 0,
      model: meta.model || "",
      reasoningEffort: "",
      updated: meta.timestamp,
      firstUserMessage: meta.firstUserMessage || "",
      source: "session",
    });
  }

  return Array.from(byId.values())
    .map((item) => {
      const title = chooseTitle(titleOverrides.get(item.id), item.indexTitle, item.title, item.firstUserMessage);
      return {
        id: item.id,
        title,
        cwd: normalizeCodexPath(item.cwd || ""),
        project: projectName(item.cwd || ""),
        archived: Boolean(item.archived),
        sourceFile: item.sourceFile || "",
        tokensUsed: Number(item.tokensUsed || 0),
        model: item.model || "",
        reasoningEffort: item.reasoningEffort || "",
        updated: item.updated || null,
        updatedText: formatDate(item.updated),
        firstUserMessage: item.firstUserMessage || "",
      };
    })
    .sort((a, b) => (b.updated?.getTime() || 0) - (a.updated?.getTime() || 0));
}

function findLatestRateLine(filePath) {
  let text = "";
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const needle = '"rate_limits"';
  const index = text.lastIndexOf(needle);
  if (index < 0) return null;
  const start = text.lastIndexOf("\n", index);
  const end = text.indexOf("\n", index);
  return text.slice(start < 0 ? 0 : start + 1, end < 0 ? text.length : end);
}

function readLatestQuota(maxFiles = 20) {
  const home = codexHome();
  const files = [
    ...walkFiles(path.join(home, "sessions")),
    ...walkFiles(path.join(home, "archived_sessions")),
  ].sort((a, b) => b.mtimeMs - a.mtimeMs);

  const candidates = files.slice(0, maxFiles);
  if (candidates.length === 0) return null;
  let latest = null;
  for (const file of candidates) {
    const line = findLatestRateLine(file.path);
    if (!line) continue;
    const obj = parseJsonLine(line);
    const rate = obj?.payload?.rate_limits;
    if (!rate) continue;
    const timestamp = toDate(obj.timestamp);
    if (!latest || (timestamp?.getTime() || 0) > (latest.timestamp?.getTime() || 0)) {
      latest = { timestamp, rate, file: file.path };
    }
  }

  if (!latest && maxFiles < files.length) return readLatestQuota(files.length);
  return latest;
}

function safePercent(value) {
  const number = Number(value || 0);
  return Math.max(0, Math.min(100, Math.round(number)));
}

function remainingPercent(value) {
  return Math.max(0, Math.min(100, 100 - safePercent(value)));
}

function quotaName(minutes) {
  const n = Number(minutes || 0);
  if (n === 300) return "5h limit";
  if (n === 10080) return "weekly limit";
  return `${n}m limit`;
}

function resetInfo(epochSeconds) {
  if (!epochSeconds) return "reset unknown";
  const reset = new Date(Number(epochSeconds) * 1000);
  const diff = reset.getTime() - Date.now();
  if (diff <= 0) return `reset reached (${formatDate(reset).slice(11)})`;
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `resets in ${days}d ${hours}h (${formatDate(reset).slice(5)})`;
  if (hours > 0) return `resets in ${hours}h ${minutes}m (${formatDate(reset).slice(11)})`;
  return `resets in ${minutes}m ${seconds}s (${formatDate(reset).slice(11)})`;
}

function groupProjects(threads, includeArchived, search) {
  const query = singleLine(search).toLowerCase();
  const filtered = threads.filter((thread) => {
    if (!includeArchived && thread.archived) return false;
    if (!query) return true;
    const haystack = `${thread.title}\n${thread.cwd}\n${thread.id}\n${thread.model}\n${thread.project}`.toLowerCase();
    return haystack.includes(query);
  });
  const map = new Map();
  for (const thread of filtered) {
    const key = thread.cwd || "(unknown)";
    if (!map.has(key)) {
      map.set(key, {
        cwd: thread.cwd,
        name: projectName(thread.cwd),
        threads: [],
        latest: null,
      });
    }
    const group = map.get(key);
    group.threads.push(thread);
    if (!group.latest || (thread.updated?.getTime() || 0) > (group.latest?.getTime() || 0)) {
      group.latest = thread.updated;
    }
  }
  return Array.from(map.values())
    .map((group) => {
      group.threads.sort((a, b) => (b.updated?.getTime() || 0) - (a.updated?.getTime() || 0));
      return group;
    })
    .sort((a, b) => (b.latest?.getTime() || 0) - (a.latest?.getTime() || 0) || a.name.localeCompare(b.name));
}

function buildNodes(threads, expanded, includeArchived, search) {
  const nodes = [];
  for (const project of groupProjects(threads, includeArchived, search)) {
    const isExpanded = expanded.has(project.cwd);
    nodes.push({ type: "project", project, cwd: project.cwd, expanded: isExpanded });
    if (isExpanded) {
      for (const thread of project.threads) {
        nodes.push({ type: "thread", project, thread, cwd: project.cwd });
      }
    }
  }
  return nodes;
}

function panel(width, height, title, contentLines) {
  if (width < 4 || height < 3) return Array.from({ length: height }, () => " ".repeat(Math.max(0, width)));
  const lines = [];
  const border = `+${"-".repeat(width - 2)}+`;
  lines.push(style(border, COLORS.dim));
  const maxContent = height - 2;
  for (let i = 0; i < maxContent; i++) {
    const item = contentLines[i] || { text: "", color: COLORS.gray };
    const text = typeof item === "string" ? item : item.text;
    const color = typeof item === "string" ? COLORS.gray : item.color;
    const selected = typeof item === "object" && item.selected;
    const body = pad(text, width - 2);
    lines.push(`${style("|", COLORS.dim)}${selected ? style(body, COLORS.selected) : style(body, color || COLORS.gray)}${style("|", COLORS.dim)}`);
  }
  lines.push(style(border, COLORS.dim));
  if (title) {
    const label = ` ${truncate(title, width - 4)} `;
    lines[0] = `${style("+", COLORS.dim)}${style(label, COLORS.white)}${style("-".repeat(Math.max(0, width - 2 - displayWidth(label))), COLORS.dim)}${style("+", COLORS.dim)}`;
  }
  return lines;
}

function selectedNode(nodes, index) {
  return nodes.length && index >= 0 && index < nodes.length ? nodes[index] : null;
}

function detailLines(node) {
  if (!node) return [{ text: "No selection.", color: COLORS.yellow }];
  if (node.type === "project") {
    const p = node.project;
    return [
      { text: "Type: project", color: COLORS.dark },
      { text: `Name: ${p.name}`, color: COLORS.white },
      { text: `Threads: ${p.threads.length}`, color: COLORS.gray },
      { text: `State: ${node.expanded ? "expanded" : "collapsed"}`, color: COLORS.gray },
      { text: `Latest: ${formatDate(p.latest)}`, color: COLORS.gray },
      { text: `Path: ${p.cwd || "(unknown)"}`, color: COLORS.gray },
      { text: "Enter/Right expands. Left collapses.", color: COLORS.dark },
      { text: "N starts a new Codex thread here.", color: COLORS.dark },
    ];
  }
  const t = node.thread;
  return [
    { text: "Type: thread", color: COLORS.dark },
    { text: `Title: ${t.title}`, color: COLORS.white },
    { text: `Updated: ${t.updatedText}`, color: COLORS.gray },
    { text: `Project: ${t.project}`, color: COLORS.gray },
    { text: `Model: ${t.model || "-"}`, color: COLORS.gray },
    { text: `Tokens: ${t.tokensUsed ? t.tokensUsed.toLocaleString() : "-"}`, color: COLORS.gray },
    { text: `Archived: ${t.archived ? "yes" : "no"}`, color: t.archived ? COLORS.yellow : COLORS.gray },
    { text: `Id: ${t.id}`, color: COLORS.dark },
    { text: `Path: ${t.cwd || "(unknown)"}`, color: COLORS.gray },
    { text: "Enter/O opens this thread.", color: COLORS.dark },
  ];
}

function statsLines(threads, nodes, includeArchived, search) {
  const projects = new Set(threads.map((t) => t.cwd || "(unknown)"));
  const active = threads.filter((t) => !t.archived).length;
  const archived = threads.length - active;
  return [
    { text: `CodexHome: ${codexHome()}`, color: COLORS.dark },
    { text: `Projects: ${projects.size}`, color: COLORS.gray },
    { text: `Threads: ${threads.length} total | ${active} active | ${archived} archived`, color: COLORS.gray },
    { text: `Visible nodes: ${nodes.length}`, color: COLORS.gray },
    { text: `Archive filter: ${includeArchived ? "shown" : "hidden"}`, color: COLORS.gray },
    { text: `Search: ${search || "(none)"}`, color: COLORS.gray },
  ];
}

function keyLines(promptMode) {
  if (promptMode === "permission") {
    return [
      { text: "Choose permission mode:", color: COLORS.white },
      { text: "1 Safe: read-only + on-request", color: COLORS.gray },
      { text: "2 Normal: workspace-write + on-request", color: COLORS.green },
      { text: "3 Auto: workspace-write + never", color: COLORS.yellow },
      { text: "4 Full: danger-full-access + never", color: COLORS.red },
      { text: "Esc: cancel", color: COLORS.gray },
    ];
  }
  if (promptMode) {
    return [
      { text: "Enter: apply input", color: COLORS.white },
      { text: "Esc: cancel input", color: COLORS.gray },
      { text: "Backspace: delete", color: COLORS.gray },
    ];
  }
  return [
    { text: "Up/Down: move selection", color: COLORS.gray },
    { text: "Enter/Right: expand or open", color: COLORS.gray },
    { text: "Left: collapse or jump to parent", color: COLORS.gray },
    { text: "O: open selected thread with permissions", color: COLORS.gray },
    { text: "N: new thread with permissions", color: COLORS.gray },
    { text: "D: archive selected thread", color: COLORS.yellow },
    { text: "T: rename selected thread", color: COLORS.gray },
    { text: "F: open folder", color: COLORS.gray },
    { text: "S: search | A: archive toggle", color: COLORS.gray },
    { text: "R: refresh | Q: quit", color: COLORS.gray },
  ];
}

function quotaLines(quota) {
  if (!quota?.rate) {
    return [
      { text: "Quota: not found yet.", color: COLORS.yellow },
      { text: "Start or resume Codex to refresh.", color: COLORS.gray },
      { text: `Now: ${formatDate(new Date(), true)}`, color: COLORS.cyan },
    ];
  }
  const rate = quota.rate;
  const primary = rate.primary || {};
  const secondary = rate.secondary || {};
  return [
    { text: `Plan: ${rate.plan_type || "-"} | Last quota event: ${formatDate(quota.timestamp, true)}`, color: COLORS.cyan },
    { text: `${quotaName(primary.window_minutes)} remaining: ${remainingPercent(primary.used_percent)}% | used: ${safePercent(primary.used_percent)}% | ${resetInfo(primary.resets_at)}`, color: COLORS.cyan },
    { text: `${quotaName(secondary.window_minutes)} remaining: ${remainingPercent(secondary.used_percent)}% | used: ${safePercent(secondary.used_percent)}% | ${resetInfo(secondary.resets_at)}`, color: COLORS.cyan },
    { text: `Now: ${formatDate(new Date(), true)}`, color: COLORS.cyan },
  ];
}

function layout() {
  const width = Math.max(1, process.stdout.columns || 120);
  const height = Math.max(1, process.stdout.rows || 36);
  const leftWidth = Math.max(46, Math.floor(width * 0.5));
  const rightWidth = Math.max(1, width - leftWidth);
  const bodyHeight = height - 2;
  const quotaHeight = 6;
  const detailsHeight = 12;
  const statsHeight = 8;
  const keysHeight = Math.max(5, bodyHeight - quotaHeight - detailsHeight - statsHeight);
  return { width, height, leftWidth, rightWidth, bodyHeight, detailsHeight, statsHeight, keysHeight, quotaHeight };
}

function treeContent(nodes, selectedIndex, scrollTop, treeHeight, width) {
  const rows = [];
  const visible = Math.max(1, treeHeight - 3);
  const threadIndent = "     ";
  for (let row = 0; row < visible; row++) {
    const index = scrollTop + row;
    if (index >= nodes.length) {
      rows.push({ text: "", color: COLORS.gray });
      continue;
    }
    const node = nodes[index];
    const isSelected = index === selectedIndex;
    if (node.type === "project") {
      const mark = node.expanded ? "[-]" : "[+]";
      rows.push({
        text: ` ${mark} ${node.project.name} (${node.project.threads.length}) ${formatDate(node.project.latest)}`,
        color: COLORS.white,
        selected: isSelected,
      });
    } else {
      const t = node.thread;
      const archive = t.archived ? "A" : " ";
      const time = t.updatedText ? t.updatedText.slice(5) : "";
      const prefix = `${threadIndent}${archive} ${time}  `;
      rows.push({
        text: `${prefix}${truncate(t.title, Math.max(8, width - displayWidth(prefix) - 2))}`,
        color: t.archived ? COLORS.yellow : COLORS.gray,
        selected: isSelected,
      });
    }
  }
  if (scrollTop > 0 && rows.length) rows[0] = { text: "^ more above", color: COLORS.yellow };
  if (scrollTop + visible < nodes.length && rows.length) rows[rows.length - 1] = { text: "v more below", color: COLORS.yellow };
  return rows;
}

function makeFrame(state) {
  const l = layout();
  if (l.width < 92 || l.height < 26) {
    return [
      style(pad("Codex Thread Panel", l.width), COLORS.white),
      style(pad("Terminal too small. Recommended minimum: 92 columns x 26 rows.", l.width), COLORS.yellow),
      style(pad(`Current: ${l.width} x ${l.height}. Resize terminal or press Q to exit.`, l.width), COLORS.gray),
      ...Array.from({ length: Math.max(0, l.height - 3) }, () => " ".repeat(l.width)),
    ].slice(0, l.height);
  }

  const nodes = state.nodes;
  const selected = selectedNode(nodes, state.selectedIndex);
  const left = panel(l.leftWidth, l.bodyHeight, "Projects / Threads", [
    { text: `Archived: ${state.includeArchived ? "shown" : "hidden"} | Search: ${state.search || "(none)"}`, color: COLORS.dark },
    ...treeContent(nodes, state.selectedIndex, state.scrollTop, l.bodyHeight - 1, l.leftWidth),
  ]);
  const rightParts = [
    ...panel(l.rightWidth, l.detailsHeight, "Selection", detailLines(selected)),
    ...panel(l.rightWidth, l.statsHeight, "Workspace", statsLines(state.threads, nodes, state.includeArchived, state.search)),
    ...panel(l.rightWidth, l.keysHeight, "Keys", keyLines(state.promptMode)),
    ...panel(l.rightWidth, l.quotaHeight, "Quota", quotaLines(state.quota)),
  ];

  const lines = [];
  lines.push(style(pad("Codex Thread Panel", l.width), COLORS.white));
  for (let i = 0; i < l.bodyHeight; i++) {
    lines.push((left[i] || " ".repeat(l.leftWidth)) + (rightParts[i] || " ".repeat(l.rightWidth)));
  }
  let status = state.status || "Ready";
  if (state.promptMode === "search") status = `Search: ${state.promptBuffer}`;
  if (state.promptMode === "path") status = `Project path: ${state.promptBuffer}`;
  if (state.promptMode === "rename") status = `Rename > ${state.promptBuffer}`;
  if (state.promptMode === "permission") status = "Select permission: 1 Safe, 2 Normal, 3 Auto, 4 Full, Esc cancel";
  lines.push(style(pad(status, l.width), COLORS.dark));
  return lines.slice(0, l.height);
}

function cursorColumnForPrompt(state) {
  if (!state.promptMode) return null;
  let prefix = "";
  if (state.promptMode === "search") prefix = "Search: ";
  else if (state.promptMode === "path") prefix = "Project path: ";
  else if (state.promptMode === "rename") prefix = "Rename > ";
  else return null;
  const beforeCursor = Array.from(state.promptBuffer || "").slice(0, state.promptCursor || 0).join("");
  return Math.min((process.stdout.columns || 120), displayWidth(prefix) + displayWidth(beforeCursor) + 1);
}

class Renderer {
  constructor() {
    this.previous = [];
  }

  reset() {
    this.previous = [];
    process.stdout.write("\x1b[2J");
  }

  render(lines) {
    const output = [];
    const height = lines.length;
    for (let i = 0; i < height; i++) {
      const line = lines[i] || "";
      if (this.previous[i] !== line) {
        output.push(`\x1b[${i + 1};1H${line}${RESET}`);
      }
    }
    if (this.previous.length > height) {
      for (let i = height; i < this.previous.length; i++) {
        output.push(`\x1b[${i + 1};1H${" ".repeat(process.stdout.columns || 120)}`);
      }
    }
    if (output.length) process.stdout.write(output.join(""));
    this.previous = lines.slice();
  }
}

function ensureSelectionVisible(state) {
  const visible = Math.max(1, layout().bodyHeight - 4);
  if (state.selectedIndex < 0) state.selectedIndex = 0;
  if (state.selectedIndex >= state.nodes.length) state.selectedIndex = Math.max(0, state.nodes.length - 1);
  if (state.selectedIndex < state.scrollTop) state.scrollTop = state.selectedIndex;
  if (state.selectedIndex >= state.scrollTop + visible) {
    state.scrollTop = Math.max(0, state.selectedIndex - visible + 1);
  }
}

function rebuildNodes(state) {
  state.nodes = buildNodes(state.threads, state.expanded, state.includeArchived, state.search);
  ensureSelectionVisible(state);
}

function selectedProjectCwd(node) {
  if (!node) return "";
  if (node.type === "project") return node.project.cwd;
  if (node.type === "thread") return node.thread.cwd;
  return "";
}

function selectedProjectName(node) {
  if (!node) return "";
  if (node.type === "project") return node.project.name;
  if (node.type === "thread") return node.thread.project;
  return "";
}

const PERMISSION_MODES = {
  "1": {
    name: "Safe",
    label: "read-only + on-request",
    args: ["--sandbox", "read-only", "--ask-for-approval", "on-request"],
  },
  "2": {
    name: "Normal",
    label: "workspace-write + on-request",
    args: ["--sandbox", "workspace-write", "--ask-for-approval", "on-request"],
  },
  "3": {
    name: "Auto",
    label: "workspace-write + never",
    args: ["--sandbox", "workspace-write", "--ask-for-approval", "never"],
  },
  "4": {
    name: "Full",
    label: "danger-full-access + never",
    args: ["--sandbox", "danger-full-access", "--ask-for-approval", "never"],
  },
};

function createLaunchScript(commands, title = "Codex Thread") {
  const dir = path.join(os.tmpdir(), "codex-thread-panel");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `launch-${Date.now()}-${Math.random().toString(16).slice(2)}.ps1`);
  const body = [
    "$ErrorActionPreference = 'Continue'",
    `$Host.UI.RawUI.WindowTitle = ${psQuote(title)}`,
    ...commands,
  ].join("\r\n");
  fs.writeFileSync(file, `\uFEFF${body}\r\n`, "utf8");
  return file;
}

function createLaunchCmd(scriptPath, title = "Codex Thread") {
  const dir = path.join(os.tmpdir(), "codex-thread-panel");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `launch-${Date.now()}-${Math.random().toString(16).slice(2)}.cmd`);
  const safeTitle = String(title || "Codex Thread").replace(/[&<>|^"]/g, " ");
  const body = [
    "@echo off",
    `title ${safeTitle}`,
    `powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`,
  ].join("\r\n");
  fs.writeFileSync(file, `${body}\r\n`, "utf8");
  return file;
}

function appendLaunchLog(message) {
  try {
    const logPath = path.join(__dirname, "codex-thread-panel-launch.log");
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\r\n`, "utf8");
  } catch {
  }
}

function cmdQuote(value) {
  return `"${String(value || "").replace(/"/g, '""')}"`;
}

function startPowerShell(commands, title = "Codex Thread") {
  const script = createLaunchScript(commands, title);
  const cmdFile = createLaunchCmd(script, title);
  const launcher = path.join(__dirname, "Start-CodexLaunch.ps1");
  appendLaunchLog(`launch requested title=${title} cmd=${cmdFile} ps1=${script}`);

  try {
    cp.spawn("explorer.exe", [cmdFile], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    }).unref();
    appendLaunchLog(`explorer launch submitted cmd=${cmdFile}`);
    return true;
  } catch {
    appendLaunchLog(`explorer launch failed`);
  }

  try {
    cp.spawn("wt.exe", [
      "new-window",
      "--title",
      title,
      "powershell.exe",
      "-NoExit",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
    ], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    }).unref();
    appendLaunchLog(`wt launch submitted ps1=${script}`);
    return true;
  } catch {
    appendLaunchLog(`wt launch failed`);
  }

  try {
    cp.spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      launcher,
      "-ScriptPath",
      script,
      "-Title",
      title,
    ], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    appendLaunchLog(`powershell launcher submitted launcher=${launcher}`);
    return true;
  } catch {
    appendLaunchLog(`powershell launcher failed`);
    return false;
  }
}

function psQuote(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

function codexPermissionArgs(permissionMode) {
  const mode = permissionMode || PERMISSION_MODES["2"];
  return mode.args.map(psQuote).join(" ");
}

function codexThreadModelArgString(thread) {
  const args = [];
  if (thread?.model) args.push("-m", thread.model);
  if (thread?.reasoningEffort) args.push("-c", `model_reasoning_effort=${JSON.stringify(thread.reasoningEffort)}`);
  return args.map(psQuote).join(" ");
}

function openThread(thread, permissionMode = PERMISSION_MODES["2"]) {
  if (!thread?.id) return false;
  const commands = [];
  if (thread.cwd && fs.existsSync(thread.cwd)) {
    commands.push(`Set-Location -LiteralPath ${psQuote(thread.cwd)}`);
  }
  const modelArgs = codexThreadModelArgString(thread);
  commands.push(`codex resume ${codexPermissionArgs(permissionMode)}${modelArgs ? ` ${modelArgs}` : ""} ${psQuote(thread.id)}`);
  return startPowerShell(commands, `Codex - ${thread.project || "Thread"} - ${permissionMode.name}`);
}

function newThread(cwd, permissionMode = PERMISSION_MODES["2"]) {
  if (!cwd || !fs.existsSync(cwd)) return false;
  return startPowerShell([
    `Set-Location -LiteralPath ${psQuote(cwd)}`,
    `codex -C ${psQuote(cwd)} ${codexPermissionArgs(permissionMode)} ${psQuote("新建对话线程")}`,
  ], `Codex - ${projectName(cwd)} - ${permissionMode.name}`);
}

function openFolder(cwd) {
  if (!cwd || !fs.existsSync(cwd)) return false;
  cp.spawn("explorer.exe", [cwd], { detached: true, stdio: "ignore" }).unref();
  return true;
}

function startRenameThread(thread) {
  if (!thread?.id) return false;
  const script = path.join(__dirname, "Rename-CodexThread.ps1");
  if (!fs.existsSync(script)) return false;
  const commands = [
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${psQuote(script)} -ThreadId ${psQuote(thread.id)} -CurrentTitle ${psQuote(thread.title)}`,
  ];
  return startPowerShell(commands, `Rename - ${thread.project || "Thread"}`);
}

function handlePromptInput(state, key) {
  if (isIgnoredTerminalInput(key)) return;
  if (key === "\x1b") {
    state.promptMode = "";
    state.promptBuffer = "";
    state.promptCursor = 0;
    state.pendingAction = null;
    state.status = "Input cancelled.";
    return;
  }

  if (state.promptMode === "permission") {
    const mode = PERMISSION_MODES[key];
    if (!mode) {
      state.status = "Choose 1 Safe, 2 Normal, 3 Auto, 4 Full. Esc cancels.";
      return;
    }

    const action = state.pendingAction;
    state.promptMode = "";
    state.promptBuffer = "";
    state.promptCursor = 0;
    state.pendingAction = null;

    if (!action) {
      state.status = "No pending action.";
      return;
    }
    if (["open", "new"].includes(action.type)) {
      const now = Date.now();
      if (now - Number(state.lastWindowLaunchAt || 0) < 1200) {
        state.status = "Ignored duplicate launch input.";
        return;
      }
      state.lastWindowLaunchAt = now;
    }

    if (action.type === "open" && action.thread) {
      if (openThread(action.thread, mode)) state.status = `Opened thread with ${mode.name}: ${action.thread.title}`;
      else state.status = "Failed to open thread.";
      return;
    }

    if (action.type === "new" && action.cwd) {
      if (newThread(action.cwd, mode)) state.status = `Started new Codex thread with ${mode.name}: ${action.cwd}`;
      else state.status = `Failed to start new thread: ${action.cwd}`;
      return;
    }

    if (action.type === "newPath") {
      state.promptMode = "path";
      state.promptBuffer = "";
      state.promptCursor = 0;
      state.pendingPermission = mode;
      state.status = `Enter project path for ${mode.name} mode.`;
      return;
    }
  }

  if (key === "\x1b[D") {
    state.promptCursor = Math.max(0, (state.promptCursor || 0) - 1);
    return;
  }
  if (key === "\x1b[C") {
    const chars = Array.from(state.promptBuffer || "");
    state.promptCursor = Math.min(chars.length, (state.promptCursor || 0) + 1);
    return;
  }
  if (key === "\x1b[H" || key === "\x1b[1~") {
    state.promptCursor = 0;
    return;
  }
  if (key === "\x1b[F" || key === "\x1b[4~") {
    state.promptCursor = Array.from(state.promptBuffer || "").length;
    return;
  }
  if (key === "\x1b[3~") {
    const chars = Array.from(state.promptBuffer || "");
    const cursor = Math.min(chars.length, state.promptCursor || 0);
    if (cursor < chars.length) {
      chars.splice(cursor, 1);
      state.promptBuffer = chars.join("");
    }
    return;
  }

  if (key === "\r" || key === "\n") {
    const value = state.promptBuffer.trim();
    if (state.promptMode === "search") {
      state.search = value;
      state.selectedIndex = 0;
      state.scrollTop = 0;
      state.status = value ? `Search applied: ${value}` : "Search cleared.";
      rebuildNodes(state);
    } else if (state.promptMode === "path") {
      if (newThread(value, state.pendingPermission || PERMISSION_MODES["2"])) state.status = `Started new Codex thread in: ${value}`;
      else state.status = `Invalid project path: ${value}`;
      state.pendingPermission = null;
    } else if (state.promptMode === "rename") {
      const thread = state.pendingAction?.thread;
      if (thread && renameThread(thread, value)) {
        state.threads = readThreads();
        state.status = `Renamed thread: ${value}`;
        rebuildNodes(state);
      } else {
        state.status = "Rename failed.";
      }
      state.pendingAction = null;
    }
    state.promptMode = "";
    state.promptBuffer = "";
    state.promptCursor = 0;
    return;
  }
  if (key === "\x7f" || key === "\b") {
    const chars = Array.from(state.promptBuffer || "");
    const cursor = Math.min(chars.length, state.promptCursor || 0);
    if (cursor > 0) {
      chars.splice(cursor - 1, 1);
      state.promptBuffer = chars.join("");
      state.promptCursor = cursor - 1;
    }
    return;
  }
  if (Array.from(key).some((ch) => ch.codePointAt(0) >= 32 && ch !== "\x7f")) {
    const chars = Array.from(state.promptBuffer || "");
    const cursor = Math.min(chars.length, state.promptCursor || 0);
    const inputChars = Array.from(key).filter((ch) => ch.codePointAt(0) >= 32 && ch !== "\x7f");
    chars.splice(cursor, 0, ...inputChars);
    state.promptBuffer = chars.join("");
    state.promptCursor = cursor + inputChars.length;
  }
}

function handleKey(state, key, renderer) {
  if (isIgnoredTerminalInput(key)) {
    state.status = "Ignored mouse/terminal control input.";
    return true;
  }

  if (state.promptMode) {
    handlePromptInput(state, key);
    return true;
  }

  const node = selectedNode(state.nodes, state.selectedIndex);
  if (key === "\x03" || key.toLowerCase() === "q") return false;
  if (key === "\x1b[A") {
    if (state.selectedIndex > 0) state.selectedIndex--;
    ensureSelectionVisible(state);
    return true;
  }
  if (key === "\x1b[B") {
    if (state.selectedIndex < state.nodes.length - 1) state.selectedIndex++;
    ensureSelectionVisible(state);
    return true;
  }
  if (key === "\x1b[C") {
    if (node?.type === "project") {
      state.expanded.add(node.project.cwd);
      state.status = `Expanded project: ${node.project.name}`;
      rebuildNodes(state);
    }
    return true;
  }
  if (key === "\x1b[D") {
    if (node?.type === "project") {
      state.expanded.delete(node.project.cwd);
      state.status = `Collapsed project: ${node.project.name}`;
      rebuildNodes(state);
    } else if (node?.type === "thread") {
      const parentIndex = state.nodes.findIndex((item) => item.type === "project" && item.project.cwd === node.project.cwd);
      if (parentIndex >= 0) state.selectedIndex = parentIndex;
      ensureSelectionVisible(state);
    }
    return true;
  }
  if (key === "\r" || key === "\n") {
    if (node?.type === "project") {
      if (state.expanded.has(node.project.cwd)) {
        state.expanded.delete(node.project.cwd);
        state.status = `Collapsed project: ${node.project.name}`;
      } else {
        state.expanded.add(node.project.cwd);
        state.status = `Expanded project: ${node.project.name}`;
      }
      rebuildNodes(state);
    } else if (node?.type === "thread") {
      state.promptMode = "permission";
      state.pendingAction = { type: "open", thread: node.thread };
      state.status = `Choose permission mode for: ${node.thread.title}`;
    }
    return true;
  }
  const lower = key.toLowerCase();
  if (lower === "o") {
    if (node?.type === "thread") {
      state.promptMode = "permission";
      state.pendingAction = { type: "open", thread: node.thread };
      state.status = `Choose permission mode for: ${node.thread.title}`;
    } else {
      state.status = "Select a thread first.";
    }
    return true;
  }
  if (lower === "n") {
    const cwd = selectedProjectCwd(node);
    if (cwd) {
      state.promptMode = "permission";
      state.pendingAction = { type: "new", cwd };
      state.status = `Choose permission mode for new thread: ${cwd}`;
    }
    else {
      state.promptMode = "permission";
      state.pendingAction = { type: "newPath" };
      state.status = "Choose permission mode, then enter project path.";
    }
    return true;
  }
  if (lower === "f") {
    const cwd = selectedProjectCwd(node);
    if (openFolder(cwd)) state.status = `Opened folder: ${cwd}`;
    else state.status = "No valid project folder for this selection.";
    return true;
  }
  if (lower === "d") {
    if (node?.type !== "thread") {
      state.status = "Select a thread to archive.";
      return true;
    }
    if (archiveThread(node.thread)) {
      state.threads = readThreads();
      state.status = `Archived thread: ${node.thread.title}`;
      rebuildNodes(state);
    } else {
      state.status = "Archive failed.";
    }
    return true;
  }
  if (lower === "t") {
    if (node?.type !== "thread") {
      state.status = "Select a thread to rename.";
      return true;
    }
    if (startRenameThread(node.thread)) {
      state.status = "Rename window opened. Press R after saving to refresh.";
    } else {
      state.status = "Failed to open rename window.";
    }
    return true;
  }
  if (lower === "s") {
    state.promptMode = "search";
    state.promptBuffer = state.search || "";
    state.promptCursor = Array.from(state.promptBuffer).length;
    return true;
  }
  if (lower === "a") {
    state.includeArchived = !state.includeArchived;
    state.selectedIndex = 0;
    state.scrollTop = 0;
    state.status = state.includeArchived ? "Archived threads are shown." : "Archived threads are hidden.";
    rebuildNodes(state);
    return true;
  }
  if (lower === "r") {
    state.threads = readThreads();
    state.quota = readLatestQuota();
    state.selectedIndex = 0;
    state.scrollTop = 0;
    state.status = "Refreshed data.";
    rebuildNodes(state);
    renderer.reset();
    return true;
  }
  if (lower === "e" && node?.type === "project") {
    for (const project of groupProjects(state.threads, state.includeArchived, state.search)) {
      state.expanded.add(project.cwd);
    }
    state.status = "Expanded all visible projects.";
    rebuildNodes(state);
    return true;
  }
  if (lower === "c" && node?.type === "project") {
    state.expanded.clear();
    state.status = "Collapsed all projects.";
    rebuildNodes(state);
    return true;
  }
  state.status = `Unhandled key. Selection: ${selectedProjectName(node) || "-"}`;
  return true;
}

function main() {
  const state = {
    threads: readThreads(),
    quota: readLatestQuota(),
    expanded: new Set(),
    includeArchived: false,
    search: "",
    promptMode: "",
    promptBuffer: "",
    promptCursor: 0,
    pendingAction: null,
    pendingPermission: null,
    lastWindowLaunchAt: 0,
    selectedIndex: 0,
    scrollTop: 0,
    nodes: [],
    status: "Enter expands a project. Enter on a thread opens it in a new PowerShell.",
  };
  rebuildNodes(state);

  if (process.argv.includes("--check")) {
    const projects = new Set(state.threads.map((t) => t.cwd || "(unknown)"));
    console.log(`CodexHome: ${codexHome()}`);
    console.log(`Threads: ${state.threads.length}`);
    console.log(`Projects: ${projects.size}`);
    console.log(`Quota: ${state.quota?.rate ? `${state.quota.rate.plan_type || "-"} ${safePercent(state.quota.rate.primary?.used_percent)}%/${safePercent(state.quota.rate.secondary?.used_percent)}%` : "not found"}`);
    console.log(`RolloutTitlesVisible: ${state.threads.filter((t) => isRolloutName(t.title)).length}`);
    const overrideProbe = state.threads.find((t) => t.id === "019dc5a6-6acc-7f30-8d1b-690ab326fb40");
    if (overrideProbe) console.log(`OverrideProbeTitle: ${overrideProbe.title}`);
    return;
  }

  const renderer = new Renderer();
  let running = true;

  function cleanup() {
    try {
      process.stdin.setRawMode(false);
    } catch {
    }
    process.stdout.write(`${DISABLE_MOUSE_INPUT}${SHOW_CURSOR}${MAIN_SCREEN}${RESET}`);
  }

  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    running = false;
    cleanup();
    process.exit(0);
  });

  process.stdout.write(`${ALT_SCREEN}${HIDE_CURSOR}${DISABLE_MOUSE_INPUT}\x1b[2J`);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  let lastQuotaRead = 0;
  let lastColumns = process.stdout.columns;
  let lastRows = process.stdout.rows;

  function render() {
    renderer.render(makeFrame(state));
    const promptColumn = cursorColumnForPrompt(state);
    if (promptColumn) {
      process.stdout.write(`${SHOW_CURSOR}\x1b[${process.stdout.rows || 1};${promptColumn}H`);
    } else {
      process.stdout.write(HIDE_CURSOR);
    }
  }

  process.stdin.on("data", (chunk) => {
    for (const key of splitKeys(chunk)) {
      running = handleKey(state, key, renderer);
      if (!running) {
        cleanup();
        process.exit(0);
      }
      render();
    }
  });

  setInterval(() => {
    if (!running) return;
    if (process.stdout.columns !== lastColumns || process.stdout.rows !== lastRows) {
      lastColumns = process.stdout.columns;
      lastRows = process.stdout.rows;
      renderer.reset();
    }
    if (Date.now() - lastQuotaRead > 10000) {
      state.quota = readLatestQuota();
      lastQuotaRead = Date.now();
    }
    render();
  }, 250);

  render();
}

function splitKeys(chunk) {
  const keys = [];
  for (let i = 0; i < chunk.length; i++) {
    if (chunk.startsWith("\x1b[M", i)) {
      const end = Math.min(chunk.length, i + 6);
      keys.push(chunk.slice(i, end));
      i = end - 1;
      continue;
    }
    if (chunk[i] === "\x1b" && chunk[i + 1] === "[") {
      let end = i + 2;
      while (end < chunk.length && !/[~A-Za-z]/.test(chunk[end])) {
        end++;
      }
      if (end < chunk.length) {
        keys.push(chunk.slice(i, end + 1));
        i = end;
      } else {
        keys.push(chunk[i]);
      }
    } else {
      const code = chunk.codePointAt(i);
      const ch = String.fromCodePoint(code);
      keys.push(ch);
      if (code > 0xffff) i++;
    }
  }
  return keys;
}

function isIgnoredTerminalInput(key) {
  if (!key) return false;
  if (key.startsWith("\x1b[M")) return true;
  if (/^\x1b\[<[\d;]+[mM]$/.test(key)) return true;
  if (key.startsWith("\x1b") && key.length > 1 && !["\x1b[A", "\x1b[B", "\x1b[C", "\x1b[D"].includes(key)) {
    return true;
  }
  return false;
}

main();
