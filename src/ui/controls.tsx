import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { DEFAULT_DISPOSITION, DISPOSITION_MAX, DISPOSITION_MIN, formatDisposition, tidyDisposition } from "../engine/formula";

/** A panel anchored under its trigger; a bottom sheet on narrow screens. Esc or a click outside closes it. */
export function Pop({
  trigger,
  children,
  wide,
}: {
  trigger: (p: { open: boolean; toggle: () => void; id: string }) => ReactNode;
  children: (close: () => void) => ReactNode;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div className="pop" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o), id })}
      {open && (
        <div className={`pop-panel${wide ? " wide" : ""}`} id={id} role="dialog">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  multi,
}: {
  value: T | T[];
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  label: string;
  multi?: boolean;
}) {
  const on = (v: T) => (Array.isArray(value) ? value.includes(v) : value === v);
  return (
    <fieldset className="seg" aria-label={label} data-multi={multi || undefined}>
      {options.map((o) => (
        <button key={o.value} type="button" title={o.title} aria-pressed={on(o.value)} className={on(o.value) ? "on" : undefined} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}

/**
 * A number as players type it: 104.5, 104,5 (a decimal comma, as some game settings show it), +104.5%, x1,49 or
 * 1,234 (thousands). null when empty, NaN when it is not a number.
 */
export function parseTyped(s: string): number | null {
  // one comma with one or two digits after it, and no dot: the decimal point
  const decimalComma = /^[^.,，]*[,，]\d{1,2}\s*[%％]?\s*$/.test(s.trim());
  const cleaned = (decimalComma ? s.replace(/[,，]/, ".") : s).replace(/[,，\s%％xX×+＋]/g, "").replace(/[−–—]/g, "-");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** A box's width in characters: its usual size, or wider for what it shows ("out of reach", 1.0365); a Chinese character takes two. */
export function fieldSize(text: string, size: number): number {
  return Math.max(
    size,
    [...text].reduce((n, ch) => n + (/[⺀-￿]/.test(ch) ? 2 : 1), 0),
  );
}

/**
 * A number box that accepts how players write numbers ("140", "140%", "+140", "x1.5", "1,234"),
 * shows its value formatted when not being edited, commits on Enter or blur, reverts on Esc,
 * and steps with the arrow keys.
 */
export function NumberField({
  value,
  onCommit,
  format = (n) => String(n),
  label,
  placeholder,
  step,
  min,
  max,
  className,
  size = 6,
  autoFocus,
}: {
  value: number | null;
  onCommit: (n: number | null) => void;
  format?: (n: number) => string;
  label: string;
  placeholder?: string;
  step?: number;
  min?: number;
  max?: number;
  className?: string;
  size?: number;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  const cancelBlur = useRef(false);
  // the text the box opened with: leaving it unchanged changes nothing (a roll bar must not become a shown value)
  const opened = useRef<string | null>(null);
  const shown = text ?? (value == null ? "" : format(value));
  const clamp = (n: number) => Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, n));
  const commit = (s: string) => {
    const n = parseTyped(s);
    setText(null);
    if (Number.isNaN(n as number)) return;
    onCommit(n == null ? null : clamp(n));
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      size={fieldSize(shown, size)}
      className={`num${className ? ` ${className}` : ""}`}
      // biome-ignore lint/a11y/noAutofocus: only set where the player just asked for this box
      autoFocus={autoFocus}
      aria-label={label}
      placeholder={placeholder}
      value={shown}
      onFocus={(e) => {
        cancelBlur.current = false;
        opened.current = value == null ? "" : String(value);
        setText(opened.current);
        requestAnimationFrame(() => e.target.select());
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => {
        if (cancelBlur.current || e.target.value === opened.current) {
          cancelBlur.current = false;
          setText(null);
        } else commit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        else if (e.key === "Escape") {
          cancelBlur.current = true;
          setText(null);
          (e.target as HTMLInputElement).blur();
        } else if (step && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          e.preventDefault();
          const base = parseTyped(text ?? "") ?? value ?? 0;
          const n = clamp(Math.round(((Number.isNaN(base) ? 0 : base) + (e.key === "ArrowUp" ? step : -step)) * 1000) / 1000);
          setText(String(n));
          onCommit(n);
        }
      }}
    />
  );
}

/** The weapon's disposition (倾向): 1.2 for every weapon now; a value of the player's own is marked, with a way back. */
export function DispositionField({ value, onChange, labels }: { value: number; onChange: (d: number) => void; labels: { name: string; tip: string; reset: string } }) {
  const own = Math.abs(value - DEFAULT_DISPOSITION) > 1e-9;
  return (
    <span className={`disp${own ? " own" : ""}`} title={labels.tip}>
      {labels.name}
      <NumberField
        label={labels.name}
        value={value}
        format={formatDisposition}
        min={DISPOSITION_MIN}
        max={DISPOSITION_MAX}
        step={0.01}
        size={4}
        onCommit={(n) => onChange(n == null ? DEFAULT_DISPOSITION : tidyDisposition(n))}
      />
      {own && (
        <button type="button" className="text-btn" onClick={() => onChange(DEFAULT_DISPOSITION)}>
          {labels.reset}
        </button>
      )}
    </span>
  );
}

/** Drag or type: a range slider with a number box bound to the same value. */
export function NumberSlider({ label, value, onChange, min, max, step }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number }) {
  const [drag, setDrag] = useState<number | null>(null);
  const v = drag ?? value;
  return (
    <span className="slider">
      <span className="slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        aria-label={label}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={() => {
          if (drag != null && drag !== value) onChange(drag);
          setDrag(null);
        }}
        onKeyUp={() => {
          if (drag != null && drag !== value) onChange(drag);
          setDrag(null);
        }}
      />
      <NumberField label={label} value={v} format={(n) => n.toFixed(2)} min={min} max={max} step={step} size={4} onCommit={(n) => n != null && onChange(n)} />
    </span>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" aria-checked={checked} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}
