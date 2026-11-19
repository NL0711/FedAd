import type { Calibration, Experiments, Health, RoundRow, RunRequest, RunSnapshot, RunSummary } from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(0, "Cannot reach the backend. Start it with: python -m fedad.web (in backend/).");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export const getHealth = () => request<Health>("/api/health");
export const getExperiments = () => request<Experiments>("/api/experiments");
export const getRun = (id: string) => request<RunSnapshot>(`/api/runs/${id}`);

export const startRun = (req: RunRequest) =>
  request<{ id: string }>("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });

export const calibrate = (p: { eps_total: number; rounds: number; clip_c: number; delta_total: number }) =>
  request<Calibration>(
    `/api/privacy/calibrate?eps_total=${p.eps_total}&rounds=${p.rounds}&clip_c=${p.clip_c}&delta_total=${p.delta_total}`,
  );

export interface StreamHandlers {
  onRound: (row: RoundRow) => void;
  onDone: (summary: RunSummary) => void;
  onError: (message: string) => void;
}

/** Streams a run with EventSource; if the stream breaks before the run ends, falls back to polling. Returns a stop function. */
export function followRun(id: string, h: StreamHandlers): () => void {
  let stopped = false;
  let finished = false;
  let seen = 0;
  let poll: number | undefined;

  const finish = () => {
    finished = true;
    es.close();
    if (poll !== undefined) window.clearInterval(poll);
  };

  const es = new EventSource(`/api/runs/${id}/events`);
  es.addEventListener("round", (e) => {
    seen += 1;
    h.onRound(JSON.parse((e as MessageEvent).data));
  });
  es.addEventListener("done", (e) => {
    if (finished) return;
    finish();
    h.onDone(JSON.parse((e as MessageEvent).data));
  });
  es.addEventListener("error", (e) => {
    if (finished || stopped) return;
    const data = (e as MessageEvent).data;
    if (typeof data === "string" && data) {
      finish();
      try {
        h.onError(JSON.parse(data).error ?? "run failed");
      } catch {
        h.onError("run failed");
      }
      return;
    }
    // transport error: switch to polling
    es.close();
    if (poll !== undefined) return;
    poll = window.setInterval(async () => {
      if (stopped || finished) return;
      try {
        const snap = await getRun(id);
        snap.rows.slice(seen).forEach(h.onRound);
        seen = snap.rows.length;
        if (snap.status === "done" && snap.summary) {
          finish();
          h.onDone(snap.summary);
        } else if (snap.status === "error") {
          finish();
          h.onError(snap.error ?? "run failed");
        }
      } catch (err) {
        finish();
        h.onError(err instanceof Error ? err.message : "lost connection");
      }
    }, 700);
  });

  return () => {
    stopped = true;
    finish();
  };
}
