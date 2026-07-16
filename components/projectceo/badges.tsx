import type { ReactNode } from "react";

const TONES = {
  neutral: "border-line bg-line/30 text-muted",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-red-200 bg-red-50 text-red-800",
  accent: "border-orange-200 bg-orange-50 text-accent",
} as const;

export function Badge({
  children,
  tone = "neutral",
}: {
  readonly children: ReactNode;
  readonly tone?: keyof typeof TONES;
}) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Metric({
  label,
  value,
  hint,
}: {
  readonly label: string;
  readonly value: string | number;
  readonly hint?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-white p-4 shadow-sm">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 font-display text-3xl font-semibold text-ink">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}
