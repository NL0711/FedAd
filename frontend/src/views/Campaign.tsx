import { useEffect, useState } from "react";
import { Card, Metric, Notice } from "../components";
import { ago, resetCampaign, useLive, type CampaignPolicy } from "../live";

const fmtEps = (x: number) => (x >= 100 ? x.toFixed(0) : x.toFixed(1));

export default function Campaign() {
  const { snap, error } = useLive(1500);
  const [draft, setDraft] = useState<CampaignPolicy | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (snap && !draft) setDraft(snap.campaign);
  }, [snap, draft]);

  if (error && !snap) return <Notice kind="error" title="Cannot reach the backend">{error}</Notice>;
  if (!snap || !draft) return <p className="loading">Loading…</p>;

  const contributions = snap.devices.reduce((s, d) => s + d.uploads, 0);
  const set = <K extends keyof CampaignPolicy>(k: K, v: CampaignPolicy[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  async function start() {
    if (!draft) return;
    if (snap!.devices.length && !window.confirm("Starting a new campaign drops all joined devices and the current model. Continue?")) return;
    setBusy(true);
    try {
      await resetCampaign(draft);
      setMsg("New campaign started.");
    } catch (e) {
      setMsg(`Could not start: ${(e as Error).message}`);
    }
    setBusy(false);
  }

  return (
    <>
      <h2>Campaign</h2>

      <div className="metrics" style={{ marginBottom: "1.5rem" }}>
        <Metric label="Devices joined" value={String(snap.devices.length)} />
        <Metric label="Updates received" value={String(contributions)} />
        <Metric label="Model version" value={String(snap.status.version)} />
        <Metric label="Noise per update" value={snap.policy.sigma ? `σ ${snap.policy.sigma.toFixed(2)}` : "none"} />
      </div>

      <div className="grid2">
        <Card title="Devices">
          {snap.devices.length === 0 ? (
            <p className="empty">No device has joined yet.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Device</th><th className="num">Updates</th><th>Privacy used (ε)</th><th>Last seen</th></tr>
              </thead>
              <tbody>
                {snap.devices.map((d) => (
                  <tr key={d.id}>
                    <td>#{d.id}</td>
                    <td className="num">{d.uploads} / {d.max_uploads}</td>
                    <td>
                      {d.eps_total ? (
                        <>
                          <div className="meter"><i style={{ width: `${Math.min(100, (100 * (d.eps_spent ?? 0)) / d.eps_total)}%` }} /></div>
                          <span className="meter-label">{fmtEps(d.eps_spent ?? 0)} of {fmtEps(d.eps_total)}</span>
                        </>
                      ) : "no DP"}
                    </td>
                    <td>{ago(d.last_seen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Activity">
          {snap.events.length === 0 ? (
            <p className="empty">Nothing received yet.</p>
          ) : (
            <ul className="feed">
              {[...snap.events].reverse().slice(0, 12).map((e, i) => (
                <li key={i}>
                  <span className="time">{new Date(e.t * 1000).toLocaleTimeString()}</span>
                  <span>Device #{e.device} sent {e.bytes} bytes</span>
                  {e.stepped ? <strong>Model v{e.version}</strong> : <span className="muted">buffered</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Settings">
        <div className="controls">
          <div className="field">
            <label htmlFor="c-eps">Total ε per device <span className="slider-val">{fmtEps(draft.eps_total)}</span></label>
            <input id="c-eps" type="range" min={1} max={5} step={0.05} disabled={!draft.dp} value={Math.log10(draft.eps_total)}
              onChange={(e) => set("eps_total", Math.round(Math.pow(10, parseFloat(e.target.value))))} />
          </div>
          <div className="field">
            <label htmlFor="c-up">Updates allowed per device</label>
            <input id="c-up" type="number" min={1} max={100} value={draft.max_uploads} onChange={(e) => set("max_uploads", Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
          </div>
          <div className="field">
            <label htmlFor="c-k">Updates per model step</label>
            <input id="c-k" type="number" min={1} max={20} value={draft.buffer_k} onChange={(e) => set("buffer_k", Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
          </div>
          <div className="field">
            <span className="lab">Differential privacy</span>
            <label className="check">
              <input type="checkbox" checked={draft.dp} onChange={(e) => set("dp", e.target.checked)} />
              Add noise on the device
            </label>
          </div>
        </div>
        <div className="row">
          <button className="btn" disabled={busy} onClick={start}>Start new campaign</button>
          {msg && <span role="status">{msg}</span>}
        </div>
      </Card>
    </>
  );
}
