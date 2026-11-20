// Advertiser console: predicted click rate from the shared, privacy-protected model. Talks only to /api/b/model, which returns
// aggregates read from the global model: no identifiers, no per-person or per-device data.
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Card, Metric, Notice } from "./components";
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

function Bars({ rows, top }: { rows: Rate[]; top: number }) {
  return (
    <table>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <td style={{ width: "8rem" }}>{r.name}</td>
            <td><div style={{ background: "#2563eb", height: 14, borderRadius: 3, width: `${Math.max(2, (100 * r.ctr) / top)}%` }} /></td>
            <td style={{ width: "4.5rem", textAlign: "right" }}>{pct(r.ctr)}</td>
          </tr>
        ))}
      </tbody>
    </table>
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
      <header className="app-header"><div className="app-title"><h1>FedAd · Advertiser</h1>
        <button className="notes-btn" onClick={() => void signOutAndGo()}>Sign out</button></div></header>
      <main>
        {err && <Notice kind="error">{err}</Notice>}
        <Notice title="What this shows">
          Predicted click rate from a shared model that many people's devices trained together. Each device clipped and noised its own
          update before sending it, so the server never received anyone's browsing. These are predictions from the model, not measured
          results and not individual people.
        </Notice>

        <Card title="The model">
          <div className="metrics">
            <Metric label="Devices that contributed" value={String(m?.contributors ?? "-")} />
            <Metric label="Model version" value={String(m?.version ?? "-")} />
            <Metric label="Average predicted click rate" value={m?.baseline_ctr == null ? "-" : pct(m.baseline_ctr)} />
            <Metric label="Privacy (per device)" value={m?.eps_per_device == null ? (m?.dp === false ? "none" : "-") : `ε ${m.eps_per_device.toFixed(0)}`} sub={m?.noise_sigma_per_upload == null ? undefined : `noise σ ${m.noise_sigma_per_upload.toFixed(2)} per update`} />
          </div>
        </Card>

        {m?.waiting && <Notice kind="warn">{m.note}</Notice>}
        {m && !m.waiting && m.early && (
          <Notice kind="warn">Early estimate: only {m.contributors} device{m.contributors === 1 ? "" : "s"} so far (fewer than {m.min_contributors}). With so few, the model is mostly noise and the numbers will move a lot.</Notice>
        )}

        {m?.by_category && (
          <Card title="Predicted click rate by ad category"><Bars rows={m.by_category} top={top} /></Card>
        )}
        {m?.by_hour && (
          <Card title="Predicted click rate by time of day" note="Four-hour blocks.">
            <Bars rows={m.by_hour} top={top} />
          </Card>
        )}
        {m && !m.waiting && m.note && <p className="note">{m.note}</p>}
      </main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Console /></StrictMode>);
