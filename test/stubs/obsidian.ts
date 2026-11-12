// Small stand-in for the obsidian module: enough for unit tests and the visual harness.
export class TFile {
  path = "";
  name = "";
  basename = "";
  extension = "";
  stat = { mtime: 0, ctime: 0, size: 0 };
  constructor(path = "", mtime = 0) {
    this.path = path;
    this.name = path.split("/").pop() ?? "";
    const dot = this.name.lastIndexOf(".");
    this.basename = dot > 0 ? this.name.slice(0, dot) : this.name;
    this.extension = dot > 0 ? this.name.slice(dot + 1) : "";
    this.stat.mtime = mtime;
  }
}

export class WorkspaceLeaf {
  app: unknown;
  view: unknown;
  constructor(app?: unknown) {
    this.app = app;
  }
}

type Cleanup = () => void;

export class ItemView {
  app: any;
  leaf: WorkspaceLeaf;
  containerEl: HTMLElement;
  contentEl: HTMLElement;
  private cleanups: Cleanup[] = [];
  constructor(leaf: WorkspaceLeaf) {
    this.leaf = leaf;
    this.app = (leaf as any).app;
    this.containerEl = document.createElement("div");
    this.contentEl = document.createElement("div");
    this.contentEl.className = "view-content";
    this.containerEl.appendChild(this.contentEl);
  }
  registerEvent(ref: { off?: Cleanup }) {
    if (ref?.off) this.cleanups.push(ref.off);
  }
  registerDomEvent(el: EventTarget, type: string, fn: (e: any) => void) {
    el.addEventListener(type, fn);
    this.cleanups.push(() => el.removeEventListener(type, fn));
  }
  async setState(_state: unknown, _result: unknown) {}
  dispose() {
    this.cleanups.forEach((c) => c());
    this.cleanups = [];
  }
}

export class Plugin {
  app: any;
}
export class PluginSettingTab {
  containerEl = { empty() {} };
  constructor(public app: unknown, public plugin: unknown) {}
}
export class Setting {}
export type App = any;
export type CachedMetadata = any;
export type ViewStateResult = any;
