import { App, PluginSettingTab, Setting } from "obsidian";
import type PlanispherePlugin from "./main";
import { DEFAULT_FILTERS, DEFAULT_SETTINGS, type PlanisphereSettings } from "./contract";

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : [];
}

/** Saved data merged over the defaults. Unknown or malformed values fall back to the defaults. */
export function mergeSettings(saved: unknown): PlanisphereSettings {
  const s = (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>;
  const f = (s.filters && typeof s.filters === "object" ? s.filters : {}) as Record<string, unknown>;
  const depth = s.localDepth === 1 || s.localDepth === 2 || s.localDepth === 3 ? s.localDepth : DEFAULT_SETTINGS.localDepth;
  const max = typeof f.maxNodes === "number" && Number.isFinite(f.maxNodes) && f.maxNodes > 0 ? Math.round(f.maxNodes) : DEFAULT_FILTERS.maxNodes;
  return {
    theme: s.theme === "paper" || s.theme === "night" ? s.theme : DEFAULT_SETTINGS.theme,
    labelMode: s.labelMode === "always" || s.labelMode === "never" || s.labelMode === "auto" ? s.labelMode : DEFAULT_SETTINGS.labelMode,
    localDepth: depth,
    foldedSections: strings(s.foldedSections),
    filters: {
      ...DEFAULT_FILTERS,
      folders: strings(f.folders),
      excludeFolders: strings(f.excludeFolders),
      tags: strings(f.tags),
      query: "",
      showOrphans: typeof f.showOrphans === "boolean" ? f.showOrphans : DEFAULT_FILTERS.showOrphans,
      peopleOnly: typeof f.peopleOnly === "boolean" ? f.peopleOnly : DEFAULT_FILTERS.peopleOnly,
      maxNodes: max,
    },
  };
}


/** "Archive, Templates/Daily" or one per line -> clean folder list. */
export function parseFolderList(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map((s) => s.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
}

export class PlanisphereSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: PlanispherePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const save = async () => {
      await this.plugin.saveSettings();
      this.plugin.refreshViews();
    };

    new Setting(containerEl)
      .setName("Default theme")
      .setDesc("Night sky or paper atlas. You can also switch from the graph toolbar.")
      .addDropdown((d) =>
        d.addOption("night", "Night sky").addOption("paper", "Paper atlas").setValue(s.theme).onChange(async (v) => {
          s.theme = v === "paper" ? "paper" : "night";
          await save();
        })
      );

    new Setting(containerEl)
      .setName("Labels")
      .setDesc("Auto shows names for the biggest stars and the one you hover.")
      .addDropdown((d) =>
        d.addOption("auto", "Auto").addOption("always", "Always").addOption("never", "Never").setValue(s.labelMode).onChange(async (v) => {
          s.labelMode = v === "always" || v === "never" ? v : "auto";
          await save();
        })
      );

    new Setting(containerEl)
      .setName("Local graph depth")
      .setDesc("How many links away from the current note the local graph reaches.")
      .addDropdown((d) =>
        d.addOption("1", "1 link").addOption("2", "2 links").addOption("3", "3 links").setValue(String(s.localDepth)).onChange(async (v) => {
          s.localDepth = (Number(v) === 1 || Number(v) === 3 ? Number(v) : 2) as 1 | 2 | 3;
          await save();
        })
      );

    new Setting(containerEl)
      .setName("Maximum notes")
      .setDesc("Very large vaults keep only the best connected notes, so the sky stays smooth.")
      .addText((t) =>
        t.setPlaceholder("4000").setValue(String(s.filters.maxNodes)).onChange(async (v) => {
          const n = Math.round(Number(v));
          if (!Number.isFinite(n) || n < 50 || n > 20000) return;
          s.filters.maxNodes = n;
          await save();
        })
      );

    new Setting(containerEl)
      .setName("Folders to leave out")
      .setDesc("Separate folders with commas or new lines. Notes inside them are not drawn.")
      .addTextArea((t) => {
        t.setPlaceholder("Archive, Templates").setValue(s.filters.excludeFolders.join(", ")).onChange(async (v) => {
          s.filters.excludeFolders = parseFolderList(v);
          await save();
        });
        t.inputEl.rows = 3;
      });
  }
}
