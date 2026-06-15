/* global chrome */

const EXPORT_FORMAT = {
  magic: "sExport",
  kind: "tabs",
  version: "v1"
};

const WINDOW_TYPES = ["normal", "popup"];

function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: #${id}`);
  return el;
}

function nowStampForFilename(date = new Date()) {
  const pad2 = (n) => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mm = pad2(date.getMinutes());
  const ss = pad2(date.getSeconds());
  return `${y}-${m}-${d}_${hh}-${mm}-${ss}`;
}

function enc(v) {
  return encodeURIComponent(v ?? "");
}

function setStatus(text) {
  $("status").textContent = text;
}

function chromePromisify(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result);
    });
  });
}

function windowsGetAll(options) {
  return chromePromisify(chrome.windows.getAll, options);
}

function tabGroupsQuery(queryInfo) {
  return chromePromisify(chrome.tabGroups.query, queryInfo);
}

function downloadsDownload(options) {
  return chromePromisify(chrome.downloads.download, options);
}

function windowsCreate(options) {
  return chromePromisify(chrome.windows.create, options);
}

function tabsUpdate(tabId, options) {
  return chromePromisify(chrome.tabs.update, tabId, options);
}

function tabsCreate(options) {
  return chromePromisify(chrome.tabs.create, options);
}

function tabsGroup(options) {
  return chromePromisify(chrome.tabs.group, options);
}

function tabGroupsUpdate(groupId, options) {
  return chromePromisify(chrome.tabGroups.update, groupId, options);
}

function tabsRemove(tabId) {
  return chromePromisify(chrome.tabs.remove, tabId);
}

function safeTabTitle(tab) {
  const title = (tab?.title ?? "").trim();
  if (title) return title;
  const url = (tab?.pendingUrl ?? tab?.url ?? "").trim();
  return url || "(untitled)";
}

function toBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function downloadTextFile({ text, filename }) {
  // Avoid huge `data:` URLs (Chrome may truncate long URLs). Prefer a `blob:` URL, with a base64 `data:` fallback.
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const blobUrl = URL.createObjectURL(blob);

  try {
    await downloadsDownload({
      url: blobUrl,
      filename,
      saveAs: true
    });
    return { method: "blob" };
  } catch {
    const b64 = toBase64Utf8(text);
    const dataUrl = `data:text/plain;charset=utf-8;base64,${b64}`;
    await downloadsDownload({
      url: dataUrl,
      filename,
      saveAs: true
    });
    return { method: "data-base64" };
  } finally {
    // Delay revoke so the downloads manager has time to read the blob.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 2 * 60 * 1000);
  }
}

