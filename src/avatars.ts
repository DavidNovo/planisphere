// Avatar loading and generated fallbacks. Browser only (canvas, Image), no obsidian import.
import { hashString, type RGB } from "./layout";

/** What the store needs to know about a person note. */
export interface AvatarSubject {
  id: string;
  title: string;
  avatarPath?: string;
}

/** Two letters for a portrait: first and last word initials, or the first two letters of a single word. */
export function initials(title: string): string {
  const name = (title || "?").replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return Array.from(parts[0]).slice(0, 2).join("").toUpperCase();
  return (Array.from(parts[0])[0] + Array.from(parts[parts.length - 1])[0]).toUpperCase();
}

function rgbToHue([r, g, b]: RGB): number {
  const r0 = r / 255,
    g0 = g / 255,
    b0 = b / 255;
  const mx = Math.max(r0, g0, b0),
    mn = Math.min(r0, g0, b0),
    dd = mx - mn;
  const h = dd === 0 ? 0 : mx === r0 ? ((g0 - b0) / dd) % 6 : mx === g0 ? (b0 - r0) / dd + 2 : (r0 - g0) / dd + 4;
  return (h * 60 + 360) % 360;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return c;
}

/** Deterministic gradient with initials, tinted toward the given cluster hue. */
export function placeholderAvatar(s: AvatarSubject, size: number, hue: RGB = [134, 178, 236], sans = "sans-serif"): HTMLCanvasElement {
  const c = makeCanvas(size);
  const g = c.getContext("2d")!;
  const h = hashString(s.id);
  const bh = rgbToHue(hue);
  const hue1 = (bh + (h % 56) - 28 + 360) % 360;
  const hue2 = (hue1 + 18 + ((h >> 9) % 34)) % 360;
  const grd = g.createLinearGradient(0, 0, size, size);
  grd.addColorStop(0, `hsl(${hue1} ${38 + ((h >> 5) % 18)}% ${56 + ((h >> 3) % 10)}%)`);
  grd.addColorStop(1, `hsl(${hue2} 42% ${28 + ((h >> 7) % 8)}%)`);
  g.fillStyle = grd;
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  g.fill();
  const hl = g.createRadialGradient(size * 0.32, size * 0.26, 0, size * 0.32, size * 0.26, size * 0.7);
  hl.addColorStop(0, "rgba(255,255,255,.28)");
  hl.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = hl;
  g.fill();
  g.fillStyle = "rgba(255,255,255,.95)";
  g.font = `600 ${Math.round(size * 0.38)}px ${sans}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = "rgba(0,0,0,.25)";
  g.shadowBlur = size * 0.05;
  g.fillText(initials(s.title), size / 2, size / 2 + size * 0.025);
  return c;
}

function circleCrop(img: HTMLImageElement, size: number): HTMLCanvasElement {
  const c = makeCanvas(size);
  const g = c.getContext("2d")!;
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  g.clip();
  const w = img.naturalWidth || size;
  const h = img.naturalHeight || size;
  const k = Math.max(size / w, size / h);
  g.drawImage(img, (size - w * k) / 2, (size - h * k) / 2, w * k, h * k);
  return c;
}

type Entry = { state: "idle" | "loading" | "ok" | "failed"; img?: HTMLImageElement; canvases: Map<number, HTMLCanvasElement> };

export interface AvatarStoreOptions {
  /** `resolveAvatar` from EngineOptions: avatar path or link target to a loadable URL, or undefined. */
  resolve: (avatarPath: string) => string | undefined;
  /** called when an image finished loading so the view can repaint */
  onLoad: (id: string) => void;
  hueOf?: (id: string) => RGB;
  sans?: string;
  maxConcurrent?: number;
}

/**
 * Lazy avatar cache. get() returns something drawable immediately (a generated avatar until the
 * real image arrives) and starts loading the real one the first time a note is asked for. The
 * renderer only asks for people who are on screen, so off-screen avatars are never fetched.
 */
export class AvatarStore {
  private entries = new Map<string, Entry>();
  private queue: string[] = [];
  private active = 0;
  private subjects = new Map<string, AvatarSubject>();
  private dead = false;

  constructor(private opts: AvatarStoreOptions) {}

  setSans(sans: string): void {
    this.opts.sans = sans;
  }

  get(s: AvatarSubject, size: number): HTMLCanvasElement {
    let e = this.entries.get(s.id);
    if (!e) {
      e = { state: "idle", canvases: new Map() };
      this.entries.set(s.id, e);
    }
    this.subjects.set(s.id, s);
    let c = e.canvases.get(size);
    if (!c) {
      c = e.state === "ok" && e.img ? circleCrop(e.img, size) : placeholderAvatar(s, size, this.opts.hueOf?.(s.id), this.opts.sans);
      e.canvases.set(size, c);
    }
    if (e.state === "idle") this.enqueue(s.id, e);
    return c;
  }

  /** Forget everything (for example after the resolver changed). */
  clear(): void {
    this.entries.clear();
    this.queue = [];
  }

  /** Drop generated placeholders so tint changes (cluster recolour) are picked up. */
  invalidatePlaceholders(): void {
    this.entries.forEach((e) => {
      if (e.state !== "ok") e.canvases.clear();
    });
  }

  destroy(): void {
    this.dead = true;
    this.entries.clear();
    this.queue = [];
  }

  private urlFor(s: AvatarSubject | undefined): string | undefined {
    if (!s || !s.avatarPath) return undefined;
    try {
      return this.opts.resolve(s.avatarPath);
    } catch {
      return undefined;
    }
  }

  private enqueue(id: string, e: Entry): void {
    if (!this.urlFor(this.subjects.get(id))) {
      e.state = "failed";
      return;
    }
    e.state = "loading";
    this.queue.push(id);
    this.pump();
  }

  private pump(): void {
    const max = this.opts.maxConcurrent ?? 6;
    while (!this.dead && this.active < max && this.queue.length) {
      const id = this.queue.pop()!; // newest request first: what is on screen now
      const e = this.entries.get(id);
      const s = this.subjects.get(id);
      if (!e || !s) continue;
      const url = this.urlFor(s);
      if (!url) {
        e.state = "failed";
        continue;
      }
      this.active++;
      const img = new Image();
      img.decoding = "async";
      const done = (ok: boolean) => {
        this.active--;
        if (this.dead) return;
        if (ok && img.naturalWidth > 0) {
          e.state = "ok";
          e.img = img;
          e.canvases.clear();
          this.opts.onLoad(id);
        } else e.state = "failed";
        this.pump();
      };
      img.onload = () => done(true);
      img.onerror = () => done(false);
      img.src = url;
    }
  }
}
