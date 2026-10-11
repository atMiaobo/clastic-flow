import {
  App,
  ItemView,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  WorkspaceLeaf
} from "obsidian";
import { Transaction } from "@codemirror/state";
import { EditorView, ViewUpdate } from "@codemirror/view";

const VIEW_TYPE_WPM_STATS = "clastic-flow-stats";

interface WpmRtSettings {
  rollingWindowMs: number;
  pauseGraceMs: number;
  wordLength: number;
  maxCharsPerEdit: number;
}

interface StoredNoteStats {
  chars: number;
  activeMs: number;
  bursts: number;
  lastTypedAt: number;
}

interface StoredData {
  settings: WpmRtSettings;
  overall: StoredNoteStats;
  notes: Record<string, StoredNoteStats>;
}

interface TypingSample {
  at: number;
  chars: number;
}

const DEFAULT_SETTINGS: WpmRtSettings = {
  rollingWindowMs: 2000,
  pauseGraceMs: 5000,
  wordLength: 4.8,
  maxCharsPerEdit: 8
};

const EMPTY_STATS: StoredNoteStats = {
  chars: 0,
  activeMs: 0,
  bursts: 0,
  lastTypedAt: 0
};

function cloneEmptyStats(): StoredNoteStats {
  return { ...EMPTY_STATS };
}

function formatWpm(stats: StoredNoteStats, wordLength: number): string {
  if (stats.activeMs <= 0 || stats.chars <= 0) {
    return "0";
  }

  const minutes = stats.activeMs / 60000;
  return Math.round(stats.chars / wordLength / minutes).toString();
}

function formatTypedWords(stats: StoredNoteStats, wordLength: number): string {
  if (stats.chars <= 0) {
    return "0";
  }

  return Math.round(stats.chars / wordLength).toLocaleString();
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${seconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function copyStats(stats: StoredNoteStats | undefined): StoredNoteStats {
  if (!stats) {
    return cloneEmptyStats();
  }

  return {
    chars: Number(stats.chars) || 0,
    activeMs: Number(stats.activeMs) || 0,
    bursts: Number(stats.bursts) || 0,
    lastTypedAt: Number(stats.lastTypedAt) || 0
  };
}

function isTypingTransaction(transaction: Transaction): boolean {
  if (!transaction.docChanged) {
    return false;
  }

  const userEvent = transaction.annotation(Transaction.userEvent);
  if (!userEvent) {
    return true;
  }

  return (
    userEvent.startsWith("input.type") ||
    userEvent === "input" ||
    userEvent === "input.complete"
  );
}

function countInsertedTypingChars(update: ViewUpdate, maxCharsPerEdit: number): number {
  const typingEdit = update.transactions.some(isTypingTransaction);
  if (!typingEdit) {
    return 0;
  }

  let chars = 0;
  update.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
    const text = inserted.toString();
    for (const char of text) {
      if (char === "\r") {
        continue;
      }
      chars += 1;
    }
  });

  if (chars <= 0 || chars > maxCharsPerEdit) {
    return 0;
  }

  return chars;
}

export default class WpmRtPlugin extends Plugin {
  data: StoredData = {
    settings: DEFAULT_SETTINGS,
    overall: cloneEmptyStats(),
    notes: {}
  };

  private statusBarEl: HTMLElement | null = null;
  private samples: TypingSample[] = [];
  private activeFilePath: string | null = null;
  private saveTimer: number | null = null;
  private lastStatsRefreshAt = 0;

