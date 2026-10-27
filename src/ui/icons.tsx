import { useState } from "react";
import type { Weapon } from "../engine/data";

const BASE = import.meta.env.BASE_URL;
/** Digital Extremes' Public Export image CDN */
const CDN = "https://content.warframe.com/PublicExport/";

const DAMAGE: Record<string, string> = {
  WeaponImpactDamageMod: "impact",
  WeaponArmorPiercingDamageMod: "puncture",
  WeaponSlashDamageMod: "slash",
  WeaponFireDamageMod: "heat",
  WeaponFreezeDamageMod: "cold",
  WeaponElectricityDamageMod: "electricity",
  WeaponToxinDamageMod: "toxin",
  WeaponBlastDamageMod: "blast",
  WeaponCorrosiveDamageMod: "corrosive",
  WeaponGasDamageMod: "gas",
  WeaponMagneticDamageMod: "magnetic",
  WeaponRadiationDamageMod: "radiation",
  WeaponViralDamageMod: "viral",
};

export const hasStatIcon = (tag: string) => tag in DAMAGE;

/** The game's damage-type symbol in front of elemental and physical stats; nothing for other stats. */
export function StatIcon({ tag }: { tag: string }) {
  const f = DAMAGE[tag];
  return f ? <img className="ico stat-ico" src={`${BASE}icons/dt-${f}.png`} alt="" width={18} height={18} /> : null;
}

export function KuvaIcon({ label }: { label?: string }) {
  return <img className="ico kuva-ico" src={`${BASE}icons/kuva.png`} alt={label ?? ""} title={label} width={18} height={18} />;
}

export function SplicerIcon({ label }: { label?: string }) {
  return <img className="ico splicer-ico" src={`${BASE}icons/splicer.png`} alt={label ?? ""} title={label} width={20} height={20} />;
}

/** An envelope, drawn in the text colour: says "this is an e-mail address". */
export function MailIcon() {
  return (
    <svg className="ico mail-ico" viewBox="0 0 20 20" width={16} height={16} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="2.5" y="4.5" width="15" height="11" rx="1.5" />
      <path d="M3 5.5 10 11l7-5.5" strokeLinejoin="round" />
    </svg>
  );
}

/** 文 and A: says "language" to a reader of any of them, which a flag can't. */
export function TranslateIcon() {
  return (
    <svg
      className="ico translate-ico"
      viewBox="0 0 20 20"
      width={18}
      height={18}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 2.5v1.8M2.5 5h7M4 5.6c.9 2.9 2.7 5 5.4 6.6M8.4 5.6c-.9 2.9-2.7 5-5.6 6.6" />
      <path d="m10.8 17.5 3.2-8 3.2 8M11.9 15h4.2" />
    </svg>
  );
}

export function RivenMark({ size = 28 }: { size?: number }) {
  return <img className="riven-mark" src={`${BASE}icons/riven.png`} alt="" width={size} height={size} />;
}

/** The weapon's official store image; hides itself if the CDN can't be reached. */
export function WeaponImage({ weapon, className }: { weapon: Weapon | undefined; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!weapon?.icon || failed === weapon.icon) return <span className={`weapon-img empty${className ? ` ${className}` : ""}`} aria-hidden="true" />;
  return (
    <img
      key={weapon.icon}
      className={`weapon-img${className ? ` ${className}` : ""}`}
      src={CDN + weapon.icon}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(weapon.icon)}
    />
  );
}
