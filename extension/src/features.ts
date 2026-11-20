// Observed page events -> training rows in the phone schema (phone-ctr-v1), and the vertical-FL profile. Runs on this computer only.
import type { Schema } from "../../frontend/src/phone/client.ts";

/** One product card the user saw on the campaign's site. y = 1 if they clicked it. Same shape the phone page records. */
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

/** Vertical FL profile for the ad platform: 8 category shares then 6 hour shares (each block sums to 1; taps count double), scaled
 *  to L2 norm <= `clip`, then N(0, sigma^2) added to every coordinate with the browser's crypto RNG. The noise is added here. */
export function buildProfile(S: Schema, events: Ev[], sigma: number, clip = 1): number[] {
  const cats = S.groups.find((g) => g.name === "ad_category")!.values;
  const nHours = S.groups.find((g) => g.name === "hour_bucket")!.values.length;
  const c = new Array(cats.length).fill(0), h = new Array(nHours).fill(0);
  for (const e of events) {
    const w = e.y ? 2 : 1;
    const ci = cats.indexOf(e.cat);
    if (ci >= 0) c[ci] += w;
    h[Math.min(nHours - 1, e.hour)] += w;
  }
  const sum = (a: number[]) => a.reduce((s, x) => s + x, 0) || 1;
  const x = [...c.map((q) => q / sum(c)), ...h.map((q) => q / sum(h))];
  const norm = Math.sqrt(x.reduce((s, q) => s + q * q, 0)) || 1;
  const scale = Math.min(1, clip / norm);
  return x.map((q) => q * scale + sigma * gaussian());
}

function gaussian(): number {
  const r = new Uint32Array(2);
  crypto.getRandomValues(r);
  return Math.sqrt(-2 * Math.log((r[0] + 1) / 4294967297)) * Math.cos((2 * Math.PI * (r[1] + 1)) / 4294967297);
}
