#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch {
  // Older Node versions can still use an external sqlite3 executable below.
}

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
  orange: "\x1b[38;5;215m",
  green: "\x1b[38;5;114m",
  red: "\x1b[38;5;203m",
  selected: "\x1b[38;5;16;48;5;250m",
};

const PINNED_SECTION_CWD = "__codex_thread_panel_pinned__";
const PINNED_SECTION_NAME = "__codex_thread_panel_pinned__";

const UI_TEXT = Object.freeze({
  zh: {
    title: "Codex 线程面板",
    terminalTooSmall: "终端窗口过小。建议最小尺寸：92 列 x 26 行。",
    terminalCurrent: "当前：{width} x {height}。请调整终端大小，或按 Q 退出。",
    projectsThreads: "项目 / 线程",
    selection: "当前选择",
    workspace: "工作区",
    keys: "快捷键",
    quota: "额度",
    unknown: "(未知)",
    unknownProject: "(未知项目)",
    none: "(无)",
    shown: "显示",
    hidden: "隐藏",
    yes: "是",
    no: "否",
    project: "项目",
    thread: "线程",
    type: "类型",
    name: "名称",
    threads: "线程",
    state: "状态",
    expanded: "已展开",
    collapsed: "已折叠",
    latest: "最近更新",
    path: "路径",
    threadTitle: "标题",
    updated: "更新时间",
    model: "模型",
    tokens: "令牌",
    archived: "归档",
    pinned: "置顶",
    pinnedSection: "置顶",
    id: "ID",
    noSelection: "未选择项目或线程。",
    projectEnter: "Enter / 右方向键：展开项目。左方向键：折叠项目。",
    projectNew: "N：在此项目中新建 Codex 线程。",
    pinnedEnter: "Enter / 右方向键：展开置顶会话。左方向键：折叠。",
    threadOpen: "Enter / O：按权限模式打开此线程。",
    codexHome: "Codex 主目录",
    projects: "项目数",
    totalActiveArchived: "线程：共 {total} | 活跃 {active} | 已归档 {archived}",
    threadSummary: "共 {total} | 活跃 {active} | 已归档 {archived}",
    visibleNodes: "可见项",
    archiveFilter: "归档筛选",
    search: "搜索",
    permissionChoose: "选择权限模式：",
    modeSafe: "安全",
    modeNormal: "标准",
    modeAuto: "自动",
    modeFull: "完全访问",
    modeSafeLabel: "只读 + 按需授权",
    modeNormalLabel: "工作区可写 + 按需授权",
    modeAutoLabel: "工作区可写 + 不再询问",
    modeFullLabel: "完全访问 + 不再询问",
    escCancel: "Esc：取消",
    inputApply: "Enter：确认输入",
    inputCancel: "Esc：取消输入",
    backspaceDelete: "Backspace：删除",
    moveSelection: "上 / 下方向键：移动选择",
    expandOpen: "Enter / 右方向键：展开或打开",
    collapseParent: "左方向键：折叠或跳到上级项目",
    openThread: "O：按权限模式打开选中线程",
    newThread: "N：按权限模式新建线程",
    archiveThread: "D：归档选中线程",
    renameThread: "T：重命名选中线程",
    openFolder: "F：打开项目文件夹",
    searchArchive: "S：搜索 | A：切换归档显示",
    refreshQuit: "R：刷新 | Q：退出",
    switchLanguage: "L：中英文切换",
    keyLanguageQuit: "L：中英文切换 | Q：退出",
    keyNavigation: "导航：上/下移动 | 左折叠 | 右/Enter 展开或打开",
    keyThreadActions: "线程：O 打开 | N 新建 | T 重命名",
    keyOtherActions: "D 归档 | F 文件夹 | S 搜索 | A 归档显示 | R 刷新",
    quit: "Q：退出",
    refresh: "R：刷新数据",
    searchShortcut: "S：搜索",
    archiveToggle: "A：切换归档显示",
    quotaUnavailable: "暂未找到额度信息。",
    quotaHint: "启动或继续 Codex 后将自动刷新。",
    now: "当前时间",
    planLastQuota: "套餐：{plan} | 最近额度事件：{time}",
    quotaRemaining: "{window}：剩余 {remaining}% | 已用 {used}% | {health} | {reset}",
    quotaGood: "额度良好",
    quotaModerate: "额度中等",
    quotaCritical: "额度严重",
    tokenUsageSummary: "Token 消耗：日 {day} | 周 {week} | 月 {month}",
    tokenUsageTotal: "账号累计 Token 数：{total} | API 账单模拟：{apiCost} [T_T]",
    tokenUsageTotalPending: "账号累计 Token 数：{total}",
    quotaUsagePending: "统计中",
    quotaUsageUnavailable: "--",
    fiveHourLimit: "5 小时额度",
    weeklyLimit: "每周额度",
    minuteLimit: "{minutes} 分钟额度",
    resetUnknown: "重置时间未知",
    resetReached: "已到重置时间（{time}）",
    resetDays: "{days}天{hours}小时后重置（{time}）",
    resetHours: "{hours}小时{minutes}分钟后重置（{time}）",
    resetMinutes: "{minutes}分钟{seconds}秒后重置（{time}）",
    moreAbove: "^ 上方还有更多",
    moreBelow: "v 下方还有更多",
    archiveMarker: "归",
    ready: "就绪",
    searchPrompt: "搜索：",
    pathPrompt: "项目路径：",
    renamePrompt: "重命名 >",
    permissionPrompt: "选择权限：1 安全，2 标准，3 自动，4 完全访问，Esc 取消",
    initialStatus: "Enter 展开项目；在线程上按 Enter 可在新 PowerShell 窗口中打开。",
    ignoredTerminalInput: "已忽略鼠标或终端控制输入。",
    inputCancelled: "已取消输入。",
    choosePermission: "请选择 1 安全、2 标准、3 自动或 4 完全访问；Esc 取消。",
    noPendingAction: "没有待执行的操作。",
    duplicateLaunch: "已忽略重复的启动输入。",
    openedThread: "已用{mode}模式打开线程：{title}",
    openThreadFailed: "打开线程失败。",
    startedThread: "已用{mode}模式启动新 Codex 线程：{path}",
    startThreadFailed: "启动新线程失败：{path}",
    enterProjectPath: "请输入{mode}模式的项目路径。",
    searchApplied: "已应用搜索：{value}",
    searchCleared: "已清除搜索。",
    startedThreadIn: "已在此路径启动新 Codex 线程：{path}",
    invalidProjectPath: "项目路径无效：{path}",
    renamedThread: "已重命名线程：{title}",
    renameFailed: "重命名失败。",
    expandedProject: "已展开项目：{name}",
    collapsedProject: "已折叠项目：{name}",
    chooseThreadPermission: "请为线程选择权限模式：{title}",
    selectThreadFirst: "请先选择一个线程。",
    chooseNewPermission: "请为新线程选择权限模式：{path}",
    choosePathPermission: "请选择权限模式，然后输入项目路径。",
    openedFolder: "已打开文件夹：{path}",
    invalidProjectFolder: "当前选择没有有效的项目文件夹。",
    selectThreadArchive: "请选择要归档的线程。",
    archivedThread: "已归档线程：{title}",
    archiveFailed: "归档失败。",
    selectThreadRename: "请选择要重命名的线程。",
    enterNewTitle: "请输入新的 Codex 标题：{title}",
    archivedShown: "已显示归档线程。",
    archivedHidden: "已隐藏归档线程。",
    refreshedData: "数据已刷新。",
    expandedAll: "已展开所有可见项目。",
    collapsedAll: "已折叠所有项目。",
    unhandledKey: "未处理的按键。当前选择：{name}",
    languageChanged: "已切换为{language}界面。",
    languageChinese: "中文",
    languageEnglish: "英文",
  },
  en: {
    title: "Codex Thread Panel",
    terminalTooSmall: "Terminal too small. Recommended minimum: 92 columns x 26 rows.",
    terminalCurrent: "Current: {width} x {height}. Resize terminal or press Q to exit.",
    projectsThreads: "Projects / Threads",
    selection: "Selection",
    workspace: "Workspace",
    keys: "Keys",
    quota: "Quota",
    unknown: "(unknown)",
    unknownProject: "(unknown project)",
    none: "(none)",
    shown: "shown",
    hidden: "hidden",
    yes: "yes",
    no: "no",
    project: "project",
    thread: "thread",
    type: "Type",
    name: "Name",
    threads: "Threads",
    state: "State",
    expanded: "expanded",
    collapsed: "collapsed",
    latest: "Latest",
    path: "Path",
    threadTitle: "Title",
    updated: "Updated",
    model: "Model",
    tokens: "Tokens",
    archived: "Archived",
    pinned: "Pinned",
    pinnedSection: "Pinned",
    id: "Id",
    noSelection: "No selection.",
    projectEnter: "Enter/Right expands. Left collapses.",
    projectNew: "N starts a new Codex thread here.",
    pinnedEnter: "Enter/Right expands pinned threads. Left collapses.",
    threadOpen: "Enter/O opens this thread with permissions.",
    codexHome: "CodexHome",
    projects: "Projects",
    totalActiveArchived: "Threads: {total} total | {active} active | {archived} archived",
    threadSummary: "{total} total | {active} active | {archived} archived",
    visibleNodes: "Visible nodes",
    archiveFilter: "Archive filter",
    search: "Search",
    permissionChoose: "Choose permission mode:",
    modeSafe: "Safe",
    modeNormal: "Normal",
    modeAuto: "Auto",
    modeFull: "Full",
    modeSafeLabel: "read-only + on-request",
    modeNormalLabel: "workspace-write + on-request",
    modeAutoLabel: "workspace-write + never",
    modeFullLabel: "danger-full-access + never",
    escCancel: "Esc: cancel",
    inputApply: "Enter: apply input",
    inputCancel: "Esc: cancel input",
    backspaceDelete: "Backspace: delete",
    moveSelection: "Up/Down: move selection",
    expandOpen: "Enter/Right: expand or open",
    collapseParent: "Left: collapse or jump to parent",
    openThread: "O: open selected thread with permissions",
    newThread: "N: new thread with permissions",
    archiveThread: "D: archive selected thread",
    renameThread: "T: rename selected thread",
    openFolder: "F: open folder",
    searchArchive: "S: search | A: archive toggle",
    refreshQuit: "R: refresh | Q: quit",
    switchLanguage: "L: switch Chinese / English",
    keyLanguageQuit: "L: switch Chinese / English | Q: quit",
    keyNavigation: "Navigate: Up/Down move | Left collapse | Right/Enter act",
    keyThreadActions: "Threads: O open | N new | T rename",
    keyOtherActions: "D archive | F folder | S search | A archive view | R refresh",
    quit: "Q: quit",
    refresh: "R: refresh data",
    searchShortcut: "S: search",
    archiveToggle: "A: toggle archived threads",
    quotaUnavailable: "Quota: not found yet.",
    quotaHint: "Start or resume Codex to refresh.",
    now: "Now",
    planLastQuota: "Plan: {plan} | Last quota event: {time}",
    quotaRemaining: "{window} remaining: {remaining}% | used: {used}% | {health} | {reset}",
    quotaGood: "quota healthy",
    quotaModerate: "quota moderate",
    quotaCritical: "quota critical",
    tokenUsageSummary: "Tokens: day {day} | week {week} | month {month}",
    tokenUsageTotal: "Account lifetime tokens: {total} | pretend API bill: {apiCost} [T_T]",
    tokenUsageTotalPending: "Account lifetime tokens: {total}",
    quotaUsagePending: "calculating",
    quotaUsageUnavailable: "--",
    fiveHourLimit: "5h limit",
    weeklyLimit: "weekly limit",
    minuteLimit: "{minutes}m limit",
    resetUnknown: "reset unknown",
    resetReached: "reset reached ({time})",
    resetDays: "resets in {days}d {hours}h ({time})",
    resetHours: "resets in {hours}h {minutes}m ({time})",
    resetMinutes: "resets in {minutes}m {seconds}s ({time})",
    moreAbove: "^ more above",
    moreBelow: "v more below",
    archiveMarker: "A",
    ready: "Ready",
    searchPrompt: "Search:",
    pathPrompt: "Project path:",
    renamePrompt: "Rename >",
    permissionPrompt: "Select permission: 1 Safe, 2 Normal, 3 Auto, 4 Full, Esc cancel",
    initialStatus: "Enter expands a project. Enter on a thread opens it in a new PowerShell.",
    ignoredTerminalInput: "Ignored mouse/terminal control input.",
    inputCancelled: "Input cancelled.",
    choosePermission: "Choose 1 Safe, 2 Normal, 3 Auto, 4 Full. Esc cancels.",
    noPendingAction: "No pending action.",
    duplicateLaunch: "Ignored duplicate launch input.",
    openedThread: "Opened thread with {mode}: {title}",
    openThreadFailed: "Failed to open thread.",
    startedThread: "Started new Codex thread with {mode}: {path}",
    startThreadFailed: "Failed to start new thread: {path}",
    enterProjectPath: "Enter project path for {mode} mode.",
    searchApplied: "Search applied: {value}",
    searchCleared: "Search cleared.",
    startedThreadIn: "Started new Codex thread in: {path}",
    invalidProjectPath: "Invalid project path: {path}",
    renamedThread: "Renamed thread: {title}",
    renameFailed: "Rename failed.",
    expandedProject: "Expanded project: {name}",
    collapsedProject: "Collapsed project: {name}",
    chooseThreadPermission: "Choose permission mode for: {title}",
    selectThreadFirst: "Select a thread first.",
    chooseNewPermission: "Choose permission mode for new thread: {path}",
    choosePathPermission: "Choose permission mode, then enter project path.",
    openedFolder: "Opened folder: {path}",
    invalidProjectFolder: "No valid project folder for this selection.",
    selectThreadArchive: "Select a thread to archive.",
    archivedThread: "Archived thread: {title}",
    archiveFailed: "Archive failed.",
    selectThreadRename: "Select a thread to rename.",
    enterNewTitle: "Enter a new Codex title for: {title}",
    archivedShown: "Archived threads are shown.",
    archivedHidden: "Archived threads are hidden.",
    refreshedData: "Refreshed data.",
    expandedAll: "Expanded all visible projects.",
    collapsedAll: "Collapsed all projects.",
    unhandledKey: "Unhandled key. Selection: {name}",
    languageChanged: "Switched to {language}.",
    languageChinese: "Chinese",
    languageEnglish: "English",
  },
});

