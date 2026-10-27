# DESIGN.md — 裂罅循环助手

The player has the game open next to this page and repeats one loop dozens of times:
**cycle in game → paste screenshot → keep old/new → follow the next step.**
Everything on screen serves that loop; anything else is one click away, not on the page.

## Rules

1. **Say it once.** A number appears in one place. Roll (W) and shown value sit side by side in the same control, not repeated in captions, summaries or hints.
2. **Labels, not sentences.** Controls carry a word or two. Explanations live on 机制说明.
3. **Recognition over recall.** Stats are picked from a searchable list grouped by kind; spliced stats show their recipe.
4. **Forgiving inputs.** `140`, `140%`, `+140`, `x1.5`, `1.05` are all accepted. Every slider has a number box next to it.
5. **Big, close targets (Fitts).** Interactive rows are at least 40 px tall; the two loop actions (没出 / 贴新截图) are the largest buttons on the page and sit right under the chosen route.
6. **Few choices at once (Hick).** Presets first (不限 / 中 / 高), custom by typing. Rarely used settings (tier definitions, count rule) live behind one ⚙ toggle.
7. **Instant feedback.** Inputs update the plan without a submit button; a stale plan dims instead of disappearing.
8. **Spacing does the grouping.** 4-px grid: 4 / 8 / 12 / 16 / 24 / 40. Rules (lines) only between peers, never as decoration.
9. **Signs as signs.** `+` and `−`, never 正 / 负.
10. **Pictures where the game has them.** Weapon art, damage-type symbols, Kuva and the Riven Splicer use the game's own images, so the page reads like the cycle screen instead of a spreadsheet.

## Tokens

| Token | Value | Use |
|---|---|---|
| `--paper` | `#f2eee5` | page |
| `--sheet` | `#f8f5ee` | cards, popovers |
| `--well` | `#e9e3d6` | inputs at rest, chips off |
| `--ink` | `#1c1a16` | text, primary button |
| `--ink-2` | `#4a463e` | secondary text |
| `--ink-3` | `#7d776b` | meta text |
| `--rule` | `#d6cebd` | dividers |
| `--seal` | `#c23a22` | the one accent: recommended, focus, negatives |
| `--hi` | `#a86c14` | roll at or above the bar |
| radius | 6 px controls, 10 px cards | |
| type | Noto Serif SC (titles), system sans (UI), Newsreader (numbers, tabular) | |

## Layout

- ≥ 1180 px: left column 420 px (riven card, then target), right column routes. Left column scrolls on its own when tall.
- < 1180 px: one column — card, target, routes.
- Header: riven mark + title · 助手 / 词条范围 / 机制说明 · language menu · theme.
- Language menu: one native `<select>` on every screen, drawn as a menu where `appearance: base-select` works (a plain select elsewhere). The button shows 文A and the language named in itself (简体中文 / 国服 / 繁體中文 / English; no flags, no codes); each option adds what that client calls a riven (裂罅 Mod / 裂隙振幅晶体 / 裂罅 MOD / Riven Mod). On phones the button is 文A alone.

## Images

- Weapon art: the official Public Export CDN, `https://content.warframe.com/PublicExport/<icon path>!<content hash>` (path and hash from `ExportWeapons` / `ExportImages`, stored per weapon in `game.json`). Always follows the selected weapon; hides itself if the CDN is unreachable.
- Damage-type symbols, Kuva, riven mark, Riven Splicer: small PNGs in `public/icons/`.
- Screenshot: cropped to the riven card(s) using the OCR text bounds; tap opens the full image.

## Components

- **Riven card** — weapon combobox; one row per trait: sign, value (editable), stat (picker), roll W with a bar showing the target bar for wanted stats; ＋ adds a trait; footer row: cycles, Kuva left, paste button.
- **Target slot** — stat picker · preset segmented control · roll box ⇄ value box (linked). Delete on the right.
- **Alternative targets** — "+ 或 · 另一组目标" adds another list of slots (A / B / …); the riven is done when any one list is met. A stat may appear in several lists.
- **Route card** — title (lock / splice), per-cycle chance, expected cycles, total Kuva with median · 90% and a range bar on a shared scale, "keep new when" as stat chips. The chosen card opens its steps and the two loop buttons.
- **Popover** — anchored under its trigger, closes on Esc / outside click; on phones it becomes a bottom sheet.
