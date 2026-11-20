// Observed page events -> training rows in the phone schema (phone-ctr-v1). Runs on this computer only.
import type { Schema } from "../../frontend/src/phone/client.ts";

/** One link the person saw (an impression) with its topic and where it sat on the page. y = 1 if they clicked it. Same shape the phone page
 *  records. `w` is the training weight: 1, or for a click 1 + how long they stayed on the page it led to (see background.ts). No address or
 *  site name is kept. */
export interface Ev { id: number; t: number; cat: string; placement: string; hour: number; dev: number; raw: Record<string, number>; y: number; w?: number }

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

export function buildRows(S: Schema, events: Ev[]): { X: Float64Array; y: Float64Array; w: Float64Array } {
  const X = new Float64Array(events.length * S.n_features);
  events.forEach((e, i) => X.set(encodeRow(S, e), i * S.n_features));
  return { X, y: Float64Array.from(events.map((e) => e.y)), w: Float64Array.from(events.map((e) => e.w ?? 1)) };
}