function ui(language, key, values = {}) {
  const template = UI_TEXT[language]?.[key] || UI_TEXT.en[key] || key;
  return template.replace(/\{(\w+)\}/g, (_match, name) => String(values[name] ?? ""));
}

// Campy idle frames, reused under the Campy MIT License. See THIRD_PARTY_NOTICES.md.
const CAMPY_PETS = Object.freeze({
  cat: {
    names: { zh: "猫", en: "cat" },
    color: COLORS.yellow,
    frames: [
      ["  /\\_____/\\  ", " /  o   o  \\ ", "(  == ^ ==  )", " \\  '-'  /  ", " (__)  (__) "],
      ["  /\\_____/\\  ", " /  -   -  \\ ", "(  == ^ ==  )", " \\  '-'  /  ", " (__)  (__) "],
    ],
  },
  hamster: {
    names: { zh: "仓鼠", en: "hamster" },
    color: COLORS.orange,
    frames: [
      [" (\\\\/)  (\\\\/) ", "  ( ..)  ( ..) ", "   `--'`--'    ", "    (   )    ", "     ( )     "],
      [" (\\\\/)  (\\\\/) ", "  ( -.)  ( -.) ", "   `--'`--'    ", "    (   )    ", "     ( )     "],
    ],
  },
  ghost: {
    names: { zh: "幽灵", en: "ghost" },
    color: COLORS.cyan,
    frames: [
      ["   .-.     ", "  (o o)    ", "  | O |    ", "  '~~~'    ", "          "],
      ["   .-.     ", "  (- -)    ", "  | O |    ", "  '~~~'    ", "          "],
    ],
  },
  robot: {
    names: { zh: "机器人", en: "robot" },
    color: COLORS.green,
    frames: [
      ["    ___     ___  ", "   | O |---| O | ", "   |___/   \\___|", "      \\_|_/      ", "                "],
      ["    ___     ___  ", "   | - |---| - | ", "   |___/   \\___|", "      \\_|_/      ", "                "],
    ],
  },
});

const CAMPY_PET_IDS = Object.freeze(["cat", "hamster", "ghost", "robot"]);
const CAMPY_PET_ID_BY_KEY = Object.freeze(Object.fromEntries(CAMPY_PET_IDS.map((id, index) => [String(index + 1), id])));

function currentCampyPet(petId) {
  return CAMPY_PETS[petId] || CAMPY_PETS.cat;
}

function campyPetShortcutText(language) {
  return language === "zh" ? "宠物：1 猫 | 2 仓鼠 | 3 幽灵 | 4 机器人" : "Pets: 1 cat | 2 hamster | 3 ghost | 4 robot";
}

function campyPetCurrentText(petId, language) {
  const pet = currentCampyPet(petId);
  const name = pet.names[language] || pet.names.en;
  return language === "zh" ? `Campy 宠物：${name}` : `Campy pet: ${name}`;
}

function campyPetWidget(petId, language, nowMs = Date.now()) {
  const pet = currentCampyPet(petId);
  const frame = pet.frames[Math.floor(nowMs / 1000) % pet.frames.length];
  return [
    { text: campyPetCurrentText(petId, language), color: pet.color, align: "right" },
    ...frame.map((text) => ({ text, color: pet.color, align: "right" })),
  ];
}

function displayProjectName(name, language) {
  if (name === PINNED_SECTION_NAME) return ui(language, "pinnedSection");
  return name === "(unknown)" || name === "(unknown project)" ? ui(language, "unknownProject") : name;
}

function labelValueText(label, value, labelWidth, language) {
  const separator = language === "zh" ? "：" : ": ";
  return `${pad(label, labelWidth)}${separator}${value}`;
}

function labelValueRows(language, rows) {
  const labelWidth = Math.max(...rows.map((row) => displayWidth(row.label)));
  return rows.map((row) => ({
    text: labelValueText(row.label, row.value, labelWidth, language),
    color: row.color,
  }));
}

function permissionModeName(mode, language) {
  return ui(language, `mode${mode?.id || "Normal"}`);
}

function permissionModeLabel(mode, language) {
  return ui(language, `mode${mode?.id || "Normal"}Label`);
}

function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function globalStatePath(home = codexHome()) {
  return path.join(home, ".codex-global-state.json");
}

