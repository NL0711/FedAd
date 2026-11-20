import { useState } from "react";
import { Metric, Notice } from "../components";
import { activateCampaign, ago, useCampaigns, useLive } from "../live";

const fmtEps = (x: number) => (x >= 100 ? x.toFixed(0) : x.toFixed(1));

export default function Campaign() {
  const { snap, error } = useLive(1500);
  const { viewId, activeId, setViewId, refresh } = useCampaigns();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  if (error && !snap) return <Notice kind="error" title="Cannot reach the server">{error}</Notice>;
  if (!snap) return <p className="loading">Loading</p>;

  const saved = !!viewId && viewId !== activeId;               // looking at a campaign that is not collecting
  const c = snap.campaign;
  const contributions = snap.devices.reduce((s, d) => s + d.uploads, 0);

  async function makeActive() {
    if (!window.confirm("Make this campaign the active one? The current one is saved and stops collecting. Devices that joined this one can contribute again.")) return;
    setBusy(true);
    setMsg("");
    try {
      await activateCampaign(snap!.id);
      setViewId(snap!.id);
      refresh();
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <>
      <h2>{snap.name}</h2>
      {error && <Notice kind="error" title="Not up to date">{error}. Sign out and sign in again.</Notice>}
      {saved && (
        <div className="notice saved">
          <span>Saved campaign: not collecting. Showing its data as it was.</span>
          <span className="row" style={{ margin: 0 }}>
            <button className="btn" disabled={busy} onClick={makeActive}>Make active</button>
            {msg && <span className="muted" role="status">{msg}</span>}
          </span>
        </div>
      )}

      {snap.devices.length === 0 ? (
        <p className="status">No devices have joined yet.</p>
      ) : (
        <>
          <div className="metrics">
            <Metric label="Devices" value={String(snap.devices.length)} />
            <Metric label="Updates" value={String(contributions)} />
            <Metric label="Model version" value={String(snap.status.version)} />
            {snap.policy.sigma > 0 && <Metric label="Noise per update" value={`σ ${snap.policy.sigma.toFixed(2)}`} />}
          </div>

          <div className="grid2">
            <section className="card">
              <h3>Devices</h3>
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
            </section>

            <section className="card">
              <h3>Activity</h3>
              {snap.events.length === 0 ? (
                <p className="status">Nothing received yet.</p>
              ) : (
                <ul className="feed">
                  {[...snap.events].reverse().slice(0, 12).map((e, i) => (
                    <li key={i}>
                      <span className="time">{new Date(e.t * 1000).toLocaleTimeString()}</span>
                      <span>Device #{e.device}, {e.bytes} bytes</span>
                      <span className="tail">{e.stepped ? `Model v${e.version}` : <span className="muted">buffered</span>}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}

      <section className="card">
        <h3>Settings</h3>
        <dl className="settings">
          <div><dt>Created</dt><dd>{new Date(snap.created * 1000).toLocaleString()}</dd></div>
          <div><dt>Total ε per device</dt><dd>{c.dp ? fmtEps(c.eps_total) : "no noise"}</dd></div>
          <div><dt>Updates allowed per device</dt><dd>{c.max_uploads}</dd></div>
          <div><dt>Updates per model step</dt><dd>{c.buffer_k}</dd></div>
          <div><dt>Differential privacy</dt><dd>{c.dp ? "on" : "off"}</dd></div>
        </dl>
      </section>
    </>
  );
}
