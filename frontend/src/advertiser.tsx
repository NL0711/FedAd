// Party B (advertiser) console. Talks only to /api/b/*, which returns aggregates: no identifiers, no per-person scores.
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, Metric, Notice } from "./components";
import "./styles.css";
import "./admin.css";

interface Segment { segment: string; people: number | null; predicted_conversion: number | null }
interface Last {
  status: "waiting" | "too_small" | "one_class" | "ok"; note?: string; overlap?: number | null; platform_users: number; advertiser_customers: number;
  min_cohort: number; test_auc?: number | null; history?: { epoch: number; test_auc: number | null }[];
  privacy?: { eps_embedding: number | null; eps_gradient: number | null; eps_total: number | null; delta: number };
  segments?: Segment[]; base_rate?: number; released?: string; leakage_note?: string;
}
interface Vertical { platform_profiles: number; advertiser_customers: number; min_cohort: number; last: Last | null }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { "Content-Type": "application/json" }, credentials: "same-origin" });
  if (r.status === 403) {
    location.replace("/login.html");
    throw new Error("Sign in required");
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
const pct = (x: number | null | undefined) => (x == null ? "hidden" : `${(x * 100).toFixed(1)}%`);

function Console() {
  const [v, setV] = useState<Vertical | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [sig, setSig] = useState(3);
  const refresh = useCallback(() => api<Vertical>("/api/b/vertical").then(setV).catch((e) => setErr(String(e.message))), []);
  useEffect(() => { void refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);

  const run = async () => {
    setBusy(true); setErr("");
    try { await api("/api/b/vertical/run", { method: "POST", body: JSON.stringify({ sigma_e: sig, sigma_g: sig, epochs: 20 }) }); await refresh(); }
    catch (e) { setErr(String((e as Error).message)); }
    setBusy(false);
  };
  const last = v?.last;

  return (
    <>
      <header className="app-header"><div className="app-title"><h1>FedAd · Advertiser (Party B)</h1><span className="badge">Prototype</span>
        <button className="notes-btn" onClick={() => fetch("/auth/logout", { method: "POST" }).finally(() => location.replace("/login.html"))}>Sign out</button></div></header>
      <main>
        {err && <Notice kind="error">{err}</Notice>}
        <Notice title="What you can and cannot see">
          You hold the purchase outcome. The ad platform holds browsing interest. We match the two groups by private set intersection and
          train one model between you. You see group results only: sizes, accuracy, and conversion rate per interest segment (groups
          under {v?.min_cohort ?? 10} people are hidden, rates carry noise, counts are rounded). You never see who is in the platform's
          data, any email outside your own customers, any profile, or any individual prediction.
        </Notice>

        <Card title="Your side and the platform's, by count">
          <div className="metrics">
            <Metric label="Your customers" value={String(v?.advertiser_customers ?? "-")} />
            <Metric label="Platform profiles received" value={String(v?.platform_profiles ?? "-")} sub="count only" />
            <Metric label="Matched (overlap)" value={last?.overlap == null ? "hidden" : String(last.overlap)} sub={last?.overlap == null ? `needs ${v?.min_cohort ?? 10}+` : "people in both"} />
          </div>
        </Card>

        <Card title="Train across both parties" note="Higher noise protects people more and costs accuracy. The epsilon below is per person (row-level) for the messages exchanged.">
          <label>Noise on messages (sigma): {sig.toFixed(1)}
            <input type="range" min={0} max={10} step={0.5} value={sig} onChange={(e) => setSig(Number(e.target.value))} />
          </label>
          <button onClick={run} disabled={busy}>{busy ? "Matching and training..." : "Run matching and training"}</button>
        </Card>

        {last && last.status !== "ok" && <Notice kind="warn">{last.note}</Notice>}

        {last?.status === "ok" && (
          <>
            <Card title="Result">
              <div className="metrics">
                <Metric label="Test AUC" value={last.test_auc == null ? "n/a" : last.test_auc.toFixed(3)} sub="0.5 = no better than chance" />
                <Metric label="Overall conversion" value={pct(last.base_rate)} sub="noised" />
                <Metric label="Privacy (per person)" value={last.privacy?.eps_total == null ? "none" : `ε ${last.privacy.eps_total.toFixed(0)}`} sub={`δ ${last.privacy?.delta}`} />
              </div>
              <div style={{ height: 200 }}>
                <ResponsiveContainer>
                  <LineChart data={last.history}>
                    <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="epoch" /><YAxis domain={[0, 1]} /><Tooltip />
                    <Line type="monotone" dataKey="test_auc" dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title="Predicted conversion by platform interest segment">
              <table>
                <thead><tr><th>Segment (strongest interest)</th><th>People (rounded)</th><th>Predicted conversion</th></tr></thead>
                <tbody>
                  {last.segments?.map((s) => (
                    <tr key={s.segment}><td>{s.segment}</td><td>{s.people ?? "hidden: group too small"}</td><td>{pct(s.predicted_conversion)}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title="What was released to you"><p>{last.released}</p><p className="note">{last.leakage_note}</p></Card>
          </>
        )}
      </main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Console /></StrictMode>);
