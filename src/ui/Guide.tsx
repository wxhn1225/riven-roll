import { GAME, type Lang, statOf } from "../engine/data";
import { KuvaIcon, RivenMark, SplicerIcon, StatIcon } from "./icons";

/** A stat with its in-game symbol and official name. */
function Stat({ tag, lang }: { tag: string; lang: Lang }) {
  return (
    <span className="stat-name">
      <StatIcon tag={tag} />
      {statOf("Rifle", tag).name[lang]}
    </span>
  );
}

/** Toxin + Cold → Viral, drawn with the game's symbols. */
function Recipe({ lang }: { lang: Lang }) {
  return (
    <p className="recipe">
      <Stat tag="WeaponToxinDamageMod" lang={lang} /> + <Stat tag="WeaponFreezeDamageMod" lang={lang} /> → <Stat tag="WeaponViralDamageMod" lang={lang} />
    </p>
  );
}

function Physical({ lang }: { lang: Lang }) {
  return (
    <>
      <Stat tag="WeaponImpactDamageMod" lang={lang} /> <Stat tag="WeaponArmorPiercingDamageMod" lang={lang} /> <Stat tag="WeaponSlashDamageMod" lang={lang} />
    </>
  );
}

const LAYOUT_ROWS: [string, string, string][] = [
  ["2+0", "0.99", "—"],
  ["2+1", "1.2375", "−0.495"],
  ["3+0", "0.75", "—"],
  ["3+1", "0.9375", "−0.75"],
];

