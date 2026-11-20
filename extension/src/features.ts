// Browser history -> training rows in the phone schema (phone-ctr-v1). Everything here runs on this computer.
// An "event" is one visit to a site in a known category. The label is re-engagement: 1 if this domain was already
// visited within the previous 24 hours, else 0 (a proxy for a tap; there are no ads here).
import { categorize } from "./categories.ts";
import type { Schema } from "../../frontend/src/phone/client.ts";

export interface Visit { t: number; host: string; cat: string }
export interface Rows { X: Float64Array; y: Float64Array; n: number; categories: Record<string, number> }

const MAX_ITEMS = 1500;
const SESSION_GAP_MS = 30 * 60_000;

/** Reads history for the last `days` days. Only categorised URLs are looked at in detail; the rest are dropped here. */
export async function collectVisits(days: number): Promise<Visit[]> {
  const start = Date.now() - days * 86_400_000;
  const items = await chrome.history.search({ text: "", startTime: start, maxResults: 5000 });
  const out: Visit[] = [];
  let used = 0;
  for (const it of items) {
    if (!it.url || used >= MAX_ITEMS) continue;
    const cat = categorize(it.url);
    if (!cat) continue;
    used++;
    const host = new URL(it.url).hostname;
    for (const v of await chrome.history.getVisits({ url: it.url })) {
      if (v.visitTime && v.visitTime >= start) out.push({ t: v.visitTime, host, cat });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Vertical FL profile for the ad platform: 8 category shares then 6 hour shares (each block sums to 1), scaled to L2 norm
 *  <= `clip`, then N(0, sigma^2) added to every coordinate with the browser's crypto RNG. The noise is added here, before sending. */
export function buildProfile(S: Schema, visits: Visit[], sigma: number, clip = 1): number[] {
  const cats = S.groups.find((g) => g.name === "ad_category")!.values;
  const nHours = S.groups.find((g) => g.name === "hour_bucket")!.values.length;
  const c = new Array(cats.length).fill(0), h = new Array(nHours).fill(0);
  for (const v of visits) { c[cats.indexOf(v.cat)]++; h[Math.floor(new Date(v.t).getHours() / 4)]++; }
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

export function buildRows(S: Schema, visits: Visit[], screenWidth: number): Rows {
  const F = S.n_features;
  const X = new Float64Array(visits.length * F);
  const y = new Float64Array(visits.length);
  const cats: Record<string, number> = {};
  const lastByHost = new Map<string, number>();
  const numIdx = new Map(S.numeric.map((d, j) => [d.name, j]));
  const group = (n: string) => S.groups.find((g) => g.name === n)!;
  const desktop = group("device").values.indexOf("desktop");
  let sessionStart = 0, prevT = 0, position = 0;
  const recentRevisits: number[] = [];

  visits.forEach((v, i) => {
    if (i === 0 || v.t - prevT > SESSION_GAP_MS) { sessionStart = v.t; position = 0; }
    const d = new Date(v.t);
    const raw: Record<string, number> = {
      recency_min: prevT ? Math.min(60, (v.t - prevT) / 60_000) : 60,
      taps_24h: recentRevisits.filter((t) => v.t - t < 86_400_000).length,
      prev_dwell_s: prevT ? Math.min(60, (v.t - prevT) / 1000) : 3,
      scroll_speed: 400,                      // not measurable from history: neutral (zero after centring)
      position, session_min: (v.t - sessionStart) / 60_000, weekday: (d.getDay() + 6) % 7,
      screen_w: screenWidth, net_quality: 2, visible_ms: 1500,
    };
    const row = X.subarray(i * F, (i + 1) * F);
    row[group("device").offset + desktop] = 1;
    row[group("hour_bucket").offset + Math.floor(d.getHours() / 4)] = 1;
    row[group("ad_category").offset + group("ad_category").values.indexOf(v.cat)] = 1;
    row[group("placement").offset + group("placement").values.indexOf("feed-middle")] = 1;
    for (const nd of S.numeric) {
      const j = numIdx.get(nd.name)!;
      row[S.numeric_offset + j] = Math.max(-S.numeric_clamp, Math.min(S.numeric_clamp, (raw[nd.name] - nd.center) / nd.scale));
    }
    const last = lastByHost.get(v.host);
    const again = last !== undefined && v.t - last < 86_400_000;
    y[i] = again ? 1 : 0;
    if (again) recentRevisits.push(v.t);
    lastByHost.set(v.host, v.t);
    cats[v.cat] = (cats[v.cat] ?? 0) + 1;
    prevT = v.t; position++;
  });
  return { X, y, n: visits.length, categories: cats };
}
