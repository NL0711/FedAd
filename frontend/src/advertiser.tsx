// Advertiser console: predicted click rate from the shared, privacy-protected model. Talks only to /api/b/model, which returns
// aggregates read from the global model: no identifiers, no per-person or per-device data.
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Metric, Notice } from "./components";
import { accessToken, signOutAndGo } from "./supabase";
import "./styles.css";
import "./admin.css";

interface Rate { name: string; ctr: number }
interface Model {
  contributors: number; min_contributors: number; early: boolean; version: number; dp: boolean; waiting: boolean; note?: string;
  updates?: number; baseline_ctr?: number; by_category?: Rate[]; by_hour?: Rate[]; noise_sigma_per_upload?: number; eps_per_device?: number | null;
}

async function api<T>(path: string): Promise<T> {
  const token = await accessToken();
  const r = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (r.status === 403) {
    location.replace("/login.html");
    throw new Error("Sign in required");
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function Bars({ title, rows, top }: { title: string; rows: Rate[]; top: number }) {
  return (
    <div className="bars">
      {title && <h4>{title}</h4>}
      {rows.map((r) => (
        <div className="bar-row" key={r.name}>
          <span>{r.name}</span>
          <span className="bar-track"><i style={{ width: `${Math.max(2, (100 * r.ctr) / top)}%`, background: "#1a1a1a" }} /></span>
          <span className="bar-val">{pct(r.ctr)}</span>
        </div>
      ))}
    </div>
  );
}

function Console() {
  const [m, setM] = useState<Model | null>(null);
  const [err, setErr] = useState("");
  const refresh = useCallback(() => api<Model>("/api/b/model").then(setM).catch((e) => setErr(String(e.message))), []);
  useEffect(() => { void refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);
  const top = Math.max(0.01, ...(m?.by_category ?? []).map((r) => r.ctr), ...(m?.by_hour ?? []).map((r) => r.ctr));

  return (
    <>
      <header className="app-header">
        <div className="app-title"><h1>FedAd</h1><button className="notes-btn" onClick={() => void signOutAndGo()}>Sign out</button></div>
        <nav aria-label="Views"><button aria-selected="true">Predicted click rate</button></nav>
      </header>
      <main>
        {err && <Notice kind="error" title="Cannot reach the server">{err}</Notice>}
        {!m ? (
          !err && <p className="loading">Loading</p>
        ) : m.waiting || !m.by_category || !m.by_hour ? (
          <p className="status">No devices have contributed yet.</p>
        ) : (
          <>
            <div className="metrics">
              <Metric label="Average predicted page-click rate" value={pct(m.baseline_ctr ?? 0)} />
              <Metric label="Devices contributed" value={String(m.contributors)} sub={m.early ? "early estimate" : undefined} />
              <Metric label="Model version" value={String(m.version)} />
              {m.eps_per_device != null && <Metric label="Privacy per device" value={`ε ${m.eps_per_device.toFixed(0)}`} />}
            </div>
            <div className="grid2">
              <section className="card"><h3>By topic</h3><Bars title="" rows={m.by_category} top={top} /></section>
              <section className="card"><h3>By time of day</h3><Bars title="" rows={m.by_hour} top={top} /></section>
            </div>
          </>
        )}
      </main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Console /></StrictMode>);
