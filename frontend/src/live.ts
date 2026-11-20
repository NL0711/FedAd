// Live campaign (real phones): types, API calls and a polling hook. Backend: backend/src/fedad/web/live.py.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Num } from "./types";

export interface CampaignPolicy {
  name?: string;
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

export interface CampaignSummary {
  id: string;
  name: string;
  created: number;
  active: boolean;
  version: number;
  devices: number;
  updates: number;
  eps_total: number;
  dp: boolean;
  max_uploads: number;
  buffer_k: number;
}

/** Which campaign the pages show. `viewId` is the one being looked at; `activeId` is the one collecting updates. */
export interface CampaignView {
  items: CampaignSummary[];
  activeId: string;
  viewId: string;
  setViewId: (id: string) => void;
  refresh: () => void;
}
export const CampaignContext = createContext<CampaignView>({ items: [], activeId: "", viewId: "", setViewId: () => {}, refresh: () => {} });
export const useCampaigns = () => useContext(CampaignContext);

export interface LiveSnapshot {
  id: string;
  name: string;
  model: { names: string[]; weights: number[]; uploads: UploadRec[] };
  policy: { sigma: number; eps_per_upload: number; max_uploads: number; eps_total: number; clip_c: number };
  campaign: CampaignPolicy;
  status: { version: number; buffered: number; buffer_k: number; mode: string; rounds_done: number };
  devices: LiveDevice[];
  events: LiveEvent[];
  insights: LiveInsights;
  join?: { code: string; urls: string[]; lan_enabled: boolean };
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

export const getLive = (id?: string) => fetch(id ? `/api/campaigns/${id}` : "/api/live").then((r) => asJson<LiveSnapshot>(r));

const post = (url: string, body?: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

export const listCampaigns = () => fetch("/api/campaigns").then((r) => asJson<{ active: string; items: CampaignSummary[] }>(r));
export const createCampaign = (p: CampaignPolicy) => post("/api/campaigns", p).then((r) => asJson<{ ok: boolean; id: string; name: string }>(r));
export const activateCampaign = (id: string) => post(`/api/campaigns/${id}/activate`).then((r) => asJson<{ ok: boolean; id: string }>(r));

/** Polls the campaign being viewed every ``ms`` while mounted: the active one, or a saved one chosen in the header. */
export function useLive(ms = 1500): { snap: LiveSnapshot | null; error: string | null; refresh: () => void } {
  const { viewId, activeId } = useCampaigns();
  const id = viewId && viewId !== activeId ? viewId : undefined;      // the active campaign is read from /api/live
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const tick = () =>
    getLive(id)
      .then((s) => {
        if (alive.current) {
          setSnap(s);
          setError(null);
        }
      })
      .catch((e: Error) => alive.current && setError(e.message));
  useEffect(() => {
    alive.current = true;
    setSnap(null);
    tick();
    const t = window.setInterval(tick, ms);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, id]);
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
