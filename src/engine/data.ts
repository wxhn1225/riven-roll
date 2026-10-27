import game from "../data/game.json";

/** zh 简中 and tc 繁中 (international client), cn 国服, en English: each with the game's own terms */
export type Lang = "zh" | "cn" | "tc" | "en";
export type Text = Record<Lang, string>;
/** in the order the language menu lists them: the two Simplified sets side by side */
export const LANGS: Lang[] = ["zh", "cn", "tc", "en"];
export const isLang = (x: unknown): x is Lang => LANGS.includes(x as Lang);
export type RivenClass = "Rifle" | "Shotgun" | "Pistol" | "Kitgun" | "Archgun" | "Melee" | "Zaw";

export interface StatDef {
  tag: string;
  base: number;
  buff: boolean;
  curse: boolean;
  spliced: boolean;
  compat: string[];
  buffRestr: string[];
  curseRestr: string[];
  fmt: "pct" | "mult" | "flat" | "sec";
  smaller: boolean;
  reverse: boolean;
  roundTo: number;
  roundingMode: "RM_ROUND" | "RM_FLOOR" | "RM_CEIL";
  name: Text;
  template: Text;
}

export interface Splice {
  result: string;
  a: string;
  b: string;
}

export interface Weapon {
  id: string;
  cls: RivenClass;
  name: Text;
  tags: string[];
  /** the impact, puncture and slash stats its riven can roll */
  physical: string[];
  sentinel: boolean;
  grimoire: boolean;
  variant: string;
  /** Public Export image path with its content hash, or null */
  icon: string | null;
}

interface GameData {
  version: { intl: string; cn: string };
  layout: {
    numBuffsAtten: number[];
    numBuffsCurseAtten: number[];
    curseAtten: number;
    specificFit: number;
    disposition: number;
    maxRank: number;
  };
  ui: Record<string, Text>;
  statNames: Record<string, { tag: string; prefix: Text | null; suffix: Text | null }>;
  classes: Record<RivenClass, { name: Text; stats: StatDef[]; splices: Splice[] }>;
  weapons: Weapon[];
  /** ids of weapons exported twice under one name (an empty shell, a doppelganger copy) → the one kept */
  aliases: Record<string, string>;
  /** 繁中 characters each followed by its 简中 one */
  hant: string;
}

export const GAME = game as unknown as GameData;
export const CLASSES = Object.keys(GAME.classes) as RivenClass[];

export function statsOf(cls: RivenClass): StatDef[] {
  return GAME.classes[cls].stats;
}

export function statOf(cls: RivenClass, tag: string): StatDef {
  const s = GAME.classes[cls].stats.find((x) => x.tag === tag);
  if (!s) throw new Error(`unknown stat ${tag} for ${cls}`);
  return s;
}

export function splicesOf(cls: RivenClass): Splice[] {
  return GAME.classes[cls].splices;
}

export function weaponById(id: string): Weapon | undefined {
  const real = GAME.aliases[id] ?? id;
  return GAME.weapons.find((w) => w.id === real);
}