function uniqueThreadIds(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).filter((value) => {
    const id = String(value || "").trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function readPinnedThreadIds(home = codexHome()) {
  try {
    const state = JSON.parse(fs.readFileSync(globalStatePath(home), "utf8"));
    if (Array.isArray(state?.["pinned-thread-ids"])) return uniqueThreadIds(state["pinned-thread-ids"]);
    const hostIds = state?.["app-server-migrated-pinned-thread-ids-by-host"]?.[`local:${home}`];
    if (Array.isArray(hostIds)) return uniqueThreadIds(hostIds);
    const desktopIds = state?.["electron-persisted-atom-state"]?.["app-server-pinned-thread-order-v1"];
    return uniqueThreadIds(desktopIds);
  } catch {
    return [];
  }
}

function displayPlan(planType, language) {
  const plan = String(planType || "-").toLowerCase();
  if (plan === "pro") return language === "zh" ? "Pro $200/月 · 20x" : "Pro $200/mo · 20x";
  if (plan === "prolite") return language === "zh" ? "Pro $100/月 · 5x" : "Pro $100/mo · 5x";
  return String(planType || "-");
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

const GRAPHEME_SEGMENTER = typeof Intl !== "undefined" && Intl.Segmenter
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : null;
const COMBINING_MARK = /^\p{Mark}$/u;
const EXTENDED_PICTOGRAPHIC = /\p{Extended_Pictographic}/u;

function graphemeClusters(value) {
  const text = String(value || "");
  if (!GRAPHEME_SEGMENTER) return Array.from(text);
  return Array.from(GRAPHEME_SEGMENTER.segment(text), ({ segment }) => segment);
}

function isFullwidthCodePoint(code) {
  return code >= 0x1100 && (
    code <= 0x115f ||
    code === 0x2329 ||
    code === 0x232a ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1b000 && code <= 0x1b001) ||
    (code >= 0x1f200 && code <= 0x1f251) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

function codePointWidth(ch) {
  const code = ch.codePointAt(0);
  if (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x200c ||
    code === 0x200d ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    (code >= 0xe0100 && code <= 0xe01ef) ||
    COMBINING_MARK.test(ch)
  ) return 0;
  return isFullwidthCodePoint(code) ? 2 : 1;
}

function graphemeWidth(grapheme) {
  const codePoints = Array.from(grapheme);
  if (
    EXTENDED_PICTOGRAPHIC.test(grapheme) ||
    codePoints.some((ch) => {
      const code = ch.codePointAt(0);
      return code >= 0x1f1e6 && code <= 0x1f1ff;
    })
  ) return 2;
  return codePoints.reduce((width, ch) => width + codePointWidth(ch), 0);
}

function displayWidth(value) {
  return graphemeClusters(value).reduce((width, grapheme) => width + graphemeWidth(grapheme), 0);
}

function truncate(value, maxWidth) {
  const text = displayLine(value);
  if (maxWidth < 4) return "";
  if (displayWidth(text) <= maxWidth) return text;
  let width = 0;
  let out = "";
  const target = maxWidth - 3;
  for (const grapheme of graphemeClusters(text)) {
    const widthOfGrapheme = graphemeWidth(grapheme);
    if (width + widthOfGrapheme > target) break;
    out += grapheme;
    width += widthOfGrapheme;
  }
  return `${out}...`;
}

function pad(value, width) {
  const text = truncate(value, width);
  const current = displayWidth(text);
  return current < width ? text + " ".repeat(width - current) : text;
}

function padLeft(value, width) {
  const text = truncate(value, width);
  const current = displayWidth(text);
  return current < width ? " ".repeat(width - current) + text : text;
}

function formatColumns(columns) {
  return columns.map(({ text, width, align = "left" }) => {
    if (!Number.isFinite(width)) return displayLine(text);
    return align === "right" ? padLeft(text, width) : pad(text, width);
  }).join("");
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
  if (!normalized) return "(unknown)";
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

function readFilePrefix(filePath, maxBytes = 256 * 1024) {
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
    const size = fs.fstatSync(fd).size;
    const bytes = Math.min(size, maxBytes);
    if (!bytes) return "";
    const buffer = Buffer.allocUnsafe(bytes);
    const read = fs.readSync(fd, buffer, 0, bytes, 0);
    return buffer.toString("utf8", 0, read);
  } catch {
    return "";
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
      }
    }
  }
}

function readFileTail(filePath, maxBytes = 256 * 1024) {
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
    const size = fs.fstatSync(fd).size;
    const bytes = Math.min(size, maxBytes);
    if (!bytes) return "";
    const buffer = Buffer.allocUnsafe(bytes);
    const read = fs.readSync(fd, buffer, 0, bytes, size - bytes);
    return buffer.toString("utf8", 0, read);
  } catch {
    return "";
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
      }
    }
  }
}

function runSqliteJson(dbPath, query) {
  if (DatabaseSync) {
    let db;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
      return db.prepare(query).all();
    } catch {
    } finally {
      try {
        db?.close();
      } catch {
      }
    }
  }
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
  if (DatabaseSync) {
    let db;
    try {
      db = new DatabaseSync(dbPath);
      db.exec(query);
      return true;
    } catch {
    } finally {
      try {
        db?.close();
      } catch {
      }
    }
  }
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
  const text = readFilePrefix(filePath);
  if (!text) return null;

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

function fileSignature(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "";
  }
}

function threadDataSignature(home = codexHome()) {
  return [
    path.join(home, "state_5.sqlite"),
    path.join(home, "state_5.sqlite-wal"),
    path.join(home, "session_index.jsonl"),
    globalStatePath(home),
  ].map(fileSignature).join("|");
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
  const dbPath = path.join(codexHome(), "state_5.sqlite");
  if (!fs.existsSync(dbPath)) return false;
  const renamed = runSqliteExec(
    dbPath,
    `update threads set name=${sqliteLiteral(nextTitle)} where id=${sqliteLiteral(thread.id)};`,
  );
  if (!renamed) return false;
  rewriteSessionIndexTitle(thread.id, nextTitle);
  return true;
}

