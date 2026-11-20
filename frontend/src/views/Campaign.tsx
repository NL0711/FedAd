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

  if (error && !snap) {
    return (
      <Notice kind="error" title="Cannot reach the backend">
        {error}. Start it with <code>python -m fedad.web --lan</code> in <code>backend/</code>, and open this page at <code>http://localhost:8000</code>.
      </Notice>
    );
  }
  if (!snap || !draft) return <p className="loading">Loading campaign…</p>;

  const contributions = snap.devices.reduce((s, d) => s + d.uploads, 0);
  const set = <K extends keyof CampaignPolicy>(k: K, v: CampaignPolicy[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  async function start() {
    if (!draft) return;
    if (snap!.devices.length && !window.confirm("Starting a new campaign drops all joined devices and the current model. Continue?")) return;
    setBusy(true);
    try {
      await resetCampaign(draft);
      setMsg("New campaign started. Devices must join again.");
    } catch (e) {
      setMsg(`Could not start: ${(e as Error).message}`);
    }
    setBusy(false);
  }

  return (
    <>
      <h2>Campaign</h2>
      <p className="lede">
        Devices join this campaign through the browser extension, learn from their owners' activity on the device, and send only noised model updates. You never
        receive a tap, a timestamp or an identifier. Watch the Insights tab as updates arrive.
      </p>

      <div className="grid2">
        <Card title="1. Join">
          <p>Anyone who installs the browser extension and agrees joins this campaign automatically. There is no code to share.</p>
          <p className="note">Registration is open and rate-limited per address; nothing stronger is implemented.</p>
        </Card>

        <Card title="2. Privacy policy for this campaign">
          <div className="controls">
            <div className="field">
              <label htmlFor="c-eps">Total ε per device <span className="slider-val">{fmtEps(draft.eps_total)}</span></label>
              <input id="c-eps" type="range" min={1} max={5} step={0.05} disabled={!draft.dp} value={Math.log10(draft.eps_total)}
                onChange={(e) => set("eps_total", Math.round(Math.pow(10, parseFloat(e.target.value))))} />
              <span className="hint">log scale. Lower is more private and noisier: the Insights get blurrier.</span>
            </div>
            <div className="field">
              <label htmlFor="c-up">Contributions allowed per device</label>
              <input id="c-up" type="number" min={1} max={100} value={draft.max_uploads} onChange={(e) => set("max_uploads", Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
              <span className="hint">The ε budget is split across these.</span>
            </div>
            <div className="field">
              <label htmlFor="c-k">Uploads per model step</label>
              <input id="c-k" type="number" min={1} max={20} value={draft.buffer_k} onChange={(e) => set("buffer_k", Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
              <span className="hint">1 = every contribution moves the model at once.</span>
            </div>
            <div className="field">
              <span className="lab">Differential privacy</span>
              <label className="check">
                <input type="checkbox" checked={draft.dp} onChange={(e) => set("dp", e.target.checked)} />
                Add noise on the phone
              </label>
              <span className="hint">Off: phones refuse to upload by default, because the update would be raw.</span>
            </div>
          </div>
          <div className="row">
            <button className="btn" disabled={busy} onClick={start}>Start new campaign</button>
            {msg && <span role="status">{msg}</span>}
          </div>
          <p className="note">Running policy: ε {fmtEps(snap.policy.eps_total)} over {snap.policy.max_uploads} uploads, noise std {snap.policy.sigma.toFixed(3)} per number on each clipped update (clip {snap.policy.clip_c}).</p>
        </Card>
      </div>

      <div className="metrics" style={{ marginBottom: "1.25rem" }}>
        <Metric label="Devices joined" value={String(snap.devices.length)} />
        <Metric label="Contributions received" value={String(contributions)} />
        <Metric label="Model version" value={String(snap.status.version)} sub={`${snap.status.buffered} of ${snap.status.buffer_k} buffered`} />
        <Metric label="Noise per upload" value={snap.policy.sigma ? `σ ${snap.policy.sigma.toFixed(2)}` : "none"} sub="std added on each phone" />
      </div>

      <div className="grid2">
        <Card title="Devices and privacy ledger" note="ε is what each phone has spent so far, by the Rényi accountant. The count of examples and the two loss values each phone reports are outside the DP guarantee.">
          {snap.devices.length === 0 ? (
            <p>No device has joined yet.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Device</th><th className="num">Uploads</th><th>ε spent of budget</th><th className="num">Bytes</th><th className="num">Examples</th><th>Seen</th></tr>
              </thead>
              <tbody>
                {snap.devices.map((d) => (
                  <tr key={d.id}>
                    <td>#{d.id} {d.label}</td>
                    <td className="num">{d.uploads} / {d.max_uploads}</td>
                    <td>
                      {d.eps_total ? (
                        <>
                          <div className="meter"><i style={{ width: `${Math.min(100, (100 * (d.eps_spent ?? 0)) / d.eps_total)}%` }} /></div>
                          <span className="hint">{fmtEps(d.eps_spent ?? 0)} of {fmtEps(d.eps_total)}</span>
                        </>
                      ) : "no DP"}
                    </td>
                    <td className="num">{d.bytes}</td>
                    <td className="num">{d.examples}</td>
                    <td>{ago(d.last_seen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Activity: everything the server receives" note="This is the whole feed: a device number, a size in bytes and the new model version. No content.">
          {snap.events.length === 0 ? (
            <p>Nothing received yet.</p>
          ) : (
            <ul className="tight feed">
              {[...snap.events].reverse().slice(0, 12).map((e, i) => (
                <li key={i}>
                  {new Date(e.t * 1000).toLocaleTimeString()}: device #{e.device} sent {e.bytes} bytes
                  {e.stepped ? <strong>, model is now version {e.version}</strong> : ", buffered"}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
