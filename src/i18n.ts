// UI text. Game terms come from the game's own dictionaries (GAME.ui, stat and weapon names):
// 简中 = international client Simplified Chinese, 国服 = China server, 繁中 = international client Traditional
// Chinese, English.
import { GAME, type Lang } from "./engine/data";
import type { Unreachable } from "./engine/diagnose";
import type { CardProblem } from "./state";

const g = (k: string, l: Lang) => GAME.ui[k][l];

/** Each language named in itself (and so in every UI language alike), in full: a menu of endonyms. */
export const LANG_LABEL: Record<Lang, string> = { zh: "简体中文", cn: "国服", tc: "繁體中文", en: "English" };
/** The page's lang attribute: picks the right CJK glyphs and fonts. */
export const HTML_LANG: Record<Lang, string> = { zh: "zh-Hans", cn: "zh-Hans", tc: "zh-Hant", en: "en" };

export function strings(l: Lang) {
  const kuva = g("kuva", l);
  const lock = g("lockTrait", l);
  const splicing = g("splicing", l);
  const splicer = g("splicer", l);
  const cycleFor = (price: string) => g("cycleFor", l).replace("|PRICE|", price);
  const show = g("showRanked", l);

  if (l === "en")
    return {
      title: "Riven Cycling Coach",
      nav: { coach: "Coach", ranges: "Stat ranges", guide: "How it works" },
      contact: "Questions and suggestions: ",
      disposition: {
        name: "Disposition",
        tip: "Every weapon has 1.2 since 22 October 2026. Change it only if the game changes it again, or for a screenshot from before.",
        reset: "Back to 1.2",
      },
      theme: { label: "Theme", auto: "follow the system", light: "light", dark: "dark" },
      category: { core: "Core", element: "Elements", physical: "Physical", faction: "Faction", utility: "Utility", spliced: "Spliced" },
      search: "Search",
      noMatch: "No match",
      done: "Done",
      anyOf: "Pick several: any one of them counts.",
      undo: { label: "Undo", missed: "Counted a cycle with no luck", demo: "Loaded the example", clear: "Cleared", keep: "Kept a riven" },
      card: {
        title: "Riven",
        weapon: "Choose weapon",
        paste: "Paste screenshot",
        pasteHint: "Ctrl+V or drop it anywhere",
        range: (lo: string, hi: string) => `Range ${lo} to ${hi}`,
        oldOnly: "Old rivens only: no longer rolls here",
        another: "Another",
        zoom: "Screenshot",
        downloading: "Downloading reader",
        downloaded: (done: string, total: string, pct: number) => `${done} / ${total} MB (${pct}%)`,
        quiet: (sec: number) => `nothing for ${sec} s`,
        retried: (n: number) => `retried ${n}×`,
        loading: "Loading reader…",
        reading: "Reading…",
        readIn: (sec: string) => `Read in ${sec} s`,
        failed: "Couldn't read it. Fill it in below.",
        noCard: "No riven found in that screenshot.",
        load: "The reader didn't load. Check the connection and paste again.",
        pickStat: "Stat",
        add: "Add",
        addPos: "Add a positive trait",
        addNeg: "Add a negative trait",
        remove: "Remove",
        cycles: "Cycles",
        kuvaLeft: "Left",
        invalid: `Not possible here. Is “${show}” ticked?`,
        demo: "Example",
        clear: "Clear",
      },
      target: {
        title: "Target",
        add: "Add a wanted stat",
        addAlt: "Another target",
        quick: {
          label: "Type a target",
          placeholder: "Type a target, e.g. dmg ms fr any neg",
          apply: "Fill in",
          help: "What you can type",
          rules: [
            ["dmg ms fr · cc cd", "Damage, Multishot, Fire Rate, crit chance and damage: official names and short forms"],
            ["corrosive or viral · corr/viral", "either one"],
            ["; or a new line", "another target"],
            ["hi ms · ms 110 · tox 1.05", "tier, shown value, roll"],
            ["any neg · no neg · neg zoom", "negatives"],
            ["3+1", "layout"],
          ] as [string, string][],
          unknown: "Not understood",
          // punctuation around what was read: "Not understood: aa, bb", "Damage (can't roll on this weapon)"
          colon: ": ",
          list: ", ",
          note: (why: string) => ` (${why})`,
          negAny: "Any negative",
          negList: "Accept",
          why: { class: "not on this class", weapon: "can't roll on this weapon", full: "3 per target", spliced: "one spliced trait per riven", sets: "4 targets at most" },
        },
        or: "or",
        removeSet: "Remove this target",
        preset: { any: "Any", mid: "Mid", hi: "High" },
        roll: "Roll ≥",
        value: "Value",
        never: "out of reach",
        negatives: "Negative",
        noNeg: "None wanted",
        accept: "Accept",
        all: "All",
        none: "None",
        layouts: "Layout",
        more: "Tiers & count",
        tiers: "Tiers",
        atLeast: "At least",
        reach: "reach",
        atLeastNote: (ks: [string, number][], tier: string) => `Also: at least ${ks.map(([set, k]) => (set ? `${k} in ${set}` : k)).join(", ")} of the wanted stats reach ${tier}`,
        range: (text: string) => `Range ${text}`,
        oneSpliced: "A riven holds one spliced trait; another row has one.",
      },
      routes: {
        title: "Next move",
        sort: { kuva: `Least ${kuva}`, budget: "Within budget", cycles: "Fewest cycles" },
        sortTip: {
          kuva: `Lowest average ${kuva} first`,
          cycles: "Fewest cycles on average first",
          budget: `Highest chance to finish with the ${kuva} you have first`,
        },
        perCycle: (p: string, n: string) => `${p} per cycle, about ${n} cycles`,
        cycles: (n: string) => `≈ ${n} cycles`,
        totalCycles: (n: string) => `${n} cycles`,
        spreadCycles: (n: string) => n,
        totalTip: { kuva: "Average total Kuva to finish, later steps included", cycles: "Average total cycles to finish, later steps included" },
        p90: "90%",
        median: "median",
        within: "within budget",
        rec: "Best",
        none: "Cycle, no lock",
        keepSpliced: (x: string) => `Cycle, ${x} stays locked`,
        drop: (x: string) => `Unlock ${x}, cycle`,
        dropAnd: (x: string, then: string) => `Unlock ${x} · ${then}`,
        lock: (x: string) => `${lock}: ${x}`,
        lockNeg: (x: string) => `${lock}: −${x}`,
        splice: (a: string, b: string, r: string) => `${splicing}: ${a} + ${b} → ${r}`,
        keepWhen: "Keep new on",
        negOk: "accepted negative",
        negBecomesOk: "an accepted negative instead",
        betterMix: "a better mix",
        anyOf: (n: number) => `any ${n} of`,
        restCompare: "anything else: paste it to compare",
        allCompare: "paste the new riven to compare",
        computing: "Working out routes…",
        failed: (code: string) =>
          code === "start-failed"
            ? "The calculator did not start. Try again or reload the page."
            : code === "too-complex"
              ? "This target needs too much calculation and was stopped. Use fewer alternatives, fewer stats per row or lower bars."
              : code === "timeout"
                ? "The calculation ran over 30 seconds and was stopped. Try again."
                : "The calculation stopped. Try again.",
        retry: "Try again",
        reload: "Reload page",
        done: "This riven already meets the target.",
        why: (r: Unreachable, name: (tag: string) => string) => {
          switch (r.kind) {
            case "barTooHigh":
              return `The bar for ${r.tags.map(name).join(" / ")} is above the best roll (1.10) in the chosen layouts.`;
            case "tooMany":
              return `The target wants ${r.need} stats; the chosen layouts have at most ${r.max} positives.`;
            case "noNegative":
              return "Every chosen layout has a negative, but no negative is accepted.";
            case "cannotRoll": {
              const x = r.tags.map(name).join(" / ");
              if (r.onCard === "none") return `${x} cannot roll on this weapon.`;
              if (r.onCard === "bar") return `${x} no longer rolls on this weapon; the one on the riven is kept, but it is under the bar.`;
              return `${x} no longer rolls on this weapon; the one on the riven is kept, but the target does not take its ${r.layout[0]}+${r.layout[1]} layout, and changing the layout would cycle it away.`;
            }
            default:
              return "This target can't be reached with these settings.";
          }
        },
        needWeapon: "Paste a screenshot or choose a weapon.",
        needGroups: "Add a wanted stat.",
        needCard: "Finish the riven above.",
        cardProblem: (p: CardProblem, name: (tag: string) => string, value: (tag: string, n: number) => string) => {
          switch (p.kind) {
            case "cycles":
              return "Cycles done must be 0 or a whole number.";
            case "duplicate":
              return `${name(p.tag)} is on the riven twice; each stat appears once.`;
            case "notPositive":
              return `${name(p.tag)} can't be a positive trait.`;
            case "notNegative":
              return `${name(p.tag)} can't be a negative trait.`;
            case "twoSpliced":
              return "A riven holds only one spliced trait.";
            case "impossible":
              return `${name(p.tag)} can't show ${value(p.tag, p.shown)} on a ${p.layout.pos}+${p.layout.neg} riven. Check the number and its sign, and that “${show}” is ticked in game.`;
            default:
              return "Finish the riven above.";
          }
        },
        splicers: splicer,
      },
      steps: {
        unlock: `Unlock any locked trait`,
        keepSpliced: (x: string) => `Keep only ${x} locked`,
        dropSpliced: (x: string) => `Click ${x} to remove its lock (it no longer helps the target; this spends no splicer)`,
        lock: (x: string) => `${lock} → ${x}`,
        alsoKept: (x: string) => ` (${x} keeps its own lock and stays)`,
        cycle: (price: string) => cycleFor(price),
        splice: (a: string, b: string, r: string) => `${splicing}: ${a} + ${b} → ${r}`,
        missed: "Missed · kept old",
        paste: "Paste new screenshot",
        step: "This step",
        spent: `Step ${kuva}`,
        total: "Total",
        of: (n: string) => `/ ≈${n}`,
      },
      compare: {
        title: "Old or new?",
        old: "Old",
        new: "New",
        keep: (w: string) => `Keep ${w}`,
        better: "better",
        saves: (n: string) => `saves ≈ ${n}`,
        cycles: (n: string) => `${n} cycles`,
        savesCycles: (n: string) => `saves ≈ ${n} cycles`,
        even: "either one leaves as much to do",
        negNotOk: (stat: string) => `Has every wanted stat, but the negative ${stat} is not accepted in the target`,
      },
      ranges: {
        title: "Stat ranges",
        view: { class: "By weapon class", layout: "By layout" },
        sign: "Positive or negative",
        weapon: "Filter by weapon",
        stat: "Stat",
        neg: "Negative",
        cannot: "can't roll",
        roll: "roll",
        out: "out of range",
        value: "Value",
        checkHint: "Click a stat and type a value to see its roll",
        note: "Max-rank values, roll 0.90–1.10,",
      },
      kuva,
    };

  if (l === "tc")
    return {
      title: "裂罅循環助手",
      nav: { coach: "助手", ranges: "詞條範圍", guide: "機制說明" },
      contact: "問題與建議：",
      disposition: { name: "傾向", tip: "2026 年 10 月 22 日起所有武器統一為 1.2。遊戲再次調整、或看更早的截圖時才需要修改。", reset: "恢復 1.2" },
      theme: { label: "主題", auto: "跟隨系統", light: "淺色", dark: "深色" },
      category: { core: "核心", element: "元素", physical: "物理", faction: "派系", utility: "其他", spliced: "拼接" },
      search: "搜尋",
      noMatch: "沒有符合的項目",
      done: "完成",
      anyOf: "可以選多個，出現任何一個都算。",
      undo: { label: "復原", missed: "已記一次沒出", demo: "已換成範例", clear: "已清除", keep: "已選好卡" },
      card: {
        title: "目前",
        weapon: "選擇武器",
        paste: "貼上截圖",
        pasteHint: "Ctrl+V 或拖曳到頁面任意處",
        range: (lo: string, hi: string) => `範圍 ${lo} ~ ${hi}`,
        oldOnly: "現在洗不出（舊卡才有）",
        another: "換一張",
        zoom: "截圖",
        downloading: "下載辨識模型",
        downloaded: (done: string, total: string, pct: number) => `${done} / ${total} MB（${pct}%）`,
        quiet: (sec: number) => `${sec} 秒沒有新資料`,
        retried: (n: number) => `已重試 ${n} 次`,
        loading: "載入辨識模型…",
        reading: "辨識中…",
        readIn: (sec: string) => `辨識 ${sec} 秒`,
        failed: "沒認出來，請在下方手動填寫。",
        noCard: "截圖裡沒有找到特性。",
        load: "辨識模型沒有載入成功，請檢查網路後再貼一次。",
        pickStat: "特性",
        add: "新增",
        addPos: "加一條正面特性",
        addNeg: "加一條負面特性",
        remove: "刪除",
        cycles: "已循環",
        kuvaLeft: "剩餘",
        invalid: `這個數值不可能，請確認已勾選「${show}」`,
        demo: "範例",
        clear: "清除",
      },
      target: {
        title: "目標",
        add: "想要的特性",
        addAlt: "另一組目標",
        quick: {
          label: "打字設定目標",
          placeholder: "打字設定目標，如：基多射 負任意",
          apply: "填入",
          help: "可以怎麼寫",
          rules: [
            ["基多射 · 雙暴", "官方名稱和常見簡稱都認得；雙暴 = 暴擊機率 + 暴擊傷害"],
            ["腐蝕或病毒 · 腐/病", "出一個就行"],
            ["分號或換行", "另一組目標"],
            ["高雙暴 · 多重110 · 毒1.05", "檔位、數值、浮動係數"],
            ["負任意 · 不要負 · 負變焦", "負面"],
            ["3+1", "布局"],
          ] as [string, string][],
          unknown: "沒認出",
          colon: "：",
          list: "、",
          note: (why: string) => `（${why}）`,
          negAny: "負面任意",
          negList: "可接受的負面",
          why: { class: "這類武器沒有", weapon: "這把武器出不了", full: "一組最多 3 條", spliced: "每張卡只能有一條拼接特性", sets: "最多 4 組目標" },
        },
        or: "或",
        removeSet: "刪除這組目標",
        preset: { any: "不限", mid: "中", hi: "高" },
        roll: "浮動 ≥",
        value: "數值",
        never: "達不到",
        negatives: "負面",
        noNeg: "不要負面",
        accept: "可接受",
        all: "全部",
        none: "清除",
        layouts: "布局",
        more: "檔位與數量",
        tiers: "檔位",
        atLeast: "至少",
        reach: "條達到",
        atLeastNote: (ks: [string, number][], tier: string) => `另有規則：想要的特性裡${ks.map(([set, k]) => `${set ? `${set} 組` : ""}至少 ${k} 條`).join("、")}達到${tier}`,
        range: (text: string) => `範圍 ${text}`,
        oneSpliced: "每張卡只能有一條拼接特性，別的行已經選了。",
      },
      routes: {
        title: "下一步",
        sort: { kuva: `省${kuva}`, budget: `${kuva}夠用`, cycles: "省次數" },
        sortTip: {
          kuva: `平均${kuva}最少的排前面`,
          cycles: "平均循環次數最少的排前面",
          budget: `用現有${kuva}完成機率最高的排前面`,
        },
        perCycle: (p: string, n: string) => `每次循環 ${p}，平均約 ${n} 次`,
        cycles: (n: string) => `≈ ${n} 次`,
        totalCycles: (n: string) => `${n} 次`,
        spreadCycles: (n: string) => `${n} 次`,
        totalTip: { kuva: "完成平均總共花費的赤毒（含後面的步驟）", cycles: "完成平均總共循環的次數（含後面的步驟）" },
        p90: "90%",
        median: "中位",
        within: `現有${kuva}內完成`,
        rec: "薦",
        none: "不鎖定，循環",
        keepSpliced: (x: string) => `循環（「${x}」保持鎖定）`,
        drop: (x: string) => `取消「${x}」的鎖定，循環`,
        dropAnd: (x: string, then: string) => `取消「${x}」的鎖定 · ${then}`,
        lock: (x: string) => `${lock}「${x}」`,
        lockNeg: (x: string) => `${lock}「−${x}」`,
        splice: (a: string, b: string, r: string) => `${splicing}「${a}」+「${b}」→「${r}」`,
        keepWhen: "出現就選新的",
        negOk: "負面可接受",
        negBecomesOk: "負面換成可接受的",
        betterMix: "更好的組合",
        anyOf: (n: number) => `其中 ${n} 條`,
        restCompare: "其他情況：貼截圖比較",
        allCompare: "新卡好不好：貼截圖比較",
        computing: "計算中…",
        failed: (code: string) =>
          code === "start-failed"
            ? "計算模組啟動失敗，請重試或重新整理頁面。"
            : code === "too-complex"
              ? "目前目標的計算量過大，已停止。請減少「或」的組合、一行裡的可選特性或門檻再試。"
              : code === "timeout"
                ? "計算超過 30 秒，已停止。請重新計算。"
                : "計算中斷，請重新計算。",
        retry: "重新計算",
        reload: "重新整理頁面",
        done: "已經達成目標了。",
        why: (r: Unreachable, name: (tag: string) => string) => {
          switch (r.kind) {
            case "barTooHigh":
              return `「${r.tags.map(name).join("」或「")}」的門檻超過了最大浮動 1.10，在所選布局下出不來。`;
            case "tooMany":
              return `目標有 ${r.need} 條特性，所選布局最多只有 ${r.max} 條正面。`;
            case "noNegative":
              return "所選布局都帶負面，但可接受的負面一個都沒選。";
            case "cannotRoll": {
              const x = `「${r.tags.map(name).join("」或「")}」`;
              if (r.onCard === "none") return `${x}這把武器洗不出來。`;
              if (r.onCard === "bar") return `${x}這把武器已經洗不出來了，卡上原有的會保留，但達不到門檻。`;
              return `${x}這把武器已經洗不出來了，卡上原有的會保留，但它在 ${r.layout[0]}+${r.layout[1]} 的卡上，目標沒選這個布局：換布局會把它洗掉。`;
            }
            default:
              return "按照目前的設定達不到這個目標。";
          }
        },
        needWeapon: "貼一張截圖，或先選擇武器。",
        needGroups: "加一條想要的特性。",
        needCard: "把目前的卡填完整。",
        cardProblem: (p: CardProblem, name: (tag: string) => string, value: (tag: string, n: number) => string) => {
          switch (p.kind) {
            case "cycles":
              return "已循環次數要填 0 或正整數。";
            case "duplicate":
              return `「${name(p.tag)}」出現了兩次，一張卡上每種特性只有一條。`;
            case "notPositive":
              return `「${name(p.tag)}」不能作為正面特性。`;
            case "notNegative":
              return `「${name(p.tag)}」不能作為負面特性。`;
            case "twoSpliced":
              return "一張卡只能有一條拼接特性。";
            case "impossible":
              return `${p.layout.pos}+${p.layout.neg} 的卡上「${name(p.tag)}」不可能是 ${value(p.tag, p.shown)}：檢查數字和正負號，以及遊戲裡是否勾選了「${show}」。`;
            default:
              return "把目前的卡填完整。";
          }
        },
        splicers: splicer,
      },
      steps: {
        unlock: "如有鎖定，先取消",
        keepSpliced: (x: string) => `只保留「${x}」的鎖定`,
        dropSpliced: (x: string) => `點「${x}」取消它的鎖定（它對目標已經沒用，取消不會再花${splicer}）`,
        lock: (x: string) => `點「${lock}」→「${x}」`,
        alsoKept: (x: string) => `（「${x}」自帶鎖定，也會保留）`,
        cycle: (price: string) => `點「${cycleFor(price)}」`,
        splice: (a: string, b: string, r: string) => `「${splicing}」：「${a}」+「${b}」→「${r}」`,
        missed: "沒出 · 保留舊的",
        paste: "貼新截圖",
        step: "本步",
        spent: `本步${kuva}`,
        total: "累計",
        of: (n: string) => `/ ≈${n}`,
      },
      compare: {
        title: "留新的還是舊的",
        old: "舊",
        new: "新",
        keep: (w: string) => `留${w}的`,
        better: "更好",
        saves: (n: string) => `少花約 ${n}`,
        cycles: (n: string) => `${n} 次`,
        savesCycles: (n: string) => `少循環約 ${n} 次`,
        even: "留哪張都一樣",
        negNotOk: (stat: string) => `想要的詞條都有了，但目標不接受負面「${stat}」`,
      },
      ranges: {
        title: "詞條範圍",
        view: { class: "按武器類型", layout: "按詞條分布" },
        sign: "正面或負面",
        weapon: "按武器篩選",
        stat: "特性",
        neg: "負面",
        cannot: "出不了",
        roll: "浮動",
        out: "超出範圍",
        value: "數值",
        checkHint: "點特性名稱，輸入數值看浮動係數",
        note: "滿級數值，浮動 0.90–1.10，",
      },
      kuva,
    };

  return {
    title: l === "cn" ? "裂隙振幅晶体循环助手" : "裂罅循环助手",
    nav: { coach: "助手", ranges: "词条范围", guide: "机制说明" },
    contact: "问题和建议：",
    disposition: { name: "倾向", tip: "2026 年 10 月 22 日起所有武器统一 1.2。游戏再改、或者看更早的截图时才需要改。", reset: "恢复 1.2" },
    theme: { label: "主题", auto: "跟随系统", light: "浅色", dark: "深色" },
    category: { core: "核心", element: "元素", physical: "物理", faction: "派系", utility: "其他", spliced: "熔接" },
    search: "搜索",
    noMatch: "没有匹配",
    done: "完成",
    anyOf: "可以选多个，出现任何一个都算。",
    undo: { label: "撤销", missed: "已记一次没出", demo: "已换成示例", clear: "已清空", keep: "已选好卡" },
    card: {
      title: "当前",
      weapon: "选择武器",
      paste: "贴截图",
      pasteHint: "Ctrl+V 或拖到页面任意处",
      range: (lo: string, hi: string) => `范围 ${lo} ~ ${hi}`,
      oldOnly: "现在洗不出（旧卡才有）",
      another: "换一张",
      zoom: "截图",
      downloading: "下载识别模型",
      downloaded: (done: string, total: string, pct: number) => `${done} / ${total} MB（${pct}%）`,
      quiet: (sec: number) => `${sec} 秒没有新数据`,
      retried: (n: number) => `已重试 ${n} 次`,
      loading: "加载识别模型…",
      reading: "识别中…",
      readIn: (sec: string) => `识别 ${sec} 秒`,
      failed: "没认出来，在下面手动填。",
      noCard: "截图里没有找到属性。",
      load: "识别模型没加载成功，检查网络后再贴一次。",
      pickStat: "属性",
      add: "添加",
      addPos: "加一条正面属性",
      addNeg: "加一条负面属性",
      remove: "删除",
      cycles: "已循环",
      kuvaLeft: "剩余",
      invalid: `这个数值不可能，确认勾选了「${show}」`,
      demo: "示例",
      clear: "清空",
    },
    target: {
      title: "目标",
      add: "想要的属性",
      addAlt: "另一组目标",
      quick: {
        label: "打字设目标",
        placeholder: "打字设目标，如：基多射 负任意",
        apply: "填入",
        help: "可以怎么写",
        rules: [
          ["基多射 · 双暴", "官方名称和常见简称都认；双暴 = 暴击几率 + 暴击伤害"],
          ["腐蚀或病毒 · 腐/病", "出一个就行"],
          ["分号或换行", "另一组目标"],
          ["高双暴 · 多重110 · 毒1.05", "档位、数值、浮动系数"],
          ["负任意 · 不要负 · 负变焦", "负面"],
          ["3+1", "布局"],
        ] as [string, string][],
        unknown: "没认出",
        colon: "：",
        list: "、",
        note: (why: string) => `（${why}）`,
        negAny: "负面任意",
        negList: "可接受负面",
        why: { class: "这类武器没有", weapon: "这把武器出不了", full: "一组最多 3 条", spliced: "每张卡只能有一条熔接", sets: "最多 4 组目标" },
      },
      or: "或",
      removeSet: "删除这组目标",
      preset: { any: "不限", mid: "中", hi: "高" },
      roll: "浮动 ≥",
      value: "数值",
      never: "达不到",
      negatives: "负面",
      noNeg: "不要负面",
      accept: "可接受",
      all: "全部",
      none: "清空",
      layouts: "布局",
      more: "档位与数量",
      tiers: "档位",
      atLeast: "至少",
      reach: "条达到",
      atLeastNote: (ks: [string, number][], tier: string) => `另有规则：想要的属性里${ks.map(([set, k]) => `${set ? `${set} 组` : ""}至少 ${k} 条`).join("、")}达到${tier}`,
      range: (text: string) => `范围 ${text}`,
      oneSpliced: "每张卡只能有一条熔接属性，别的行已经选了。",
    },
    routes: {
      title: "下一步",
      sort: { kuva: `省${kuva}`, budget: `${kuva}够用`, cycles: "省次数" },
      sortTip: {
        kuva: `平均${kuva}最少的排前面`,
        cycles: "平均循环次数最少的排前面",
        budget: `用现有${kuva}做完的概率最高的排前面`,
      },
      perCycle: (p: string, n: string) => `每次循环 ${p}，平均约 ${n} 次`,
      cycles: (n: string) => `≈ ${n} 次`,
      totalCycles: (n: string) => `${n} 次`,
      spreadCycles: (n: string) => `${n} 次`,
      totalTip: { kuva: "做完平均总共花的赤毒（含后面的步骤）", cycles: "做完平均总共循环的次数（含后面的步骤）" },
      p90: "90%",
      median: "中位",
      within: `现有${kuva}内完成`,
      rec: "荐",
      none: "不锁定，循环",
      keepSpliced: (x: string) => `循环（「${x}」保持锁定）`,
      drop: (x: string) => `取消「${x}」的锁定，循环`,
      dropAnd: (x: string, then: string) => `取消「${x}」的锁定 · ${then}`,
      lock: (x: string) => `${lock}「${x}」`,
      lockNeg: (x: string) => `${lock}「−${x}」`,
      splice: (a: string, b: string, r: string) => `${splicing}「${a}」+「${b}」→「${r}」`,
      keepWhen: "出现就选新的",
      negOk: "负面可接受",
      negBecomesOk: "负面换成可接受的",
      betterMix: "更好的组合",
      anyOf: (n: number) => `其中 ${n} 条`,
      restCompare: "其他情况：贴截图比较",
      allCompare: "新卡好不好：贴截图比较",
      computing: "计算中…",
      failed: (code: string) =>
        code === "start-failed"
          ? "计算模块启动失败，请重试或刷新页面。"
          : code === "too-complex"
            ? "当前目标计算量过大，已停止。请减少「或」的组合、一行里的可选属性或门槛再试。"
            : code === "timeout"
              ? "计算超过 30 秒，已停止。请重新计算。"
              : "计算中断，请重新计算。",
      retry: "重新计算",
      reload: "刷新页面",
      done: "已经达到目标了。",
      why: (r: Unreachable, name: (tag: string) => string) => {
        switch (r.kind) {
          case "barTooHigh":
            return `「${r.tags.map(name).join("」或「")}」的门槛超过了最大浮动 1.10，在所选布局下出不来。`;
          case "tooMany":
            return `目标有 ${r.need} 条属性，所选布局最多只有 ${r.max} 条正面。`;
          case "noNegative":
            return "所选布局都带负面，但可接受的负面一个都没选。";
          case "cannotRoll": {
            const x = `「${r.tags.map(name).join("」或「")}」`;
            if (r.onCard === "none") return `${x}这把武器洗不出来。`;
            if (r.onCard === "bar") return `${x}这把武器已经洗不出来了，卡上原有的会保留，但达不到门槛。`;
            return `${x}这把武器已经洗不出来了，卡上原有的会保留，但它在 ${r.layout[0]}+${r.layout[1]} 的卡上，目标没选这个布局：换布局会把它洗掉。`;
          }
          default:
            return "按现在的设置达不到这个目标。";
        }
      },
      needWeapon: "贴一张截图，或者先选武器。",
      needGroups: "加一条想要的属性。",
      needCard: "把当前的卡填完整。",
      cardProblem: (p: CardProblem, name: (tag: string) => string, value: (tag: string, n: number) => string) => {
        switch (p.kind) {
          case "cycles":
            return "已循环次数要填 0 或正整数。";
          case "duplicate":
            return `「${name(p.tag)}」出现了两次，一张卡上每个属性只有一条。`;
          case "notPositive":
            return `「${name(p.tag)}」不能作为正面属性。`;
          case "notNegative":
            return `「${name(p.tag)}」不能作为负面属性。`;
          case "twoSpliced":
            return "一张卡只能有一条熔接属性。";
          case "impossible":
            return `${p.layout.pos}+${p.layout.neg} 的卡上「${name(p.tag)}」不可能是 ${value(p.tag, p.shown)}：检查数字和正负号，以及游戏里是否勾选了「${show}」。`;
          default:
            return "把当前的卡填完整。";
        }
      },
      splicers: splicer,
    },
    steps: {
      unlock: "如有锁定，先取消",
      keepSpliced: (x: string) => `只保留「${x}」的锁定`,
      dropSpliced: (x: string) => `点「${x}」取消它的锁定（它对目标已经没用，取消不会再花熔接器）`,
      lock: (x: string) => `点「${lock}」→「${x}」`,
      alsoKept: (x: string) => `（「${x}」自带锁定，也会保留）`,
      cycle: (price: string) => `点「${cycleFor(price)}」`,
      splice: (a: string, b: string, r: string) => `「${splicing}」：「${a}」+「${b}」→「${r}」`,
      missed: "没出 · 保留旧的",
      paste: "贴新截图",
      step: "本步",
      spent: `本步${kuva}`,
      total: "累计",
      of: (n: string) => `/ ≈${n}`,
    },
    compare: {
      title: "留新的还是旧的",
      old: "旧",
      new: "新",
      keep: (w: string) => `留${w}的`,
      better: "更好",
      saves: (n: string) => `少花约 ${n}`,
      cycles: (n: string) => `${n} 次`,
      savesCycles: (n: string) => `少循环约 ${n} 次`,
      even: "留哪张都一样",
      negNotOk: (stat: string) => `想要的词条都有了，但目标不接受负面「${stat}」`,
    },
    ranges: {
      title: "词条范围",
      view: { class: "按武器类型", layout: "按词条分布" },
      sign: "正面或负面",
      weapon: "按武器筛选",
      stat: "属性",
      neg: "负面",
      cannot: "出不了",
      roll: "浮动",
      out: "超出范围",
      value: "数值",
      checkHint: "点属性名，输入数值看浮动系数",
      note: "满级数值，浮动 0.90–1.10，",
    },
    kuva,
  };
}

export type Strings = ReturnType<typeof strings>;

/** "141 万" / "141 萬" / "1.41M"; `fine` keeps one decimal of 万 even for large totals. */
export function fmtKuva(n: number, l: Lang, fine = false): string {
  if (!Number.isFinite(n)) return "—";
  if (l === "en") return n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n));
  if (n >= 1e4) return `${n >= 1e6 && !fine ? Math.round(n / 1e4) : (n / 1e4).toFixed(1)} ${l === "tc" ? "萬" : "万"}`;
  return Math.round(n).toLocaleString("zh-CN");
}

export function fmtPct(p: number): string {
  if (p >= 0.995) return "> 99%";
  if (p < 0.001) return "< 0.1%";
  return `${(p * 100).toFixed(p < 0.1 ? 2 : 1)}%`;
}