function readSqliteThreads(home) {
  const dbPath = path.join(home, "state_5.sqlite");
  if (!fs.existsSync(dbPath)) return new Map();
  let rows = runSqliteJson(
    dbPath,
    `select id, name, title, thread_source, cwd, archived, rollout_path, tokens_used, model, reasoning_effort,
            updated_at_ms, updated_at, first_user_message
       from threads
      order by coalesce(updated_at_ms, updated_at * 1000) desc, id desc;`,
  );
  if (rows.length === 0) {
    rows = runSqliteJson(
      dbPath,
      `select id, title, cwd, archived, rollout_path, tokens_used, model, reasoning_effort,
              updated_at_ms, updated_at, first_user_message
         from threads
        order by coalesce(updated_at_ms, updated_at * 1000) desc, id desc;`,
    );
  }
  const byId = new Map();
  for (const row of rows) {
    if (!row.id) continue;
    byId.set(row.id, {
      id: row.id,
      nativeTitle: row.name || "",
      title: row.title || "",
      threadSource: row.thread_source || "",
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
  const pinnedIds = readPinnedThreadIds(home);
  const pinnedOrder = new Map(pinnedIds.map((id, index) => [id, index]));

  const metaById = new Map();
  // SQLite and session_index already hold the data needed by the list view.
  // Only recover from rollout files when neither source is available.
  if (byId.size === 0 && index.size === 0) {
    const sessionRoots = [path.join(home, "sessions"), path.join(home, "archived_sessions")];
    for (const file of sessionRoots.flatMap((root) => walkFiles(root))) {
      const meta = scanSessionFile(file.path);
      if (!meta) continue;
      const existing = metaById.get(meta.id);
      if (!existing || ((meta.timestamp || 0) > (existing.timestamp || 0))) {
        metaById.set(meta.id, meta);
      }
    }
  }

  for (const [id, item] of index) {
    const current = byId.get(id);
    const meta = metaById.get(id);
    if (current) {
      current.indexTitle = item.title;
      if (item.updated && (!current.updated || item.updated > current.updated)) current.updated = item.updated;
      if (meta) {
        current.cwd ||= meta.cwd;
        current.sourceFile ||= meta.sourceFile;
        current.firstUserMessage ||= meta.firstUserMessage;
        current.model ||= meta.model;
      }
    } else {
      byId.set(id, {
        id,
        nativeTitle: "",
        title: item.title || "",
        indexTitle: item.title || "",
        threadSource: "",
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
      nativeTitle: "",
      title: "",
      indexTitle: "",
      threadSource: "",
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
    // Hide internal guardian reviews and unnamed delegated helpers from the task list.
    .filter((item) => item.threadSource !== "guardian_review")
    .filter((item) => item.threadSource !== "subagent" || Boolean(singleLine(item.nativeTitle) || singleLine(item.indexTitle)))
    .map((item) => {
      const title = chooseTitle(item.nativeTitle, item.indexTitle, item.title, item.firstUserMessage);
      return {
        id: item.id,
        title,
        threadSource: item.threadSource || "",
        cwd: normalizeCodexPath(item.cwd || ""),
        project: projectName(item.cwd || ""),
        archived: Boolean(item.archived),
        pinned: pinnedOrder.has(item.id),
        pinnedOrder: pinnedOrder.get(item.id) ?? -1,
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
  const text = readFileTail(filePath);
  if (!text) return null;
  const needle = '"rate_limits"';
  const index = text.lastIndexOf(needle);
  if (index < 0) return null;
  const start = text.lastIndexOf("\n", index);
  const end = text.indexOf("\n", index);
  return text.slice(start < 0 ? 0 : start + 1, end < 0 ? text.length : end);
}

function isAccountQuota(rate) {
  return rate?.limit_id === "codex" && Number(rate.primary?.window_minutes) > 0;
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
    if (!isAccountQuota(rate)) continue;
    const timestamp = toDate(obj.timestamp);
    if (!latest || (timestamp?.getTime() || 0) > (latest.timestamp?.getTime() || 0)) {
      latest = { timestamp, rate, file: file.path };
    }
  }

  return latest;
}

function tokenUsageCachePath(home = codexHome()) {
  return path.join(home, "codex-thread-panel-token-usage-history.json");
}

const TOKEN_USAGE_TAIL_BYTES = 256 * 1024;
const TOKEN_USAGE_SEARCH_BYTES = 64 * 1024;
const TOKEN_USAGE_BASELINE_BYTES = 512 * 1024;

function sessionFileCreatedAt(filePath) {
  const match = String(filePath || "").match(/[\\/](\d{4})[\\/](\d{2})[\\/](\d{2})[\\/]/);
  if (!match) return 0;
  return new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00`).getTime();
}

function readFileRange(filePath, position, maxBytes) {
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, Math.min(size, Math.floor(position)));
    const bytes = Math.max(0, Math.min(size - start, maxBytes));
    if (!bytes) return { text: "", start, size };
    const buffer = Buffer.allocUnsafe(bytes);
    const read = fs.readSync(fd, buffer, 0, bytes, start);
    return { text: buffer.toString("utf8", 0, read), start, size };
  } catch {
    return { text: "", start: 0, size: 0 };
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
      }
    }
  }
}

function tokenUsageSample(text, startsMidLine = false) {
  const lines = String(text || "").split(/\r?\n/);
  if (startsMidLine) lines.shift();
  const records = [];
  let firstTimestamp = 0;
  let lastTimestamp = 0;
  for (const line of lines) {
    const record = parseJsonLine(line);
    const timestamp = toDate(record?.timestamp)?.getTime() || 0;
    if (!timestamp) continue;
    if (!firstTimestamp || timestamp < firstTimestamp) firstTimestamp = timestamp;
    if (timestamp > lastTimestamp) lastTimestamp = timestamp;
    const totalTokens = Number(record?.payload?.thread_token_usage?.total_tokens);
    if (record?.type === "token_usage_record" && Number.isFinite(totalTokens) && totalTokens >= 0) {
      records.push({ timestamp, totalTokens: Math.round(totalTokens) });
    }
  }
  return { firstTimestamp, lastTimestamp, records };
}

function readTokenUsageSample(file, position, maxBytes) {
  const range = readFileRange(file.path, position, maxBytes);
  return tokenUsageSample(range.text, range.start > 0);
}

function latestThreadTokenUsage(file) {
  for (let end = file.size; end > 0; end -= TOKEN_USAGE_TAIL_BYTES) {
    const start = Math.max(0, end - TOKEN_USAGE_TAIL_BYTES);
    const sample = readTokenUsageSample(file, start, end - start);
    const latest = sample.records.reduce((current, record) => (
      !current || record.timestamp > current.timestamp ? record : current
    ), null);
    if (latest) return latest;
    if (start === 0) break;
  }
  return null;
}

function findThreadTokenUsageAtOrBefore(file, targetMs) {
  let low = 0;
  let high = file.size;
  let anchor = 0;

  for (let attempt = 0; attempt < 30 && high - low > TOKEN_USAGE_SEARCH_BYTES; attempt++) {
    const middle = Math.floor((low + high) / 2);
    const sample = readTokenUsageSample(file, middle, TOKEN_USAGE_SEARCH_BYTES);
    if (!sample.firstTimestamp || !sample.lastTimestamp) {
      high = middle;
      anchor = middle;
    } else if (sample.lastTimestamp < targetMs) {
      low = Math.min(file.size, middle + TOKEN_USAGE_SEARCH_BYTES);
      anchor = low;
    } else if (sample.firstTimestamp >= targetMs) {
      high = middle;
      anchor = high;
    } else {
      anchor = middle;
      break;
    }
  }

  for (let end = Math.min(file.size, Math.max(0, anchor + TOKEN_USAGE_SEARCH_BYTES)); end > 0; end -= TOKEN_USAGE_BASELINE_BYTES) {
    const start = Math.max(0, end - TOKEN_USAGE_BASELINE_BYTES);
    const sample = readTokenUsageSample(file, start, end - start + TOKEN_USAGE_SEARCH_BYTES);
    const record = sample.records
      .filter((item) => item.timestamp < targetMs)
      .reduce((latest, item) => (!latest || item.timestamp > latest.timestamp ? item : latest), null);
    if (record) return record.totalTokens;
    if (start === 0) break;
  }
  return 0;
}

function normalizeTokenUsageSample(sample) {
  const timestamp = Number(sample?.timestamp);
  const totalTokens = Number(sample?.totalTokens);
  if (!Number.isFinite(timestamp) || !Number.isFinite(totalTokens) || totalTokens < 0) return null;
  return { timestamp, totalTokens: Math.round(totalTokens) };
}

function readTokenUsageCache(home = codexHome()) {
  try {
    const cache = JSON.parse(fs.readFileSync(tokenUsageCachePath(home), "utf8"));
    return cache?.version === 2 && cache.files && typeof cache.files === "object" ? cache : { version: 2, files: {} };
  } catch {
    return { version: 2, files: {} };
  }
}

function writeTokenUsageCache(home, files) {
  const target = tokenUsageCachePath(home);
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify({ version: 2, files }), "utf8");
    fs.renameSync(temporary, target);
  } catch {
    try {
      fs.unlinkSync(temporary);
    } catch {
    }
  }
}

function readTokenUsageHistory(home = codexHome(), nowMs = Date.now()) {
  const cache = readTokenUsageCache(home);
  const periods = ["day", "week", "month"].map((name) => ({ name, start: periodStart(nowMs, name) }));
  const sessionFiles = [
    ...walkFiles(path.join(home, "sessions")),
    ...walkFiles(path.join(home, "archived_sessions")),
  ];
  const files = {};
  const metrics = { day: 0, week: 0, month: 0, total: 0 };

  for (const file of sessionFiles) {
    const signature = `${file.mtimeMs}:${file.size}`;
    const previous = cache.files[file.path];
    const latest = previous?.signature === signature
      ? normalizeTokenUsageSample(previous.latest)
      : latestThreadTokenUsage(file);
    const baselines = {};

    if (latest) metrics.total += latest.totalTokens;

    for (const period of periods) {
      if (!latest || latest.timestamp < period.start) continue;
      const cacheKey = String(period.start);
      const cachedBaseline = Number(previous?.baselines?.[cacheKey]);
      const baseline = Number.isFinite(cachedBaseline)
        ? cachedBaseline
        : sessionFileCreatedAt(file.path) < period.start
          ? findThreadTokenUsageAtOrBefore(file, period.start)
          : 0;
      baselines[cacheKey] = baseline;
      metrics[period.name] += Math.max(0, latest.totalTokens - baseline);
    }
    files[file.path] = { signature, latest, baselines };
  }

  writeTokenUsageCache(home, files);
  return { status: "ready", metrics };
}

const ACCOUNT_USAGE_TIMEOUT_MS = 25_000;

function codexAppServerExecutable() {
  const configured = String(process.env.CODEX_BINARY || "").trim();
  if (configured && fs.existsSync(configured)) return configured;

  const binRoot = path.join(process.env.LOCALAPPDATA || "", "OpenAI", "Codex", "bin");
  try {
    const candidates = fs.readdirSync(binRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(binRoot, entry.name, "codex.exe"))
      .filter((candidate) => fs.existsSync(candidate))
      .map((candidate) => ({ candidate, mtimeMs: fs.statSync(candidate).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (candidates.length) return candidates[0].candidate;
  } catch {
  }
  return "codex.exe";
}

function appServerRequest(method, params) {
  return new Promise((resolve) => {
    let child;
    let buffer = "";
    let finished = false;
    let timeout = null;

    const finish = (result) => {
      if (finished) return;
      finished = true;
      if (timeout) clearTimeout(timeout);
      try {
        child?.stdin?.end();
      } catch {
      }
      try {
        child?.kill();
      } catch {
      }
      resolve(result || null);
    };
    const send = (message) => {
      try {
        child?.stdin?.write(`${JSON.stringify(message)}\n`);
      } catch {
        finish(null);
      }
    };

    try {
      child = cp.spawn(codexAppServerExecutable(), ["app-server", "--stdio"], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "ignore"],
      });
    } catch {
      finish(null);
      return;
    }

    child.once("error", () => finish(null));
    child.once("exit", () => {
      if (!finished) finish(null);
    });
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const message = parseJsonLine(line);
        if (!message) continue;
        if (message.id === 1) {
          send({ method: "initialized", params: {} });
          send({ id: 2, method, params });
        } else if (message.id === 2) {
          finish(message.result || null);
        }
      }
    });
    timeout = setTimeout(() => finish(null), ACCOUNT_USAGE_TIMEOUT_MS);
    send({
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "codex-thread-panel", version: "1.0.0" } },
    });
  });
}

function accountBucketTimestamp(value) {
  const text = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T00:00:00`).getTime();
  return toDate(text)?.getTime() || 0;
}

function accountTokenUsageMetrics(response, nowMs = Date.now()) {
  const total = Number(response?.summary?.lifetimeTokens);
  if (!Number.isFinite(total) || total < 0) return null;

  const metrics = { day: 0, week: 0, month: 0, total: Math.round(total), source: "account" };
  const periods = ["day", "week", "month"].map((name) => ({ name, start: periodStart(nowMs, name) }));
  for (const bucket of Array.isArray(response?.dailyUsageBuckets) ? response.dailyUsageBuckets : []) {
    const timestamp = accountBucketTimestamp(bucket?.startDate);
    const tokens = Number(bucket?.tokens);
    if (!timestamp || !Number.isFinite(tokens) || tokens < 0) continue;
    for (const period of periods) {
      if (timestamp >= period.start) metrics[period.name] += Math.round(tokens);
    }
  }
  return metrics;
}

async function readTokenUsageSnapshot(home = codexHome(), nowMs = Date.now()) {
  const accountRequest = appServerRequest("account/usage/read", {});
  const localHistory = readTokenUsageHistory(home, nowMs);
  const accountMetrics = accountTokenUsageMetrics(await accountRequest, nowMs);
  if (accountMetrics) return { status: "ready", metrics: accountMetrics };
  return localHistory;
}

function safePercent(value) {
  const number = Number(value || 0);
  return Math.max(0, Math.min(100, Math.round(number)));
}

function remainingPercent(value) {
  return Math.max(0, Math.min(100, 100 - safePercent(value)));
}

function periodStart(nowMs, period) {
  const date = new Date(nowMs);
  date.setHours(0, 0, 0, 0);
  if (period === "week") {
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  } else if (period === "month") {
    date.setDate(1);
  }
  return date.getTime();
}

function tokenUsageMetrics(history) {
  if (history?.status !== "ready") {
    return { status: history?.status || "loading", day: null, week: null, month: null, total: null };
  }
  return {
    status: "ready",
    day: Number(history.metrics?.day || 0),
    week: Number(history.metrics?.week || 0),
    month: Number(history.metrics?.month || 0),
    total: Number(history.metrics?.total || 0),
  };
}

function quotaHealth(window, nowMs = Date.now()) {
  const remaining = remainingPercent(window?.used_percent);
  const durationMs = Number(window?.window_minutes) * 60 * 1000;
  const resetMs = Number(window?.resets_at) * 1000;
  const hasResetSchedule = Number.isFinite(durationMs) && durationMs > 0
    && Number.isFinite(resetMs) && resetMs > nowMs;

  if (!hasResetSchedule) {
    if (remaining <= 10) return "critical";
    if (remaining <= 30) return "moderate";
    return "good";
  }

  const timeRemaining = Math.max(0, Math.min(100, ((resetMs - nowMs) / durationMs) * 100));
  const pacingGap = remaining - timeRemaining;

  if (remaining === 0 || (remaining <= 5 && timeRemaining > 15) || pacingGap < -25) {
    return "critical";
  }
  if ((remaining <= 15 && timeRemaining > 35) || pacingGap < -10) {
    return "moderate";
  }
  return "good";
}

function quotaHealthText(language, health) {
  if (health === "critical") return ui(language, "quotaCritical");
  if (health === "moderate") return ui(language, "quotaModerate");
  return ui(language, "quotaGood");
}

function quotaHealthColor(health) {
  if (health === "critical") return COLORS.red;
  if (health === "moderate") return COLORS.orange;
  return COLORS.green;
}

function quotaName(minutes, language) {
  const n = Number(minutes || 0);
  if (n === 300) return ui(language, "fiveHourLimit");
  if (n === 10080) return ui(language, "weeklyLimit");
  return ui(language, "minuteLimit", { minutes: n });
}

function resetInfo(epochSeconds, language) {
  if (!epochSeconds) return ui(language, "resetUnknown");
  const reset = new Date(Number(epochSeconds) * 1000);
  const diff = reset.getTime() - Date.now();
  if (diff <= 0) return ui(language, "resetReached", { time: formatDate(reset).slice(11) });
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return ui(language, "resetDays", { days, hours, time: formatDate(reset).slice(5) });
  if (hours > 0) return ui(language, "resetHours", { hours, minutes, time: formatDate(reset).slice(11) });
  return ui(language, "resetMinutes", { minutes, seconds, time: formatDate(reset).slice(11) });
}

function filterThreads(threads, includeArchived, search) {
  const query = singleLine(search).toLowerCase();
  return threads.filter((thread) => {
    if (!includeArchived && thread.archived) return false;
    if (!query) return true;
    const haystack = `${thread.title}\n${thread.cwd}\n${thread.id}\n${thread.model}\n${thread.project}`.toLowerCase();
    return haystack.includes(query);
  });
}

function groupProjects(threads, includeArchived, search) {
  const filtered = filterThreads(threads, includeArchived, search);
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
  const visibleThreads = filterThreads(threads, includeArchived, search);
  const pinnedThreads = visibleThreads
    .filter((thread) => thread.pinned)
    .sort((a, b) => a.pinnedOrder - b.pinnedOrder);
  if (pinnedThreads.length) {
    const pinnedProject = {
      cwd: PINNED_SECTION_CWD,
      name: PINNED_SECTION_NAME,
      threads: pinnedThreads,
      latest: pinnedThreads.reduce((latest, thread) => (
        !latest || (thread.updated?.getTime() || 0) > (latest.getTime() || 0) ? thread.updated : latest
      ), null),
    };
    const isExpanded = expanded.has(PINNED_SECTION_CWD);
    nodes.push({ type: "pinned", project: pinnedProject, cwd: PINNED_SECTION_CWD, expanded: isExpanded });
    if (isExpanded) {
      for (const thread of pinnedThreads) {
        nodes.push({ type: "thread", project: pinnedProject, thread, cwd: PINNED_SECTION_CWD });
      }
    }
  }

  for (const project of groupProjects(visibleThreads.filter((thread) => !thread.pinned), true, "")) {
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
    const align = typeof item === "object" ? item.align : "left";
    const body = align === "right" ? padLeft(text, width - 2) : pad(text, width - 2);
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

function detailLines(node, language) {
  if (!node) return [{ text: ui(language, "noSelection"), color: COLORS.yellow }];
  if (node.type === "pinned") {
    const p = node.project;
    return [
      ...labelValueRows(language, [
        { label: ui(language, "type"), value: ui(language, "pinnedSection"), color: COLORS.dark },
        { label: ui(language, "threads"), value: p.threads.length, color: COLORS.gray },
        { label: ui(language, "state"), value: ui(language, node.expanded ? "expanded" : "collapsed"), color: COLORS.gray },
      ]),
      { text: ui(language, "pinnedEnter"), color: COLORS.dark },
    ];
  }
  if (node.type === "project") {
    const p = node.project;
    const name = displayProjectName(p.name, language);
    return [
      ...labelValueRows(language, [
        { label: ui(language, "type"), value: ui(language, "project"), color: COLORS.dark },
        { label: ui(language, "name"), value: name, color: COLORS.white },
        { label: ui(language, "threads"), value: p.threads.length, color: COLORS.gray },
        { label: ui(language, "state"), value: ui(language, node.expanded ? "expanded" : "collapsed"), color: COLORS.gray },
        { label: ui(language, "latest"), value: formatDate(p.latest), color: COLORS.gray },
        { label: ui(language, "path"), value: p.cwd || ui(language, "unknown"), color: COLORS.gray },
      ]),
      { text: ui(language, "projectEnter"), color: COLORS.dark },
      { text: ui(language, "projectNew"), color: COLORS.dark },
    ];
  }
  const t = node.thread;
  return [
    ...labelValueRows(language, [
      { label: ui(language, "type"), value: ui(language, "thread"), color: COLORS.dark },
      { label: ui(language, "threadTitle"), value: t.title, color: COLORS.white },
      { label: ui(language, "updated"), value: t.updatedText, color: COLORS.gray },
      { label: ui(language, "project"), value: displayProjectName(t.project, language), color: COLORS.gray },
      { label: ui(language, "model"), value: t.model || "-", color: COLORS.gray },
      { label: ui(language, "tokens"), value: t.tokensUsed ? t.tokensUsed.toLocaleString(language === "zh" ? "zh-CN" : "en-US") : "-", color: COLORS.gray },
      { label: ui(language, "archived"), value: ui(language, t.archived ? "yes" : "no"), color: t.archived ? COLORS.yellow : COLORS.gray },
      { label: ui(language, "pinned"), value: ui(language, t.pinned ? "yes" : "no"), color: t.pinned ? COLORS.yellow : COLORS.gray },
      { label: ui(language, "id"), value: t.id, color: COLORS.dark },
      { label: ui(language, "path"), value: t.cwd || ui(language, "unknown"), color: COLORS.gray },
    ]),
    { text: ui(language, "threadOpen"), color: COLORS.dark },
  ];
}

function statsLines(threads, nodes, includeArchived, search, language) {
  const projects = new Set(threads.map((t) => t.cwd || "(unknown)"));
  const active = threads.filter((t) => !t.archived).length;
  const archived = threads.length - active;
  const rows = [
    { label: ui(language, "codexHome"), value: codexHome(), color: COLORS.dark },
    { label: ui(language, "projects"), value: projects.size, color: COLORS.gray },
    { label: ui(language, "threads"), value: ui(language, "threadSummary", { total: threads.length, active, archived }), color: COLORS.gray },
    { label: ui(language, "visibleNodes"), value: nodes.length, color: COLORS.gray },
    { label: ui(language, "archiveFilter"), value: ui(language, includeArchived ? "shown" : "hidden"), color: COLORS.gray },
    { label: ui(language, "search"), value: search || ui(language, "none"), color: COLORS.gray },
  ];
  return labelValueRows(language, rows);
}

function keyLines(promptMode, language, availableLines = 0, petId = "cat") {
  if (promptMode === "permission") {
    return [
      { text: ui(language, "permissionChoose"), color: COLORS.white },
      { text: `1 ${ui(language, "modeSafe")}：${ui(language, "modeSafeLabel")}`, color: COLORS.gray },
      { text: `2 ${ui(language, "modeNormal")}：${ui(language, "modeNormalLabel")}`, color: COLORS.green },
      { text: `3 ${ui(language, "modeAuto")}：${ui(language, "modeAutoLabel")}`, color: COLORS.yellow },
      { text: `4 ${ui(language, "modeFull")}：${ui(language, "modeFullLabel")}`, color: COLORS.red },
      { text: ui(language, "escCancel"), color: COLORS.gray },
    ];
  }
  if (promptMode) {
    return [
      { text: ui(language, "inputApply"), color: COLORS.white },
      { text: ui(language, "inputCancel"), color: COLORS.gray },
      { text: ui(language, "backspaceDelete"), color: COLORS.gray },
    ];
  }
  const compact = [
    { text: `${ui(language, "keyLanguageQuit")} | ${language === "zh" ? "1-4：宠物" : "1-4: pets"}`, color: COLORS.white },
    { text: ui(language, "keyNavigation"), color: COLORS.gray },
    { text: `${ui(language, "keyThreadActions")} | ${ui(language, "keyOtherActions")}`, color: COLORS.gray },
  ];
  const detailed = [
    { text: ui(language, "switchLanguage"), color: COLORS.white },
    { text: campyPetShortcutText(language), color: COLORS.cyan },
    { text: ui(language, "quit"), color: COLORS.gray },
    { text: ui(language, "moveSelection"), color: COLORS.gray },
    { text: ui(language, "expandOpen"), color: COLORS.gray },
    { text: ui(language, "collapseParent"), color: COLORS.gray },
    { text: ui(language, "openThread"), color: COLORS.gray },
    { text: ui(language, "newThread"), color: COLORS.gray },
    { text: ui(language, "archiveThread"), color: COLORS.yellow },
    { text: ui(language, "renameThread"), color: COLORS.gray },
    { text: ui(language, "openFolder"), color: COLORS.gray },
    { text: ui(language, "searchShortcut"), color: COLORS.gray },
    { text: ui(language, "archiveToggle"), color: COLORS.gray },
    { text: ui(language, "refresh"), color: COLORS.gray },
  ];
  const widget = campyPetWidget(petId, language);
  const frame = widget.slice(1);
  const base = availableLines >= detailed.length + frame.length ? detailed : compact;
  if (availableLines >= base.length + widget.length + 1) {
    return [
      ...base,
      ...Array.from({ length: availableLines - base.length - widget.length }, () => ({ text: "", color: COLORS.gray })),
      ...widget,
    ];
  }
  if (availableLines < base.length + frame.length) return base;
  return [
    ...base,
    ...Array.from({ length: availableLines - base.length - frame.length }, () => ({ text: "", color: COLORS.gray })),
    ...frame,
  ];
}

function formatTokenCount(value) {
  const total = Math.max(0, Math.round(Number(value || 0)));
  const yi = total / 100_000_000;
  const precision = total >= 100_000_000 ? 2 : total >= 1_000_000 ? 3 : 6;
  return `${Number(yi.toFixed(precision))}亿`;
}

const API_EQUIVALENT_INPUT_USD_PER_MILLION = 1.25;
const API_EQUIVALENT_OUTPUT_USD_PER_MILLION = 10;
const API_EQUIVALENT_INPUT_SHARE = 0.5;
const API_EQUIVALENT_CNY_PER_USD = 7.2;

function formatApiEquivalentCost(value, language) {
  const tokens = Number(value);
  if (!Number.isFinite(tokens) || tokens < 0) return ui(language, "quotaUsageUnavailable");
  const blendedUsdPerMillion = API_EQUIVALENT_INPUT_USD_PER_MILLION * API_EQUIVALENT_INPUT_SHARE
    + API_EQUIVALENT_OUTPUT_USD_PER_MILLION * (1 - API_EQUIVALENT_INPUT_SHARE);
  const usd = (tokens / 1_000_000) * blendedUsdPerMillion;
  if (language !== "zh") return `~$${Math.round(usd / 10_000) * 10}k`;
  const wan = (usd * API_EQUIVALENT_CNY_PER_USD) / 10_000;
  return `约￥${Math.round(wan / 10) * 10}万`;
}

function tokenUsageValue(value, metrics, language) {
  if (Number.isFinite(value)) return formatTokenCount(value);
  if (metrics?.status === "loading") return ui(language, "quotaUsagePending");
  return ui(language, "quotaUsageUnavailable");
}

function quotaLines(quota, metrics, language) {
  const total = tokenUsageValue(metrics?.total, metrics, language);
  const usageLines = [
    {
      text: ui(language, "tokenUsageSummary", {
        day: tokenUsageValue(metrics?.day, metrics, language),
        week: tokenUsageValue(metrics?.week, metrics, language),
        month: tokenUsageValue(metrics?.month, metrics, language),
      }),
      color: COLORS.cyan,
    },
    {
      text: Number.isFinite(metrics?.total)
        ? ui(language, "tokenUsageTotal", { total, apiCost: formatApiEquivalentCost(metrics.total, language) })
        : ui(language, "tokenUsageTotalPending", { total }),
      color: COLORS.cyan,
    },
  ];
  if (!quota?.rate) {
    return [
      { text: ui(language, "quotaUnavailable"), color: COLORS.yellow },
      { text: ui(language, "quotaHint"), color: COLORS.gray },
      ...usageLines,
      { text: `${ui(language, "now")}：${formatDate(new Date(), true)}`, color: COLORS.cyan },
    ];
  }
  const rate = quota.rate;
  const windows = [rate.primary, rate.secondary].filter((window) => Number(window?.window_minutes) > 0);
  return [
    { text: ui(language, "planLastQuota", { plan: displayPlan(rate.plan_type, language), time: formatDate(quota.timestamp, true) }), color: COLORS.cyan },
    ...windows.map((window) => {
      const health = quotaHealth(window);
      return {
        text: ui(language, "quotaRemaining", {
          window: quotaName(window.window_minutes, language),
          remaining: remainingPercent(window.used_percent),
          used: safePercent(window.used_percent),
          health: quotaHealthText(language, health),
          reset: resetInfo(window.resets_at, language),
        }),
        color: quotaHealthColor(health),
      };
    }),
    ...usageLines,
    { text: `${ui(language, "now")}：${formatDate(new Date(), true)}`, color: COLORS.cyan },
  ];
}

function layout() {
  const width = Math.max(1, process.stdout.columns || 120);
  const height = Math.max(1, process.stdout.rows || 36);
  const leftWidth = Math.max(46, Math.floor(width * 0.5));
  const rightWidth = Math.max(1, width - leftWidth);
  const bodyHeight = height - 2;
  const quotaHeight = 8;
  const detailsHeight = 12;
  const statsHeight = 8;
  const keysHeight = Math.max(5, bodyHeight - quotaHeight - detailsHeight - statsHeight);
  return { width, height, leftWidth, rightWidth, bodyHeight, detailsHeight, statsHeight, keysHeight, quotaHeight };
}

function treeContent(nodes, selectedIndex, scrollTop, treeHeight, width, language) {
  const rows = [];
  const visible = Math.max(1, treeHeight - 3);
  const threadIndent = "     ";
  const projectCountWidth = Math.max(3, ...nodes
    .filter((node) => node.type === "project" || node.type === "pinned")
    .map((node) => displayWidth(`(${node.project.threads.length})`)));
  const projectDateWidth = 16;
  const projectPrefixWidth = displayWidth(" [+] ");
  const projectNameWidth = Math.max(8, width - 2 - projectPrefixWidth - projectCountWidth - projectDateWidth - 2);
  for (let row = 0; row < visible; row++) {
    const index = scrollTop + row;
    if (index >= nodes.length) {
      rows.push({ text: "", color: COLORS.gray });
      continue;
    }
    const node = nodes[index];
    const isSelected = index === selectedIndex;
    if (node.type === "project" || node.type === "pinned") {
      const mark = node.expanded ? "[-]" : "[+]";
      rows.push({
        text: formatColumns([
          { text: ` ${mark} ` },
          { text: displayProjectName(node.project.name, language), width: projectNameWidth },
          { text: " " },
          { text: `(${node.project.threads.length})`, width: projectCountWidth, align: "right" },
          { text: " " },
          { text: node.type === "pinned" ? "" : formatDate(node.project.latest), width: projectDateWidth },
        ]),
        color: COLORS.white,
        selected: isSelected,
      });
    } else {
      const t = node.thread;
      const markers = t.archived ? ui(language, "archiveMarker") : "";
      const time = t.updatedText ? t.updatedText.slice(5) : "";
      const prefix = `${threadIndent}${pad(markers, 4)}${time}  `;
      rows.push({
        text: `${prefix}${truncate(t.title, Math.max(8, width - displayWidth(prefix) - 2))}`,
        color: t.archived ? COLORS.yellow : COLORS.gray,
        selected: isSelected,
      });
    }
  }
  if (scrollTop > 0 && rows.length) rows[0] = { text: ui(language, "moreAbove"), color: COLORS.yellow };
  if (scrollTop + visible < nodes.length && rows.length) rows[rows.length - 1] = { text: ui(language, "moreBelow"), color: COLORS.yellow };
  return rows;
}

function makeFrame(state) {
  const l = layout();
  const language = state.language || "zh";
  if (l.width < 92 || l.height < 26) {
    return [
      style(pad(ui(language, "title"), l.width), COLORS.white),
      style(pad(ui(language, "terminalTooSmall"), l.width), COLORS.yellow),
      style(pad(ui(language, "terminalCurrent", { width: l.width, height: l.height }), l.width), COLORS.gray),
      ...Array.from({ length: Math.max(0, l.height - 3) }, () => " ".repeat(l.width)),
    ].slice(0, l.height);
  }

  const nodes = state.nodes;
  const selected = selectedNode(nodes, state.selectedIndex);
  const left = panel(l.leftWidth, l.bodyHeight, ui(language, "projectsThreads"), [
    { text: `${ui(language, "archived")}：${ui(language, state.includeArchived ? "shown" : "hidden")} | ${ui(language, "search")}：${state.search || ui(language, "none")}`, color: COLORS.dark },
    ...treeContent(nodes, state.selectedIndex, state.scrollTop, l.bodyHeight - 1, l.leftWidth, language),
  ]);
  const rightParts = [
    ...panel(l.rightWidth, l.detailsHeight, ui(language, "selection"), detailLines(selected, language)),
    ...panel(l.rightWidth, l.statsHeight, ui(language, "workspace"), statsLines(state.threads, nodes, state.includeArchived, state.search, language)),
    ...panel(l.rightWidth, l.keysHeight, ui(language, "keys"), keyLines(state.promptMode, language, l.keysHeight - 2, state.petId)),
    ...panel(l.rightWidth, l.quotaHeight, ui(language, "quota"), quotaLines(state.quota, state.tokenUsageMetrics, language)),
  ];

  const lines = [];
  lines.push(style(pad(ui(language, "title"), l.width), COLORS.white));
  for (let i = 0; i < l.bodyHeight; i++) {
    lines.push((left[i] || " ".repeat(l.leftWidth)) + (rightParts[i] || " ".repeat(l.rightWidth)));
  }
  let status = state.status || ui(language, "ready");
  if (state.promptMode === "search") status = `${ui(language, "searchPrompt")} ${state.promptBuffer}`;
  if (state.promptMode === "path") status = `${ui(language, "pathPrompt")} ${state.promptBuffer}`;
  if (state.promptMode === "rename") status = `${ui(language, "renamePrompt")} ${state.promptBuffer}`;
  if (state.promptMode === "permission") status = ui(language, "permissionPrompt");
  lines.push(style(pad(status, l.width), COLORS.dark));
  return lines.slice(0, l.height);
}

function cursorColumnForPrompt(state) {
  if (!state.promptMode) return null;
  const language = state.language || "zh";
  let prefix = "";
  if (state.promptMode === "search") prefix = `${ui(language, "searchPrompt")} `;
  else if (state.promptMode === "path") prefix = `${ui(language, "pathPrompt")} `;
  else if (state.promptMode === "rename") prefix = `${ui(language, "renamePrompt")} `;
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

function nodeIdentity(node) {
  if (node?.type === "thread") return `thread:${node.thread.id}`;
  if (node?.type === "project" || node?.type === "pinned") return `project:${node.project.cwd}`;
  return "";
}

function isGroupNode(node) {
  return node?.type === "project" || node?.type === "pinned";
}

function rebuildNodes(state, preserveSelection = false) {
  const selected = preserveSelection ? nodeIdentity(state.nodes[state.selectedIndex]) : "";
  state.nodes = buildNodes(state.threads, state.expanded, state.includeArchived, state.search);
  if (selected) {
    const index = state.nodes.findIndex((node) => nodeIdentity(node) === selected);
    if (index >= 0) state.selectedIndex = index;
  }
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
  if (node.type === "project" || node.type === "pinned") return node.project.name;
  if (node.type === "thread") return node.thread.project;
  return "";
}

const PERMISSION_MODES = {
  "1": {
    id: "Safe",
    name: "Safe",
    label: "read-only + on-request",
    args: ["--sandbox", "read-only", "--ask-for-approval", "on-request"],
  },
  "2": {
    id: "Normal",
    name: "Normal",
    label: "workspace-write + on-request",
    args: ["--sandbox", "workspace-write", "--ask-for-approval", "on-request"],
  },
  "3": {
    id: "Auto",
    name: "Auto",
    label: "workspace-write + never",
    args: ["--sandbox", "workspace-write", "--ask-for-approval", "never"],
  },
  "4": {
    id: "Full",
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

function openThread(thread, permissionMode = PERMISSION_MODES["2"], language = "zh") {
  if (!thread?.id) return false;
  const commands = [];
  if (thread.cwd && fs.existsSync(thread.cwd)) {
    commands.push(`Set-Location -LiteralPath ${psQuote(thread.cwd)}`);
  }
  const modelArgs = codexThreadModelArgString(thread);
  commands.push(`codex resume ${codexPermissionArgs(permissionMode)}${modelArgs ? ` ${modelArgs}` : ""} ${psQuote(thread.id)}`);
  return startPowerShell(commands, `Codex - ${displayProjectName(thread.project || "(unknown)", language)} - ${permissionModeName(permissionMode, language)}`);
}

function newThread(cwd, permissionMode = PERMISSION_MODES["2"], language = "zh") {
  if (!cwd || !fs.existsSync(cwd)) return false;
  return startPowerShell([
    `Set-Location -LiteralPath ${psQuote(cwd)}`,
    `codex -C ${psQuote(cwd)} ${codexPermissionArgs(permissionMode)} ${psQuote("新建对话线程")}`,
  ], `Codex - ${displayProjectName(projectName(cwd), language)} - ${permissionModeName(permissionMode, language)}`);
}

function openFolder(cwd) {
  if (!cwd || !fs.existsSync(cwd)) return false;
  cp.spawn("explorer.exe", [cwd], { detached: true, stdio: "ignore" }).unref();
  return true;
}

function handlePromptInput(state, key) {
  const language = state.language || "zh";
  if (isIgnoredTerminalInput(key)) return;
  if (key === "\x1b") {
    state.promptMode = "";
    state.promptBuffer = "";
    state.promptCursor = 0;
    state.pendingAction = null;
    state.status = ui(language, "inputCancelled");
    return;
  }

  if (state.promptMode === "permission") {
    const mode = PERMISSION_MODES[key];
    if (!mode) {
      state.status = ui(language, "choosePermission");
      return;
    }

    const action = state.pendingAction;
    state.promptMode = "";
    state.promptBuffer = "";
    state.promptCursor = 0;
    state.pendingAction = null;

    if (!action) {
      state.status = ui(language, "noPendingAction");
      return;
    }
    if (["open", "new"].includes(action.type)) {
      const now = Date.now();
      if (now - Number(state.lastWindowLaunchAt || 0) < 1200) {
        state.status = ui(language, "duplicateLaunch");
        return;
      }
      state.lastWindowLaunchAt = now;
    }

    if (action.type === "open" && action.thread) {
      if (openThread(action.thread, mode, language)) state.status = ui(language, "openedThread", { mode: permissionModeName(mode, language), title: action.thread.title });
      else state.status = ui(language, "openThreadFailed");
      return;
    }

    if (action.type === "new" && action.cwd) {
      if (newThread(action.cwd, mode, language)) state.status = ui(language, "startedThread", { mode: permissionModeName(mode, language), path: action.cwd });
      else state.status = ui(language, "startThreadFailed", { path: action.cwd });
      return;
    }

    if (action.type === "newPath") {
      state.promptMode = "path";
      state.promptBuffer = "";
      state.promptCursor = 0;
      state.pendingPermission = mode;
      state.status = ui(language, "enterProjectPath", { mode: permissionModeName(mode, language) });
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
      state.status = value ? ui(language, "searchApplied", { value }) : ui(language, "searchCleared");
      rebuildNodes(state);
    } else if (state.promptMode === "path") {
      if (newThread(value, state.pendingPermission || PERMISSION_MODES["2"], language)) state.status = ui(language, "startedThreadIn", { path: value });
      else state.status = ui(language, "invalidProjectPath", { path: value });
      state.pendingPermission = null;
    } else if (state.promptMode === "rename") {
      const thread = state.pendingAction?.thread;
      if (thread && renameThread(thread, value)) {
        state.threads = readThreads();
        state.threadDataSignature = threadDataSignature();
        state.status = ui(language, "renamedThread", { title: value });
        rebuildNodes(state);
      } else {
        state.status = ui(language, "renameFailed");
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
  const language = state.language || "zh";
  if (isIgnoredTerminalInput(key)) {
    state.status = ui(language, "ignoredTerminalInput");
    return true;
  }

  if (state.promptMode) {
    handlePromptInput(state, key);
    return true;
  }

  const petId = CAMPY_PET_ID_BY_KEY[key];
  if (petId) {
    state.petId = petId;
    state.status = language === "zh"
      ? `已切换为 ${currentCampyPet(petId).names.zh}`
      : `Switched to ${currentCampyPet(petId).names.en}`;
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
    if (isGroupNode(node)) {
      state.expanded.add(node.project.cwd);
      state.status = ui(language, "expandedProject", { name: displayProjectName(node.project.name, language) });
      rebuildNodes(state);
    }
    return true;
  }
  if (key === "\x1b[D") {
    if (isGroupNode(node)) {
      state.expanded.delete(node.project.cwd);
      state.status = ui(language, "collapsedProject", { name: displayProjectName(node.project.name, language) });
      rebuildNodes(state);
    } else if (node?.type === "thread") {
      const parentIndex = state.nodes.findIndex((item) => isGroupNode(item) && item.project.cwd === node.project.cwd);
      if (parentIndex >= 0) state.selectedIndex = parentIndex;
      ensureSelectionVisible(state);
    }
    return true;
  }
  if (key === "\r" || key === "\n") {
    if (isGroupNode(node)) {
      if (state.expanded.has(node.project.cwd)) {
        state.expanded.delete(node.project.cwd);
        state.status = ui(language, "collapsedProject", { name: displayProjectName(node.project.name, language) });
      } else {
        state.expanded.add(node.project.cwd);
        state.status = ui(language, "expandedProject", { name: displayProjectName(node.project.name, language) });
      }
      rebuildNodes(state);
    } else if (node?.type === "thread") {
      state.promptMode = "permission";
      state.pendingAction = { type: "open", thread: node.thread };
      state.status = ui(language, "chooseThreadPermission", { title: node.thread.title });
    }
    return true;
  }
  const lower = key.toLowerCase();
  if (lower === "o") {
    if (node?.type === "thread") {
      state.promptMode = "permission";
      state.pendingAction = { type: "open", thread: node.thread };
      state.status = ui(language, "chooseThreadPermission", { title: node.thread.title });
    } else {
      state.status = ui(language, "selectThreadFirst");
    }
    return true;
  }
  if (lower === "n") {
    const cwd = selectedProjectCwd(node);
    if (cwd) {
      state.promptMode = "permission";
      state.pendingAction = { type: "new", cwd };
      state.status = ui(language, "chooseNewPermission", { path: cwd });
    }
    else {
      state.promptMode = "permission";
      state.pendingAction = { type: "newPath" };
      state.status = ui(language, "choosePathPermission");
    }
    return true;
  }
  if (lower === "f") {
    const cwd = selectedProjectCwd(node);
    if (openFolder(cwd)) state.status = ui(language, "openedFolder", { path: cwd });
    else state.status = ui(language, "invalidProjectFolder");
    return true;
  }
  if (lower === "d") {
    if (node?.type !== "thread") {
      state.status = ui(language, "selectThreadArchive");
      return true;
    }
    if (archiveThread(node.thread)) {
      state.threads = readThreads();
      state.threadDataSignature = threadDataSignature();
      state.status = ui(language, "archivedThread", { title: node.thread.title });
      rebuildNodes(state);
    } else {
      state.status = ui(language, "archiveFailed");
    }
    return true;
  }
  if (lower === "t") {
    if (node?.type !== "thread") {
      state.status = ui(language, "selectThreadRename");
      return true;
    }
    state.promptMode = "rename";
    state.promptBuffer = node.thread.title;
    state.promptCursor = Array.from(state.promptBuffer).length;
    state.pendingAction = { type: "rename", thread: node.thread };
    state.status = ui(language, "enterNewTitle", { title: node.thread.title });
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
    state.status = ui(language, state.includeArchived ? "archivedShown" : "archivedHidden");
    rebuildNodes(state);
    return true;
  }
  if (lower === "r") {
    state.threads = readThreads();
    state.threadDataSignature = threadDataSignature();
    state.quota = readLatestQuota();
    state.tokenUsageMetrics = tokenUsageMetrics(state.tokenUsageHistory);
    state.selectedIndex = 0;
    state.scrollTop = 0;
    state.status = ui(language, "refreshedData");
    rebuildNodes(state);
    renderer.reset();
    return true;
  }
  if (lower === "e" && isGroupNode(node)) {
    for (const project of groupProjects(state.threads, state.includeArchived, state.search)) {
      state.expanded.add(project.cwd);
    }
    if (state.nodes.some((item) => item.type === "pinned")) state.expanded.add(PINNED_SECTION_CWD);
    state.status = ui(language, "expandedAll");
    rebuildNodes(state);
    return true;
  }
  if (lower === "c" && isGroupNode(node)) {
    state.expanded.clear();
    state.status = ui(language, "collapsedAll");
    rebuildNodes(state);
    return true;
  }
  if (lower === "l") {
    state.language = language === "zh" ? "en" : "zh";
    state.status = ui(state.language, "languageChanged", { language: ui(state.language, state.language === "zh" ? "languageChinese" : "languageEnglish") });
    return true;
  }
  state.status = ui(language, "unhandledKey", { name: displayProjectName(selectedProjectName(node) || "(unknown)", language) });
  return true;
}

function startTokenUsageWorker(onResult) {
  let settled = false;
  const settle = (result) => {
    if (settled) return;
    settled = true;
    onResult(result);
  };
  try {
    const worker = new Worker(__filename, { workerData: { task: "token-usage-history", home: codexHome() } });
    worker.once("message", settle);
    worker.once("error", () => settle({ status: "unavailable", metrics: {} }));
    worker.once("exit", (code) => {
      if (code !== 0) settle({ status: "unavailable", metrics: {} });
    });
    worker.unref();
    return worker;
  } catch {
    setImmediate(() => settle({ status: "unavailable", metrics: {} }));
    return null;
  }
}

function main() {
  const state = {
    threads: readThreads(),
    threadDataSignature: threadDataSignature(),
    quota: readLatestQuota(),
    tokenUsageHistory: { status: "loading", metrics: {} },
    tokenUsageMetrics: null,
    tokenUsageWorker: null,
    petId: "cat",
    language: "zh",
    expanded: new Set([PINNED_SECTION_CWD]),
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
    status: ui("zh", "initialStatus"),
  };
  state.tokenUsageMetrics = tokenUsageMetrics(state.tokenUsageHistory);
  rebuildNodes(state);

  if (process.argv.includes("--check")) {
    const projects = new Set(state.threads.map((t) => t.cwd || "(unknown)"));
    const quotaWindows = [state.quota?.rate?.primary, state.quota?.rate?.secondary]
      .filter((window) => Number(window?.window_minutes) > 0)
      .map((window) => `${window.window_minutes}m ${safePercent(window.used_percent)}% used`)
      .join(" | ");
    console.log(`CodexHome: ${codexHome()}`);
    console.log(`Threads: ${state.threads.length}`);
    console.log(`Projects: ${projects.size}`);
    console.log(`Quota: ${state.quota?.rate ? `${displayPlan(state.quota.rate.plan_type, "en")} | ${quotaWindows || "no usage windows"}` : "not found"}`);
    console.log(`RolloutTitlesVisible: ${state.threads.filter((t) => isRolloutName(t.title)).length}`);
    const overrideProbe = state.threads.find((t) => t.id === "019dc5a6-6acc-7f30-8d1b-690ab326fb40");
    if (overrideProbe) console.log(`OverrideProbeTitle: ${overrideProbe.title}`);
    return;
  }

  const renderer = new Renderer();
  let running = true;
  let resizeTimer = null;

  function cleanup() {
    if (resizeTimer) clearTimeout(resizeTimer);
    state.tokenUsageWorker?.terminate();
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

  let lastQuotaRead = Date.now();
  let lastTokenUsageHistoryRefresh = Date.now();
  let lastThreadSignatureCheck = 0;
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

  function updateTokenUsageMetrics() {
    state.tokenUsageMetrics = tokenUsageMetrics(state.tokenUsageHistory);
  }

  function refreshTokenUsageHistory() {
    if (state.tokenUsageWorker) return;
    state.tokenUsageWorker = startTokenUsageWorker((history) => {
      state.tokenUsageWorker = null;
      state.tokenUsageHistory = history?.status === "ready" ? history : { status: "unavailable", metrics: {} };
      updateTokenUsageMetrics();
      if (running) render();
    });
  }

  function syncTerminalSize() {
    if (process.stdout.columns === lastColumns && process.stdout.rows === lastRows) return false;
    lastColumns = process.stdout.columns;
    lastRows = process.stdout.rows;
    ensureSelectionVisible(state);
    return true;
  }

  function scheduleResizeRender() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      if (running && syncTerminalSize()) render();
    }, 75);
  }

  if (process.stdout.isTTY) process.stdout.on("resize", scheduleResizeRender);

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
    syncTerminalSize();
    if (Date.now() - lastThreadSignatureCheck >= 5000) {
      const signature = threadDataSignature();
      lastThreadSignatureCheck = Date.now();
      if (signature !== state.threadDataSignature) {
        state.threads = readThreads();
        state.threadDataSignature = signature;
        rebuildNodes(state, true);
      }
    }
    if (Date.now() - lastQuotaRead > 10000) {
      state.quota = readLatestQuota();
      lastQuotaRead = Date.now();
      updateTokenUsageMetrics();
    }
    if (Date.now() - lastTokenUsageHistoryRefresh > 600000) {
      lastTokenUsageHistoryRefresh = Date.now();
      refreshTokenUsageHistory();
    }
    render();
  }, 1000);

  render();
  refreshTokenUsageHistory();
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

if (!isMainThread && workerData?.task === "token-usage-history") {
  readTokenUsageSnapshot(workerData.home)
    .then((result) => parentPort?.postMessage(result))
    .catch(() => parentPort?.postMessage({ status: "unavailable", metrics: {} }));
} else {
  main();
}