function LayoutTable({ head }: { head: [string, string, string] }) {
  return (
    <table>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {LAYOUT_ROWS.map(([a, b, c]) => (
          <tr key={a}>
            <td className="fig">{a}</td>
            <td className="fig">{b}</td>
            <td className="fig">{c}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Guide({ lang }: { lang: Lang }) {
  const t = (k: string) => GAME.ui[k][lang];
  const [riven, lock, splicing, splicer, show] = [t("riven"), t("lockTrait"), t("splicing"), t("splicer"), t("showRanked")];

  if (lang === "en")
    return (
      <article className="article">
        <h2>
          <RivenMark size={26} />
          Roll
        </h2>
        <div className="formula">value = base × 90 × 1.2 × L × W</div>
        <p>
          <b>base</b> comes from the weapon class, <b>1.2</b> is the disposition (the same for every weapon since 22 October 2026; it can be changed next to the weapon's name),{" "}
          <b>L</b> comes from the layout, and <b>W</b> is the roll, 0.9 to 1.1. Tick “{show}” before taking the screenshot.
        </p>
        <LayoutTable head={["", "+", "−"]} />

        <h2>Name</h2>
        <p>Prefix = the positive with the highest W, core = second, suffix = lowest. Negatives are not in the name.</p>

        <h2>{lock}</h2>
        <ul>
          <li>
            One trait at a time, the cycle costs <KuvaIcon /> ×2.
          </li>
          <li>The layout stays the same; leaving the screen clears the lock.</li>
          <li>
            Any lock keeps the current layout, so a negative you accept is a cheap one to lock. Only when the riven is already 3+1 and the target needs 3+1: unlocked, about 25% of
            cycles are 3+1 (assuming the four layouts are equally likely); locked, every one is, so hits go up at least ×4 for ×2 the price. A spliced trait already holds the
            layout, so this gains nothing there.
          </li>
        </ul>

        <h2>
          <SplicerIcon />
          {splicing}
        </h2>
        <Recipe lang={lang} />
        <ul>
          <li>Two ingredients become one spliced trait with the higher of their two rolls, whether an ingredient is a positive or the negative.</li>
          <li>A random trait refills the slot; the layout stays frozen while the spliced trait is on the riven.</li>
          <li>
            The spliced trait is locked for free, so one more trait can be locked. One per {riven}; {splicer}s come from The Icebind.
          </li>
          <li>Its lock can be removed: the next cycle replaces it and the layout is free again.</li>
          <li>The coach splices only for a spliced stat the target wants, one {splicer} per riven, and never has you unlock a spliced trait that still counts.</li>
        </ul>

        <h2>The last step</h2>
        <p>It needs the exact trait, a good roll and an accepted negative in one cycle. Put the high bars on the traits you lock or splice, relax the last one.</p>

        <h2>Assumptions</h2>
        <ul>
          <li>Calculations assume each layout is 25%, eligible stats are equally likely and W is uniform; these probabilities are not verified server rules.</li>
          <li>
            The least-Kuva policy uses the steady per-cycle price. Its reported mean accounts separately for the cheaper first nine cycles; it is not an exact optimal policy for
            those introductory prices.
          </li>
          <li>
            Which of <Physical lang={lang} /> a riven can roll follows the game's setting for the weapon, which can differ from the damage split in the arsenal (a variant counts
            its base weapon's); Zaws and kitguns can roll all three.
          </li>
          <li>Screenshots are read in your browser and never uploaded.</li>
        </ul>
      </article>
    );

  if (lang === "tc")
    return (
      <article className="article">
        <h2>
          <RivenMark size={26} />
          浮動係數
        </h2>
        <div className="formula">數值 = 基礎係數 × 90 × 1.2 × L × W</div>
        <p>
          <b>基礎係數</b>由武器大類決定，<b>1.2</b> 是傾向（2026 年 10 月 22 日起所有武器統一，武器名稱旁邊可以修改），<b>L</b> 由布局決定，<b>W</b> 就是浮動係數，0.9 到
          1.1。截圖前先勾選「{show}」。
        </p>
        <LayoutTable head={["", "+", "−"]} />

        <h2>名稱</h2>
        <p>字首 = W 最高的正面特性，中間第二，字尾最低。負面特性不會出現在名稱裡。</p>

        <h2>{lock}</h2>
        <ul>
          <li>
            一次一條，循環價格 <KuvaIcon /> ×2。
          </li>
          <li>布局不變；離開循環介面後鎖定失效。</li>
          <li>
            鎖哪一條都會固定目前的布局，所以常鎖一條能接受的負面。只有卡已經是 3+1、目標也只要 3+1 時：不鎖大約只有 25% 的循環是
            3+1（按四種布局機率相同計算），鎖住後每次都是，命中至少 ×4，價格 ×2。已有拼接特性時布局本來就固定，鎖負面沒有這個好處。
          </li>
        </ul>

        <h2>
          <SplicerIcon />
          {splicing}
        </h2>
        <Recipe lang={lang} />
        <ul>
          <li>兩條原料合成一條拼接特性，W 取兩者中較高的，原料是正面還是負面都一樣。</li>
          <li>空位隨機補一條；拼接特性在卡上時布局凍結。</li>
          <li>
            拼接特性自帶鎖定且不加價，還能再鎖一條。每張{riven}最多一條；{splicer}來自冰縛。
          </li>
          <li>它的鎖定可以取消：下次循環會把它洗掉，布局也不再凍結。</li>
          <li>
            助手只在目標要拼接特性時才讓你拼接，一張{riven}最多用一個{splicer}；還算數的拼接特性不會讓你取消鎖定。
          </li>
        </ul>

        <h2>最後一步</h2>
        <p>要在同一次循環裡同時出現指定特性、浮動達標、負面可接受。把高門檻放在鎖定和拼接的那兩條上，最後一條放寬。</p>

        <h2>假設</h2>
        <ul>
          <li>計算假設四種布局各 25%、可出特性機率相同、W 均勻分布；這些機率尚未確認為伺服器規則。</li>
          <li>省赤毒路線按穩定的單次價格規劃，前九次優惠另外計入實際平均；不保證這九次採用的也是最省赤毒的策略。</li>
          <li>
            <Physical lang={lang} /> 能出哪幾種按遊戲對這把武器的設定，不一定和軍械庫裡的傷害比例一致（變體按原型武器計算）；Zaw 和組合槍三種都能出。
          </li>
          <li>截圖只在你的瀏覽器裡辨識，不會上傳。</li>
        </ul>
      </article>
    );

  return (
    <article className="article">
      <h2>
        <RivenMark size={26} />
        浮动系数
      </h2>
      <div className="formula">数值 = 基础系数 × 90 × 1.2 × L × W</div>
      <p>
        <b>基础系数</b>由武器大类决定，<b>1.2</b> 是倾向（2026 年 10 月 22 日起所有武器统一，武器名旁边可以改），<b>L</b> 由布局决定，<b>W</b> 就是浮动系数，0.9 到
        1.1。截图前先勾选「{show}」。
      </p>
      <LayoutTable head={["", "+", "−"]} />

      <h2>名字</h2>
      <p>前缀 = W 最高的正面属性，中缀第二，后缀最低。负面属性不进名字。</p>

      <h2>{lock}</h2>
      <ul>
        <li>
          一次一条，循环价格 <KuvaIcon /> ×2。
        </li>
        <li>布局不变；离开循环界面后锁定失效。</li>
        <li>
          锁哪一条都会固定当前布局，所以常锁一条能接受的负面。只有卡已经是 3+1、目标也只要 3+1 时：不锁大约只有 25% 的循环是 3+1（按四种布局等概率算），锁住后次次都是，命中至少
          ×4，价格 ×2。已有熔接属性时布局本来就固定，锁负没有这个好处。
        </li>
      </ul>

      <h2>
        <SplicerIcon />
        {splicing}
      </h2>
      <Recipe lang={lang} />
      <ul>
        <li>两条原料合成一条熔接属性，W 取两者中较高的，原料是正面还是负面都一样。</li>
        <li>空位随机补一条；熔接属性在卡上时布局冻结。</li>
        <li>
          熔接属性自带锁定且不加价，还能再锁一条。每张{riven}最多一条；{splicer}来自冰封羁绊。
        </li>
        <li>它的锁定可以取消：下次循环会把它洗掉，布局也不再冻结。</li>
        <li>
          助手只在目标要熔接属性时才让你熔接，一张{riven}最多用一个{splicer}；还算数的熔接属性不会让你取消锁定。
        </li>
      </ul>

      <h2>最后一步</h2>
      <p>要在同一次循环里同时出现指定属性、浮动达标、负面可接受。把高门槛放在锁定和熔接的那两条上，最后一条放宽。</p>

      <h2>假设</h2>
      <ul>
        <li>计算假设四种布局各 25%、可出属性等概率、W 均匀分布；这些概率尚未确认为服务端规则。</li>
        <li>省赤毒路线按稳定的单次价格规划，前九次优惠单独计入实际均值；不保证这九次采用的也是最低赤毒策略。</li>
        <li>
          <Physical lang={lang} /> 能出哪几种按游戏对这把武器的设定，不一定和军械库里的伤害比例一致（变体按原型武器算）；Zaw 和组合枪三种都能出。
        </li>
        <li>截图只在你的浏览器里识别，不会上传。</li>
      </ul>
    </article>
  );
}
