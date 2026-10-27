// When the solver finds no way to the target, say why in terms the player can act on.

import { type Layout, layoutKey, W_MAX } from "./formula";
import type { Pool } from "./pool";
import type { Card, Target } from "./solver";

export type Unreachable =
  /** a wanted stat's bar is above the best possible roll in every accepted layout */
  | { kind: "barTooHigh"; tags: string[] }
  /** more wanted stats than positive slots in any accepted layout */
  | { kind: "tooMany"; need: number; max: number }
  /** every accepted layout has a negative, and no negative is accepted */
  | { kind: "noNegative" }
  /**
   * a wanted stat no cycle can draw on this weapon (one kept from an old roll, say); the card has none of it, or has
   * it under the bar, or has it in a layout the target does not take (changing the layout would cycle it away)
   */
  | { kind: "cannotRoll"; tags: string[]; onCard: "none" | "bar" | "layout"; layout: string }
  | { kind: "other" };

/** The first reason that rules out every alternative target, or "other". */
export function whyUnreachable(card: Card, target: Target, pool?: Pool): Unreachable {
  const { groups, layouts, allowedNeg } = target;
  const sets = target.sets?.length ? target.sets : [groups.map((_, i) => i)];
  const need = (g: number, tag: string, l: Layout) => groups[g].minWBy?.[tag]?.[layoutKey(l)] ?? groups[g].minW;
  if (layouts.every((l) => l.neg === 1) && !allowedNeg.length) return { kind: "noNegative" };

  let first: Unreachable | null = null;
  for (const set of sets) {
    const tooHigh = set.find((g) => groups[g].tags.every((tag) => layouts.every((l) => need(g, tag, l) > W_MAX + 1e-9)));
    if (tooHigh != null) {
      first ??= { kind: "barTooHigh", tags: groups[tooHigh].tags };
      continue;
    }
    if (pool) {
      // a stat a cycle can draw (or a splice make); otherwise only the trait already on the card can count
      const drawn = (tag: string) => (pool.pos.includes(tag) && !pool.keptPos.includes(tag)) || pool.spliced.includes(tag);
      const onCard = [...card.pos, ...(card.spliced ? [card.spliced] : [])];
      const layoutTaken = layouts.some((l) => l.pos === card.layout.pos && l.neg === card.layout.neg);
      const met = (g: number) => layoutTaken && onCard.some((t) => groups[g].tags.includes(t.tag) && t.w >= need(g, t.tag, card.layout));
      const stuck = set.find((g) => !groups[g].tags.some(drawn) && !met(g));
      if (stuck != null) {
        const has = onCard.some((t) => groups[stuck].tags.includes(t.tag));
        first ??= { kind: "cannotRoll", tags: groups[stuck].tags, onCard: !has ? "none" : layoutTaken ? "bar" : "layout", layout: layoutKey(card.layout) };
        continue;
      }
    }
    const max = Math.max(...layouts.map((l) => l.pos));
    if (set.length > max) {
      first ??= { kind: "tooMany", need: set.length, max };
      continue;
    }
    // this alternative looks possible on its own; something subtler blocks it
    return { kind: "other" };
  }
  return first ?? { kind: "other" };
}
