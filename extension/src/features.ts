// Observed page events -> training rows in the phone schema (phone-ctr-v1). Runs on this computer only.
import type { Schema } from "../../frontend/src/phone/client.ts";

/** One page view with its topic. y = 1 if the person clicked something on it. Same shape the phone page records. No address or site name. */
export interface Ev { id: number; t: number; cat: string; placement: string; hour: number; dev: number; raw: Record<string, number>; y: number }

export function encodeRow(S: Schema, e: Ev): number[] {
  const row = new Array<number>(S.n_features).fill(0);
  const hot = (group: string, value: string | number) => {
    const g = S.groups.find((x) => x.name === group)!;
    const i = typeof value === "number" ? value : g.values.indexOf(value);
    if (i >= 0) row[g.offset + i] = 1;
  };
  hot("device", e.dev); hot("hour_bucket", e.hour); hot("ad_category", e.cat); hot("placement", e.placement);
  S.numeric.forEach((d, j) => {
    row[S.numeric_offset + j] = Math.max(-S.numeric_clamp, Math.min(S.numeric_clamp, ((e.raw[d.name] ?? d.center) - d.center) / d.scale));
  });
  return row;
}

export function buildRows(S: Schema, events: Ev[]): { X: Float64Array; y: Float64Array } {
  const X = new Float64Array(events.length * S.n_features);
  events.forEach((e, i) => X.set(encodeRow(S, e), i * S.n_features));
  return { X, y: Float64Array.from(events.map((e) => e.y)) };
}

export function summarize(events: Ev[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const e of events) c[e.cat] = (c[e.cat] ?? 0) + 1;
  return c;
}

