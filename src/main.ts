import { Plugin, WorkspaceLeaf } from "obsidian";
import { PLANISPHERE_VIEW_TYPE, type PlanisphereSettings } from "./contract";
import { PlanisphereView } from "./view";
import { PlanisphereSettingTab, mergeSettings } from "./settingsTab";

export { mergeSettings };

export default class PlanispherePlugin extends Plugin {
  settings: PlanisphereSettings = mergeSettings(null);

  async onload() {
    await this.loadSettings();

    this.registerView(PLANISPHERE_VIEW_TYPE, (leaf) => new PlanisphereView(leaf, this));
    this.addRibbonIcon("sparkles", "Open Planisphere", () => void this.activateView());

    this.addCommand({ id: "open-planisphere", name: "Open Planisphere", callback: () => void this.activateView() });
    this.addCommand({
      id: "open-planisphere-local",
      name: "Open Planisphere for the current note",
      callback: () => {
        const f = this.app.workspace.getActiveFile();
        void this.activateView({ mode: "local", center: f && f.extension === "md" ? f.path : undefined });
      },
    });

    this.addSettingTab(new PlanisphereSettingTab(this.app, this));
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(PLANISPHERE_VIEW_TYPE);
  }

  async loadSettings() {
    this.settings = mergeSettings(await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /** Open the view in a tab, reusing an existing one. `state` is passed to the view (for example Local mode). */
  async activateView(state?: Record<string, unknown>) {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(PLANISPHERE_VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: PLANISPHERE_VIEW_TYPE, active: true, state: state ?? {} });
    } else if (state) {
      await leaf.setViewState({ type: PLANISPHERE_VIEW_TYPE, active: true, state });
    }
    await workspace.revealLeaf(leaf);
  }

  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(PLANISPHERE_VIEW_TYPE)) {
      const v = leaf.view;
      if (v instanceof PlanisphereView) v.syncFromSettings();
    }
  }
}

