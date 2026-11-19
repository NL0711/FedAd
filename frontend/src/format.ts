import type { Num, Stat } from "./types";

export const COLORS = { blue: "#0072B2", orange: "#D55E00", green: "#009E73", grey: "#4b5563", light: "#d1d5db" };

export function fixed(x: Num | undefined, digits = 3): string {
  return x === null || x === undefined || !Number.isFinite(x) ? "n/a" : x.toFixed(digits);
}

export function pm(s: Stat, digits = 3): string {
  if (!Number.isFinite(s.mean)) return "n/a";
  return `${s.mean.toFixed(digits)} ± ${s.ci.toFixed(digits)}`;
}

/** Epsilon with sensible precision: 0 means "no DP", large values lose decimals. */
export function eps(x: Num | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "n/a";
  if (x === 0) return "none";
  if (x >= 100) return x.toFixed(0);
  if (x >= 10) return x.toFixed(1);
  return x.toFixed(2);
}

export function kb(x: Num | undefined): string {
  return fixed(x, 3) + " KB";
}
