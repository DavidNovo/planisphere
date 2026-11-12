// Invented vault for the visual harness. Nothing here comes from a real vault.
import type { VaultPort } from "../../../src/contract";

export interface HNote {
  path: string;
  tags: string[];
  fm: Record<string, unknown> | null;
  links: string[];
  mtime: number;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

const ADJ = ["Quiet", "Amber", "Northern", "Paper", "Hollow", "Silver", "Slow", "Wild", "Copper", "Bright", "Salt", "Velvet", "Little", "Distant", "Winter", "Gentle", "Rapid", "Tidal", "Hidden", "Marble"];
const NOUN = ["Harbor", "Lantern", "Orchard", "Compass", "Atlas", "Meadow", "Signal", "Archive", "Garden", "Engine", "Ledger", "Bridge", "Kettle", "Window", "Thread", "Beacon", "Canvas", "Almanac", "Foundry", "Trellis"];
const FIRST = ["Mira", "Tobias", "Ines", "Callum", "Zadie", "Ravi", "Sorrel", "Anouk", "Felix", "Noor", "Lena", "Oskar", "Priya", "Jonas", "Maeve", "Theo", "Yara", "Idris", "Clara", "Bram", "Esme", "Kofi", "Hana", "Luca", "Wren", "Dara", "Emil", "Sana", "Otis", "Petra", "Nadia", "Rowan", "Isak", "Leila", "Marek", "Tessa", "Arlo", "Vera", "Soren", "Elio"];
const LAST = ["Alder", "Brandt", "Castell", "Dunmore", "Okafor", "Lindqvist", "Marsh", "Novak", "Quill", "Rhys", "Sato", "Thorne", "Ushakov", "Vance", "Wilde", "Yilmaz", "Zeller", "Ashby", "Bishop", "Corvin"];
const DISH = ["Lemon fennel orzo", "Smoked paprika chickpeas", "Brown butter gnocchi", "Miso roasted squash", "Harissa carrot soup", "Blueberry oat crumble", "Ginger scallion noodles", "Charred leek tart", "Saffron rice pudding", "Maple walnut granola", "Tomato basil galette", "Mushroom barley stew", "Coconut dal", "Pear almond cake", "Sesame cucumber salad", "Black bean chilaquiles", "Rosemary focaccia", "Apple cider braise", "Pickled beet salad", "Cardamom buns"];
const BOOK = ["The Salt Atlas", "Rivers of Glass", "A Field Guide to Clocks", "Small Gods of Weather", "The Cartographer's Daughter", "Notes on Slow Time", "Garden of Forking Roads", "Letters from the Observatory", "The Tin Orchard", "Maps of Quiet Places", "An Almanac of Ruins", "The Weight of Light"];
const TOPIC = ["sync", "graphs", "parsing", "typography", "gardening", "sailing", "tea", "bread", "chess", "birds", "ceramics", "synths", "orbit", "tides", "typesetting", "maps"];

function pick<T>(r: () => number, a: T[]): T {
  return a[Math.floor(r() * a.length)];
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** scale 1 is about 900 notes. */
export function makeVault(scale = 1, seed = 17): HNote[] {
  const r = rng(seed);
  const notes = new Map<string, HNote>();
  const add = (path: string, tags: string[], links: string[] = [], fm: Record<string, unknown> | null = null): HNote => {
    let p = path;
    let k = 2;
    while (notes.has(p)) p = path.replace(/\.md$/, ` ${k++}.md`);
    const n: HNote = { path: p, tags, fm, links, mtime: 1.7e12 + notes.size * 1e6 };
    notes.set(p, n);
    return n;
  };
  const S = (n: number) => Math.max(1, Math.round(n * scale));
  const hubsOf: Record<string, string[]> = {};
  const hub = (group: string, path: string, tags: string[]) => {
    add(path, tags, []);
    (hubsOf[group] ||= []).push(path);
    return path;
  };

  const home = hub("home", "Home.md", ["moc"]);
  const areas = ["Health", "Money", "House", "Learning", "Craft", "Friends", "Travel Plans", "Kitchen", "Garden", "Reading Life", "Studio", "Community"].map((a) => hub("areas", `Areas/${a}.md`, ["area"]));
  notes.get(home)!.links.push(...areas);

  // People
  const people: string[] = [];
  const nPeople = 40;
  for (let i = 0; i < nPeople; i++) {
    const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
    const file = `People/${name}.md`;
    const resolvable = i % 8 !== 7; // a few have no loadable image: initials fallback
    add(file, ["people"], [], { avatar: i % 3 === 0 ? `People/_avatars/${slug(name)}.png` : `![[${slug(name)}.png|96]]`, role: pick(r, ["editor", "neighbour", "colleague", "climbing friend", "cousin"]), _ok: resolvable });
    people.push(file);
  }
  for (const p of people) {
    for (let j = 0; j < 1 + Math.floor(r() * 3); j++) {
      const q = pick(r, people);
      if (q !== p) notes.get(p)!.links.push(q);
    }
  }
  const mentionable = people.slice(0, 27); // the rest are never written about
  const somePeople = (n: number) => Array.from({ length: n }, () => pick(r, mentionable));

  // Projects: hubs with sub notes
  const projNames = Array.from({ length: S(9) }, (_, i) => `${ADJ[(i * 3) % ADJ.length]} ${NOUN[(i * 5 + 1) % NOUN.length]}`);
  const projects: string[] = [];
  for (const pn of projNames) {
    const hp = hub("projects", `Projects/${pn}.md`, ["project"]);
    projects.push(hp);
    const subs = ["Spec", "Roadmap", "Risks", "Decisions", "Retro", "Notes", "API sketch", "Test plan", "Launch checklist", "Open questions", "Glossary", "Metrics"];
    const k = 8 + Math.floor(r() * 4);
    const made: string[] = [];
    for (let i = 0; i < k; i++) {
      const sp = `Projects/${pn}/${subs[i % subs.length]} ${pn}.md`;
      const n = add(sp, ["project", i % 3 === 0 ? "design" : "build"], [hp]);
      made.push(n.path);
      if (made.length > 1 && r() < 0.6) n.links.push(pick(r, made.slice(0, -1)));
      if (r() < 0.2) n.links.push(...somePeople(1));
      notes.get(hp)!.links.push(n.path);
    }
    notes.get(pick(r, areas))!.links.push(hp);
  }

  // Reading
  const readHubs = ["Fiction", "Essays", "Systems", "Craft books", "Poetry"].map((h) => hub("read", `Reading/${h}.md`, ["reading", "moc"]));
  const books: string[] = [];
  for (let i = 0; i < S(130); i++) {
    const t = `${pick(r, BOOK)} ${["I", "II", "III", "IV"][i % 4]} ${TOPIC[(i * 3) % TOPIC.length]}`;
    const n = add(`Reading/${t}.md`, ["book", i % 2 ? "to-read" : "read"], [readHubs[i % readHubs.length]]);
    books.push(n.path);
    if (r() < 0.25 && books.length > 3) n.links.push(pick(r, books.slice(0, -1)));
    if (r() < 0.15) n.links.push(pick(r, projects));
    notes.get(readHubs[i % readHubs.length])!.links.push(n.path);
  }
  notes.get(pick(r, areas))!.links.push(...readHubs);

  // Recipes
  const pantry = ["Pantry", "Weeknight dinners", "Baking", "Soups and stews"].map((h) => hub("food", `Recipes/${h}.md`, ["recipe", "moc"]));
  for (let i = 0; i < S(90); i++) {
    const t = `${DISH[i % DISH.length]}${i >= DISH.length ? ` ${["v2", "with greens", "for guests", "quick"][i % 4]}` : ""}`;
    const hb = pantry[i % pantry.length];
    const n = add(`Recipes/${t}.md`, ["recipe", i % 4 ? "dinner" : "baking"], [hb]);
    notes.get(hb)!.links.push(n.path);
    if (r() < 0.3) n.links.push(pick(r, pantry));
    if (r() < 0.1) n.links.push(...somePeople(1));
  }
  notes.get(areas[7])!.links.push(...pantry);

  // Garden and Travel
  const gh = hub("garden", "Garden/Beds.md", ["garden", "moc"]);
  for (let i = 0; i < S(55); i++) {
    const n = add(`Garden/${pick(r, ["Sow", "Prune", "Compost", "Harvest", "Water"])} ${pick(r, ["tomatoes", "beans", "kale", "lavender", "dahlias", "figs", "peas"])} ${i}.md`, ["garden"], [gh]);
    notes.get(gh)!.links.push(n.path);
    if (r() < 0.2) n.links.push(pick(r, pantry));
  }
  notes.get(areas[8])!.links.push(gh);
  const th = hub("travel", "Travel/Trips.md", ["travel", "moc"]);
  for (let i = 0; i < S(55); i++) {
    const n = add(`Travel/${pick(r, ["Lisbon", "Kyoto", "Oslo", "Porto", "Lyon", "Tbilisi", "Hobart"])} ${pick(r, ["itinerary", "packing", "cafes", "trains", "notes"])} ${i}.md`, ["travel"], [th]);
    notes.get(th)!.links.push(n.path);
    if (r() < 0.2) n.links.push(...somePeople(1));
  }
  notes.get(areas[6])!.links.push(th);

  // Ideas
  for (let i = 0; i < S(60); i++) {
    const n = add(`Ideas/${pick(r, ADJ)} ${pick(r, NOUN)} idea ${i}.md`, ["idea"], [pick(r, projects)]);
    if (r() < 0.3) n.links.push(pick(r, books.length ? books : projects));
  }

  // Meetings
  for (let i = 0; i < S(90); i++) {
    const n = add(`Meetings/Sync ${pick(r, projNames)} ${i}.md`, ["meeting"], [pick(r, projects), ...somePeople(1 + Math.floor(r() * 3))]);
    n.fm = null;
  }

  // Journal
  const months = ["2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08"];
  const mh = months.map((m) => hub("journal", `Journal/${m} Review.md`, ["journal", "moc"]));
  for (let i = 0; i < S(220); i++) {
    const m = i % months.length;
    const day = String(1 + Math.floor(i / months.length)).padStart(2, "0");
    const links = [mh[m], pick(r, projects)];
    if (r() < 0.5) links.push(...somePeople(1 + Math.floor(r() * 2)));
    if (r() < 0.3 && books.length) links.push(pick(r, books));
    if (r() < 0.2) links.push(pick(r, pantry));
    const n = add(`Journal/${months[m]}-${day}.md`, ["journal"], links);
    notes.get(mh[m])!.links.push(n.path);
  }
  notes.get(areas[0])!.links.push(...mh.slice(0, 3));

  return Array.from(notes.values());
}

export function portOf(notes: HNote[]): VaultPort {
  const by = new Map(notes.map((n) => [n.path, n]));
  return {
    notes: () => notes.map((n) => ({ path: n.path, basename: n.path.split("/").pop()!.replace(/\.md$/, ""), mtime: n.mtime })),
    links: () => {
      const out: Record<string, Record<string, number>> = {};
      for (const n of notes) {
        if (!n.links.length) continue;
        const o: Record<string, number> = {};
        for (const l of n.links) o[l] = (o[l] || 0) + 1;
        out[n.path] = o;
      }
      return out;
    },
    tagsOf: (p) => by.get(p)?.tags ?? [],
    frontmatter: (p) => by.get(p)?.fm ?? null,
  };
}

/** A generated portrait as a data URL. Runs in the browser. */
export function portrait(seedText: string): string {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h >>>= 0;
  const c = document.createElement("canvas");
  c.width = c.height = 192;
  const g = c.getContext("2d")!;
  const bgHue = h % 360;
  const bg = g.createLinearGradient(0, 0, 192, 192);
  bg.addColorStop(0, `hsl(${bgHue} 55% 62%)`);
  bg.addColorStop(1, `hsl(${(bgHue + 50) % 360} 50% 34%)`);
  g.fillStyle = bg;
  g.fillRect(0, 0, 192, 192);
  const skins = ["#f1c9a5", "#d9a077", "#b9794f", "#8d5a3b", "#6b4429", "#f7d9bd"];
  const hairs = ["#2b1d16", "#5a3a22", "#a8743a", "#d8b66a", "#1a1a1f", "#8a8f99", "#7b2f2b"];
  const skin = skins[(h >> 4) % skins.length];
  const hair = hairs[(h >> 8) % hairs.length];
  // shoulders
  g.fillStyle = `hsl(${(bgHue + 180) % 360} 35% ${28 + ((h >> 12) % 22)}%)`;
  g.beginPath();
  g.ellipse(96, 205, 76, 62, 0, Math.PI, 0);
  g.fill();
  // neck and head
  g.fillStyle = skin;
  g.fillRect(84, 112, 24, 34);
  g.beginPath();
  g.ellipse(96, 86, 33, 40, 0, 0, Math.PI * 2);
  g.fill();
  // hair
  g.fillStyle = hair;
  g.beginPath();
  if ((h >> 16) % 3 === 0) {
    g.ellipse(96, 72, 38, 34, 0, Math.PI, 0);
    g.fillRect(58, 70, 12, 54);
    g.fillRect(122, 70, 12, 54);
  } else {
    g.ellipse(96, 66, 35, 24, 0, Math.PI, 0);
    g.fillRect(61, 64, 70, 10);
  }
  g.fill();
  // eyes
  g.fillStyle = "rgba(30,20,20,.75)";
  g.fillRect(83, 88, 4, 5);
  g.fillRect(105, 88, 4, 5);
  return c.toDataURL("image/png");
}