function buildExportTxt({ windows, tabGroupsByWindowId }) {
  const lines = [];

  lines.push([EXPORT_FORMAT.magic, EXPORT_FORMAT.kind, EXPORT_FORMAT.version].join("\t"));
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push(`# Lines are tab-separated. title fields are URI-encoded.`);
  lines.push(`# WINDOW\t<type>\t<focused 0|1>`);
  lines.push(`# GROUP\t<groupId|-1>\t<color|none>\t<collapsed 0|1>\t<title_enc>`);
  lines.push(`# TAB\t<pinned 0|1>\t<url>\t<title_enc>`);
  lines.push("");

  let windowIndex = 0;
  for (const win of windows) {
    windowIndex += 1;
    lines.push(`# Window ${windowIndex} (id=${win.id})`);
    lines.push(["WINDOW", win.type ?? "normal", win.focused ? "1" : "0"].join("\t"));

    const groups = tabGroupsByWindowId.get(win.id) ?? [];
    const groupById = new Map(groups.map((g) => [g.id, g]));

    const tabs = [...(win.tabs ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const tabsByGroupId = new Map();
    const groupOrder = [];
    for (const tab of tabs) {
      const groupId = typeof tab.groupId === "number" ? tab.groupId : -1;
      if (!tabsByGroupId.has(groupId)) {
        tabsByGroupId.set(groupId, []);
        groupOrder.push(groupId);
      }
      tabsByGroupId.get(groupId).push(tab);
    }

    for (const groupId of groupOrder) {
      if (groupId === -1) {
        lines.push(["GROUP", "-1", "none", "0", enc("Ungrouped")].join("\t"));
      } else {
        const g = groupById.get(groupId);
        const color = g?.color ?? "grey";
        const collapsed = g?.collapsed ? "1" : "0";
        const titleEnc = enc(g?.title ?? "");
        lines.push(["GROUP", String(groupId), String(color), collapsed, titleEnc].join("\t"));
      }

      const groupTabs = tabsByGroupId.get(groupId) ?? [];
      for (const tab of groupTabs) {
        const pinned = tab.pinned ? "1" : "0";
        const url = tab.pendingUrl ?? tab.url ?? "";
        const titleEnc = enc(tab.title ?? "");
        lines.push(["TAB", pinned, url, titleEnc].join("\t"));
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

async function exportTabsToDownload() {
  const windows = await windowsGetAll({ populate: true, windowTypes: WINDOW_TYPES });
  const tabGroupsByWindowId = new Map();
  for (const win of windows) {
    const groups = await tabGroupsQuery({ windowId: win.id });
    tabGroupsByWindowId.set(win.id, groups);
  }

  const text = buildExportTxt({ windows, tabGroupsByWindowId });
  const filename = `tabs-export-${nowStampForFilename()}.txt`;

  await downloadTextFile({ text, filename });

  return { windows: windows.length };
}

function parseExportTxt(text) {
  const rawLines = text.split(/\r?\n/);
  const lines = rawLines
    .map((line, index) => ({ raw: line.trimEnd(), lineNumber: index + 1 }))
    .filter(({ raw }) => raw.length > 0 && !raw.startsWith("#"));

  if (lines.length === 0) {
    throw new Error("Empty file.");
  }

  const fail = (lineNumber, message) => {
    throw new Error(`Line ${lineNumber}: ${message}`);
  };

  const expectFieldCount = (parts, expected, tag, lineNumber) => {
    if (parts.length !== expected) {
      fail(lineNumber, `${tag} record must have exactly ${expected} tab-separated fields; found ${parts.length}.`);
    }
  };

  const parseRequiredBool = (value, fieldName, lineNumber) => {
    if (value === "1") return true;
    if (value === "0") return false;
    fail(lineNumber, `${fieldName} must be 0 or 1; found ${JSON.stringify(value ?? "")}.`);
  };

  const decodeTitle = (value, fieldName, lineNumber) => {
    try {
      return decodeURIComponent(value ?? "");
    } catch {
      fail(lineNumber, `${fieldName} is not valid URI-encoded text.`);
    }
  };

  const [{ raw: headerLine, lineNumber: headerLineNumber }] = lines;
  const header = headerLine.split("\t");
  if (header.length !== 3) {
    fail(headerLineNumber, `Header must have exactly 3 tab-separated fields; found ${header.length}.`);
  }

  const [magic, kind, version] = header;
  if (magic !== EXPORT_FORMAT.magic || kind !== EXPORT_FORMAT.kind || version !== EXPORT_FORMAT.version) {
    throw new Error(`Unsupported file format: ${magic}\t${kind}\t${version}`);
  }

  /** @type {{type:string, focused:boolean, groups: Array<{groupId:number, color:string, collapsed:boolean, title:string, tabs:Array<{url:string, pinned:boolean, title:string}>}>}[]} */
  const windows = [];
  let currentWindow = null;
  let currentGroup = null;

  for (const { raw: line, lineNumber } of lines.slice(1)) {
    const parts = line.split("\t");
    const tag = parts[0];

    if (tag === "WINDOW") {
      expectFieldCount(parts, 3, tag, lineNumber);
      const type = parts[1];
      if (!WINDOW_TYPES.includes(type)) {
        fail(lineNumber, `WINDOW type must be one of: ${WINDOW_TYPES.join(", ")}.`);
      }
      const focused = parseRequiredBool(parts[2], "WINDOW focused", lineNumber);
      currentWindow = { type, focused, groups: [] };
      windows.push(currentWindow);
      currentGroup = null;
      continue;
    }

    if (tag === "GROUP") {
      if (!currentWindow) fail(lineNumber, "GROUP found before WINDOW.");
      expectFieldCount(parts, 5, tag, lineNumber);

      const groupIdRaw = parts[1];
      if (!/^-?\d+$/.test(groupIdRaw)) {
        fail(lineNumber, `GROUP id must be an integer; found ${JSON.stringify(groupIdRaw)}.`);
      }

      const groupId = Number(groupIdRaw);
      if (groupId < -1) {
        fail(lineNumber, `GROUP id must be -1 or greater; found ${groupId}.`);
      }

      const color = parts[2];
      if (!color) {
        fail(lineNumber, "GROUP color is required.");
      }

      const collapsed = parseRequiredBool(parts[3], "GROUP collapsed", lineNumber);
      const title = decodeTitle(parts[4], "GROUP title", lineNumber);
      currentGroup = { groupId, color, collapsed, title, tabs: [] };
      currentWindow.groups.push(currentGroup);
      continue;
    }

    if (tag === "TAB") {
      if (!currentGroup) fail(lineNumber, "TAB found before GROUP.");
      expectFieldCount(parts, 4, tag, lineNumber);

      const pinned = parseRequiredBool(parts[1], "TAB pinned", lineNumber);
      const url = parts[2].trim();
      if (!url) {
        fail(lineNumber, "TAB url is required.");
      }

      const title = decodeTitle(parts[3], "TAB title", lineNumber);
      currentGroup.tabs.push({ url, pinned, title });
      continue;
    }

    fail(lineNumber, `Unknown record type: ${JSON.stringify(tag)}.`);
  }

  if (windows.length === 0) {
    throw new Error("File does not contain any WINDOW records.");
  }

  return windows;
}

function isRestorableUrl(url) {
  const u = (url ?? "").trim();
  if (!u) return false;
  return !(
    u.startsWith("chrome://") ||
    u.startsWith("chrome-extension://") ||
    u.startsWith("devtools://") ||
    u.startsWith("chrome-search://")
  );
}

function summarizeRestorePlan(text) {
  const windowsSpec = parseExportTxt(text);

  let totalTabs = 0;
  let restorableTabs = 0;
  let groupedTabs = 0;
  let skippedTabs = 0;

  for (const winSpec of windowsSpec) {
    for (const group of winSpec.groups) {
      const isGrouped = group.groupId !== -1;
      for (const tab of group.tabs) {
        totalTabs += 1;
        if (isGrouped) groupedTabs += 1;
        if (isRestorableUrl(tab.url)) {
          restorableTabs += 1;
        } else {
          skippedTabs += 1;
        }
      }
    }
  }

  return {
    windowsSpec,
    summary: {
      windows: windowsSpec.length,
      tabs: totalTabs,
      restorableTabs,
      skippedTabs,
      groupedTabs
    }
  };
}

async function restoreFromExportText(windowsSpec) {
  let createdWindows = 0;
  let createdTabs = 0;
  let skippedTabs = 0;
  const errors = [];

  for (const winSpec of windowsSpec) {
    const allTabs = winSpec.groups.flatMap((g) => g.tabs);
    const restorableTabsCount = allTabs.reduce((n, t) => n + (isRestorableUrl(t.url) ? 1 : 0), 0);
    if (restorableTabsCount === 0) {
      skippedTabs += allTabs.length;
      continue;
    }

    const createdWin = await windowsCreate({
      type: WINDOW_TYPES.includes(winSpec.type) ? winSpec.type : "normal",
      focused: !!winSpec.focused
    });
    createdWindows += 1;

    const windowId = createdWin.id;
    const seedTab = createdWin.tabs?.[0];

    /** @type {{tabId:number, groupIndex:number, pinned:boolean}[]} */
    const created = [];

    // Build a flat ordered list matching the export ordering.
    const orderedTabs = [];
    let groupIndex = -1;
    for (const g of winSpec.groups) {
      groupIndex += 1;
      for (const t of g.tabs) {
        orderedTabs.push({ ...t, groupIndex });
      }
    }

    if (orderedTabs.length === 0) {
      continue;
    }

    const restorableOrderedTabs = orderedTabs.filter((t) => isRestorableUrl(t.url));
    skippedTabs += orderedTabs.length - restorableOrderedTabs.length;

    let seedReused = false;
    let createdTabsThisWindow = 0;
    let tabsToCreate = restorableOrderedTabs;

    // Try to re-use the seed tab for the first restorable tab.
    if (seedTab?.id && restorableOrderedTabs.length > 0) {
      const first = restorableOrderedTabs[0];
      try {
        await tabsUpdate(seedTab.id, { url: first.url, pinned: !!first.pinned });
        created.push({ tabId: seedTab.id, groupIndex: first.groupIndex, pinned: !!first.pinned });
        createdTabs += 1;
        createdTabsThisWindow += 1;
        seedReused = true;
        tabsToCreate = restorableOrderedTabs.slice(1);
      } catch (e) {
        errors.push(`Seed tab failed (${first.url}): ${String(e?.message ?? e)}`);
        seedReused = false;
        tabsToCreate = restorableOrderedTabs;
      }
    }

    let insertIndex = 1;
    for (const t of tabsToCreate) {
      try {
        const tab = await tabsCreate({
          windowId,
          url: t.url,
          pinned: !!t.pinned,
          index: insertIndex
        });
        if (tab?.id) {
          created.push({ tabId: tab.id, groupIndex: t.groupIndex, pinned: !!t.pinned });
          createdTabs += 1;
          createdTabsThisWindow += 1;
          insertIndex += 1;
        }
      } catch (e) {
        skippedTabs += 1;
        errors.push(`Tab create failed (${t.url}): ${String(e?.message ?? e)}`);
      }
    }

    // If we couldn't reuse the seed tab, remove it so we don't leave a stray new-tab open.
    if (!seedReused && seedTab?.id && createdTabsThisWindow > 0) {
      try {
        await tabsRemove(seedTab.id);
      } catch (e) {
        errors.push(`Cleanup failed (seed tab): ${String(e?.message ?? e)}`);
      }
    }

    // Recreate groups (skip ungrouped, which is usually groupId=-1 but we use groupIndex to map).
    for (let i = 0; i < winSpec.groups.length; i += 1) {
      const g = winSpec.groups[i];
      if (g.groupId === -1) continue;

      const tabIds = created.filter((t) => t.groupIndex === i).map((t) => t.tabId);
      if (tabIds.length === 0) continue;

      try {
        const newGroupId = await tabsGroup({ tabIds, createProperties: { windowId } });
        const update = {};
        if (g.title) update.title = g.title;
        if (g.color && g.color !== "none") update.color = g.color;
        if (typeof g.collapsed === "boolean") update.collapsed = g.collapsed;
        if (Object.keys(update).length > 0) {
          await tabGroupsUpdate(newGroupId, update);
        }
      } catch (e) {
        errors.push(`Group restore failed (${g.title || "Group"}): ${String(e?.message ?? e)}`);
      }
    }
  }

  return { createdWindows, createdTabs, skippedTabs, errors };
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsText(file);
  });
}

async function handleExportClick() {
  const exportBtn = $("exportBtn");
  exportBtn.disabled = true;
  setStatus("Exporting tabs…");

  try {
    const res = await exportTabsToDownload();
    setStatus(`Exported ${res.windows} window(s).\nDownload prompt should be open.`);
  } catch (e) {
    setStatus(`Export failed:\n${String(e?.message ?? e)}`);
  } finally {
    exportBtn.disabled = false;
  }
}

async function handleRestoreClick() {
  const restoreBtn = $("restoreBtn");
  const input = $("importFile");
  const file = input.files?.[0];
  if (!file) return;

  restoreBtn.disabled = true;
  setStatus("Reading file…");

  try {
    const text = await readFileAsText(file);
    const { windowsSpec, summary } = summarizeRestorePlan(text);
    const previewLines = [
      `Ready to restore from: ${file.name}`,
      `Windows: ${summary.windows}`,
      `Tabs: ${summary.tabs}`,
      `Restorable: ${summary.restorableTabs}`,
      `Skipped: ${summary.skippedTabs}`,
      `Grouped tabs: ${summary.groupedTabs}`
    ];
    setStatus(`${previewLines.join("\n")}\n\nWaiting for confirmation…`);

    const confirmed = window.confirm(`${previewLines.join("\n")}\n\nContinue restoring into new windows?`);
    if (!confirmed) {
      setStatus("Restore cancelled.");
      return;
    }

    setStatus(`${previewLines.join("\n")}\n\nRestoring windows…`);
    const res = await restoreFromExportText(windowsSpec);
    const errText =
      res.errors.length > 0 ? `\n\nErrors (${res.errors.length}):\n- ${res.errors.join("\n- ")}` : "";
    setStatus(
      `Restored.\nWindows: ${res.createdWindows}\nTabs: ${res.createdTabs}\nSkipped: ${res.skippedTabs}${errText}`
    );
  } catch (e) {
    setStatus(`Restore failed:\n${String(e?.message ?? e)}`);
  } finally {
    restoreBtn.disabled = !(input.files && input.files.length > 0);
  }
}

function init() {
  $("exportBtn").addEventListener("click", () => void handleExportClick());

  const fileInput = $("importFile");
  const restoreBtn = $("restoreBtn");
  fileInput.addEventListener("change", () => {
    restoreBtn.disabled = !(fileInput.files && fileInput.files.length > 0);
  });
  restoreBtn.addEventListener("click", () => void handleRestoreClick());
}

init();