  async onload() {
    await this.loadStoredData();

    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("clastic-flow-status");
    this.statusBarEl.setText("wpm: 0");
    this.positionStatusBarItemStart();

    this.registerView(VIEW_TYPE_WPM_STATS, (leaf) => new WpmStatsView(leaf, this));

    this.registerEditorExtension(
      EditorView.updateListener.of((update) => this.handleEditorUpdate(update))
    );

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.updateActiveFile())
    );
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => this.updateActiveFile(file))
    );

    this.registerInterval(
      window.setInterval(() => {
        const now = Date.now();
        this.pruneSamples(now);
        this.updateStatusBar();
        if (now - this.lastStatsRefreshAt >= 1000) {
          this.refreshStatsViews();
        }
      }, 250)
    );

    this.addRibbonIcon("gauge", "Open Clastic Flow stats", () => this.activateStatsView());
    this.addCommand({
      id: "open-clastic-flow-stats",
      name: "Open Clastic Flow stats",
      callback: () => this.activateStatsView()
    });
    this.addCommand({
      id: "reset-current-note-clastic-flow-stats",
      name: "Reset current note typing stats",
      callback: () => this.resetCurrentNoteStats()
    });
    this.addCommand({
      id: "reset-all-clastic-flow-stats",
      name: "Reset all typing stats",
      callback: () => this.resetAllStats()
    });

    this.addSettingTab(new WpmRtSettingTab(this.app, this));
    this.updateActiveFile();
    this.updateStatusBar();
  }

  onunload() {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  private async loadStoredData() {
    const loaded = (await this.loadData()) as Partial<StoredData> | null;
    this.data = {
      settings: {
        ...DEFAULT_SETTINGS,
        ...(loaded?.settings ?? {})
      },
      overall: copyStats(loaded?.overall),
      notes: {}
    };

    for (const [path, stats] of Object.entries(loaded?.notes ?? {})) {
      this.data.notes[path] = copyStats(stats);
    }
  }

  async saveStoredData() {
    await this.saveData(this.data);
    this.refreshStatsViews();
  }

  queueSave() {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }

    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveStoredData();
    }, 1000);
  }

  private updateActiveFile(file?: TFile | null) {
    if (file) {
      this.activeFilePath = file.path;
    } else {
      this.rememberActiveMarkdownFile();
    }

    this.updateStatusBar();
    this.refreshStatsViews();
  }

  private rememberActiveMarkdownFile() {
    const activeView = this.app.workspace.activeLeaf?.view;
    if (activeView instanceof MarkdownView && activeView.file) {
      this.activeFilePath = activeView.file.path;
      return;
    }

    if (this.activeFilePath) {
      return;
    }

    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file) {
        this.activeFilePath = view.file.path;
        return;
      }
    }

    this.activeFilePath = this.getMostRecentNotePath();
  }

  private getMostRecentNotePath(): string | null {
    let latestPath: string | null = null;
    let latestTypedAt = 0;

    for (const [path, stats] of Object.entries(this.data.notes)) {
      const typedAt = Number(stats.lastTypedAt) || 0;
      if (typedAt > latestTypedAt) {
        latestPath = path;
        latestTypedAt = typedAt;
      }
    }

    return latestPath;
  }

  private handleEditorUpdate(update: ViewUpdate) {
    if (!update.docChanged) {
      return;
    }

    const chars = countInsertedTypingChars(update, this.data.settings.maxCharsPerEdit);
    if (chars === 0) {
      return;
    }

    const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
    if (!file) {
      return;
    }

    const now = Date.now();
    this.recordTyping(file, chars, now);
  }

  private recordTyping(file: TFile, chars: number, now: number) {
    this.activeFilePath = file.path;
    this.recordIntoStats(this.data.overall, chars, now);

    if (!this.data.notes[file.path]) {
      this.data.notes[file.path] = cloneEmptyStats();
    }
    this.recordIntoStats(this.data.notes[file.path], chars, now);

    this.samples.push({ at: now, chars });
    this.pruneSamples(now);
    this.updateStatusBar();
    this.refreshStatsViews();
    this.queueSave();
  }

  private recordIntoStats(stats: StoredNoteStats, chars: number, now: number) {
    if (stats.lastTypedAt > 0) {
      const gap = now - stats.lastTypedAt;
      if (gap > 0 && gap <= this.data.settings.pauseGraceMs) {
        stats.activeMs += gap;
      } else if (gap > this.data.settings.pauseGraceMs) {
        stats.bursts += 1;
      }
    } else {
      stats.bursts += 1;
    }

    stats.chars += chars;
    stats.lastTypedAt = now;
  }

  private pruneSamples(now: number) {
    const cutoff = now - this.data.settings.rollingWindowMs;
    while (this.samples.length > 0 && this.samples[0].at < cutoff) {
      this.samples.shift();
    }
  }

  getLiveWpm(now = Date.now()): number {
    this.pruneSamples(now);
    if (this.samples.length === 0) {
      return 0;
    }

    const first = this.samples[0].at;
    const spanSeconds = Math.min(
      this.data.settings.rollingWindowMs / 1000,
      Math.max(1, (now - first) / 1000)
    );
    const chars = this.samples.reduce((sum, sample) => sum + sample.chars, 0);
    const cps = chars / spanSeconds;
    return Math.round((cps * 60) / this.data.settings.wordLength);
  }

  getCurrentNoteStats(): StoredNoteStats {
    this.rememberActiveMarkdownFile();
    if (!this.activeFilePath) {
      return cloneEmptyStats();
    }

    return copyStats(this.data.notes[this.activeFilePath]);
  }

  getCurrentNotePath(): string | null {
    this.rememberActiveMarkdownFile();
    return this.activeFilePath;
  }

  getSortedNoteRows() {
    return Object.entries(this.data.notes)
      .map(([path, stats]) => ({ path, stats: copyStats(stats) }))
      .filter((row) => row.stats.chars > 0)
      .sort((a, b) => b.stats.lastTypedAt - a.stats.lastTypedAt);
  }

  private updateStatusBar() {
    this.statusBarEl?.setText(`wpm: ${this.getLiveWpm()}`);
    this.positionStatusBarItemStart();
  }

  private positionStatusBarItemStart() {
    if (!this.statusBarEl?.parentElement) {
      return;
    }

    this.statusBarEl.parentElement.prepend(this.statusBarEl);
  }

  async activateStatsView() {
    this.rememberActiveMarkdownFile();
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_WPM_STATS);
    const leaf = leaves[0] ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      new Notice("Could not open WPM stats view.");
      return;
    }

    await leaf.setViewState({ type: VIEW_TYPE_WPM_STATS, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  refreshStatsViews() {
    this.lastStatsRefreshAt = Date.now();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_WPM_STATS)) {
      const view = leaf.view;
      if (view instanceof WpmStatsView) {
        view.render();
      }
    }
  }

  async resetCurrentNoteStats() {
    const path = this.activeFilePath;
    if (!path) {
      new Notice("No active note.");
      return;
    }

    delete this.data.notes[path];
    await this.saveStoredData();
    new Notice("Current note WPM stats reset.");
  }

  async resetAllStats() {
    this.samples = [];
    this.data.overall = cloneEmptyStats();
    this.data.notes = {};
    await this.saveStoredData();
    this.updateStatusBar();
    new Notice("All WPM stats reset.");
  }
}

