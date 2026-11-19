// Live campaign (real phones): types, API calls and a polling hook. Backend: backend/src/fedad/web/live.py.
import { useEffect, useRef, useState } from "react";
import type { Num } from "./types";

export interface CampaignPolicy {
  eps_total: number;
  max_uploads: number;
  buffer_k: number;
  mode: "sync" | "async";
  dp: boolean;
  top_k: number;
  prior_ctr: number;
}

export interface LiveDevice {
  id: number;
  label: string;
  uploads: number;
  max_uploads: number;
  bytes: number;
  examples: number;
  eps_spent: Num;
  eps_total: Num;
  joined: number;
  last_seen: number;
}

export interface Insight {
  name: string;
  ctr: number;
}

export interface LiveInsights {
  version: number;
  n_updates: number;
  baseline_ctr: number;
  by_category: Insight[];
  by_hour: Insight[];
  by_device: Insight[];
  by_placement: Insight[];
  grid: { categories: string[]; hours: string[]; ctr: number[][] };
  noise_sigma_per_upload: number;
  dp: boolean;
  reading: string;
}

export interface LiveEvent {
  t: number;
  device: number;
  bytes: number;
  version: number;
  stepped: boolean;
}

export interface UploadRec {
  t: number; device: number; version: number; stepped: boolean; bytes: number; checksum: number; norm: number; step_norm: number;
  n: number; loss_before: number; loss_after: number; vec: number[]; before: number[]; after: number[];
}

export interface LiveSnapshot {
  model: { names: string[]; weights: number[]; uploads: UploadRec[] };
  policy: { sigma: number; eps_per_upload: number; max_uploads: number; eps_total: number; clip_c: number };
  campaign: CampaignPolicy;
  status: { version: number; buffered: number; buffer_k: number; mode: string; rounds_done: number };
  devices: LiveDevice[];
  events: LiveEvent[];
  insights: LiveInsights;
  join: { code: string; urls: string[]; lan_enabled: boolean };
  created: number;
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const b = await res.json();
      detail = typeof b.detail === "string" ? b.detail : b.error ?? detail;
    } catch {
      /* keep statusText */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const getLive = () => fetch("/api/live").then((r) => asJson<LiveSnapshot>(r));

export const resetCampaign = (p: CampaignPolicy) =>
  fetch("/api/live/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) }).then((r) =>
    asJson<{ ok: boolean; join_code: string }>(r),
  );

/** Polls the campaign every ``ms`` while mounted. */
export function useLive(ms = 1500): { snap: LiveSnapshot | null; error: string | null; refresh: () => void } {
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const tick = () =>
    getLive()
      .then((s) => {
        if (alive.current) {
          setSnap(s);
          setError(null);
        }
      })
      .catch((e: Error) => alive.current && setError(e.message));
  useEffect(() => {
    alive.current = true;
    tick();
    const t = window.setInterval(tick, ms);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms]);
  return { snap, error, refresh: tick };
}

export const pct = (x: number, d = 1) => `${(100 * x).toFixed(d)}%`;

export function ago(t: number): string {
  const s = Math.max(0, Date.now() / 1000 - t);
  if (s < 5) return "just now";
  if (s < 60) return `${Math.round(s)} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}