class WpmStatsView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: WpmRtPlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE_WPM_STATS;
  }

  getDisplayText() {
    return "WPM stats";
  }

  getIcon() {
    return "gauge";
  }

  async onOpen() {
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("clastic-flow-view");

    const heading = contentEl.createEl("h2", { text: "Typing speed" });
    heading.addClass("clastic-flow-title");

    const currentStats = this.plugin.getCurrentNoteStats();
    this.addSection(
      contentEl,
      "Current document",
      this.plugin.getCurrentNotePath() ?? "No active note",
      [
        ["Words typed", formatTypedWords(currentStats, this.plugin.data.settings.wordLength)],
        ["Characters typed", currentStats.chars.toLocaleString()],
        [
          "Average WPM",
          `${formatWpm(currentStats, this.plugin.data.settings.wordLength)} wpm`
        ],
        ["Active time", formatDuration(currentStats.activeMs)],
        ["Bursts", currentStats.bursts.toLocaleString()]
      ]
    );

    this.addSection(contentEl, "Global stats", null, [
      ["Live", `${this.plugin.getLiveWpm()} wpm`],
      [
        "Average WPM",
        `${formatWpm(this.plugin.data.overall, this.plugin.data.settings.wordLength)} wpm`
      ],
      [
        "Words typed",
        formatTypedWords(this.plugin.data.overall, this.plugin.data.settings.wordLength)
      ],
      ["Characters typed", this.plugin.data.overall.chars.toLocaleString()],
      ["Active time", formatDuration(this.plugin.data.overall.activeMs)],
      ["Bursts", this.plugin.data.overall.bursts.toLocaleString()]
    ]);

    contentEl.createEl("h3", { cls: "clastic-flow-section-title", text: "Notes" });
    const table = contentEl.createEl("table", { cls: "clastic-flow-table" });
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    for (const label of ["Note", "Average", "Characters", "Active time", "Bursts"]) {
      headerRow.createEl("th", { text: label });
    }

    const tbody = table.createEl("tbody");
    const rows = this.plugin.getSortedNoteRows();
    if (rows.length === 0) {
      const row = tbody.createEl("tr");
      const cell = row.createEl("td", {
        text: "No typing stats yet."
      });
      cell.colSpan = 5;
    }

    for (const row of rows) {
      const tr = tbody.createEl("tr");
      tr.createEl("td", { text: row.path });
      tr.createEl("td", {
        text: `${formatWpm(row.stats, this.plugin.data.settings.wordLength)} wpm`
      });
      tr.createEl("td", { text: row.stats.chars.toLocaleString() });
      tr.createEl("td", { text: formatDuration(row.stats.activeMs) });
      tr.createEl("td", { text: row.stats.bursts.toLocaleString() });
    }
  }

  private addSection(
    parent: HTMLElement,
    title: string,
    subtitle: string | null,
    stats: Array<[string, string]>
  ) {
    parent.createEl("h3", { cls: "clastic-flow-section-title", text: title });
    if (subtitle) {
      parent.createDiv({ cls: "clastic-flow-section-subtitle", text: subtitle });
    }

    const grid = parent.createDiv({ cls: "clastic-flow-grid" });
    for (const [label, value] of stats) {
      this.addStat(grid, label, value);
    }
  }

  private addStat(parent: HTMLElement, label: string, value: string) {
    const item = parent.createDiv({ cls: "clastic-flow-stat" });
    item.createDiv({ cls: "clastic-flow-label", text: label });
    item.createDiv({ cls: "clastic-flow-value", text: value });
  }
}

class WpmRtSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: WpmRtPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Clastic Flow" });

    new Setting(containerEl)
      .setName("Rolling live window")
      .setDesc("Milliseconds of recent typing used for the status bar value.")
      .addText((text) =>
        text
          .setPlaceholder("2000")
          .setValue(String(this.plugin.data.settings.rollingWindowMs))
          .onChange(async (value) => {
            const parsed = Number(value);
            if (Number.isFinite(parsed) && parsed >= 500) {
              this.plugin.data.settings.rollingWindowMs = parsed;
              await this.plugin.saveStoredData();
            }
          })
      );

    new Setting(containerEl)
      .setName("Pause grace")
      .setDesc("Pauses up to this many milliseconds count as active typing. Longer pauses are discarded.")
      .addText((text) =>
        text
          .setPlaceholder("5000")
          .setValue(String(this.plugin.data.settings.pauseGraceMs))
          .onChange(async (value) => {
            const parsed = Number(value);
            if (Number.isFinite(parsed) && parsed >= 500) {
              this.plugin.data.settings.pauseGraceMs = parsed;
              await this.plugin.saveStoredData();
            }
          })
      );

    new Setting(containerEl)
      .setName("Average word length")
      .setDesc("Characters per word for WPM conversion. The original app used 4.8.")
      .addText((text) =>
        text
          .setPlaceholder("4.8")
          .setValue(String(this.plugin.data.settings.wordLength))
          .onChange(async (value) => {
            const parsed = Number(value);
            if (Number.isFinite(parsed) && parsed > 0) {
              this.plugin.data.settings.wordLength = parsed;
              await this.plugin.saveStoredData();
            }
          })
      );

    new Setting(containerEl)
      .setName("Maximum characters per edit")
      .setDesc("Edits above this size are treated as paste/autocomplete and ignored.")
      .addText((text) =>
        text
          .setPlaceholder("8")
          .setValue(String(this.plugin.data.settings.maxCharsPerEdit))
          .onChange(async (value) => {
            const parsed = Number(value);
            if (Number.isFinite(parsed) && parsed >= 1) {
              this.plugin.data.settings.maxCharsPerEdit = parsed;
              await this.plugin.saveStoredData();
            }
          })
      );

    new Setting(containerEl)
      .setName("Reset all stats")
      .setDesc("Clears overall and per-note typing history.")
      .addButton((button) =>
        button
          .setButtonText("Reset")
          .setWarning()
          .onClick(() => this.plugin.resetAllStats())
      );
  }
}
