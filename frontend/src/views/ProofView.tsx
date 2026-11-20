import { useState } from "react";
import { Card, Metric, Notice } from "../components";
import { ago, useLive } from "../live";

function Bars({ values, names, overlay, color = "#111827" }: { values: number[]; names: string[]; overlay?: number[]; color?: string }) {
  const W = 640, H = 120, n = values.length, bw = W / n;
  const max = Math.max(1e-9, ...values.map(Math.abs), ...(overlay ?? []).map(Math.abs));
  const rect = (v: number, i: number, fill: string, inset: number, key: string) => {
    const h = (Math.abs(v) / max) * (H / 2 - 3);
    return <rect key={key + i} x={i * bw + inset} y={v >= 0 ? H / 2 - h : H / 2} width={bw - 2 * inset - 1.5} height={Math.max(h, 0.6)} fill={fill}><title>{`${names[i]}: ${v.toFixed(4)}`}</title></rect>;
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img">
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="#9ca3af" />
      {values.map((v, i) => rect(v, i, color, 0, "a"))}
      {(overlay ?? []).map((v, i) => rect(v, i, "#0072B2", 4, "b"))}
    </svg>
  );
}

const hex = (n: number) => "0x" + n.toString(16).toUpperCase().padStart(8, "0");

export default function ProofView() {
  const { snap, error } = useLive(1200);
  const [pick, setPick] = useState(0);
  if (error && !snap) return <Notice kind="error" title="Cannot reach the backend">{error}</Notice>;
  if (!snap) return <p className="loading">Loading…</p>;
  const ups = snap.model.uploads;
  if (!ups.length) return <><h2>Model</h2><Card title="Waiting for an update"><p className="empty">No update received yet.</p></Card></>;
  const u = ups[Math.min(pick, ups.length - 1)];
  const names = snap.model.names;
  const step = u.after.map((w, i) => w - u.before[i]);
  const moved = step.map((d, i) => ({ i, d })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 6);

  return (
    <>
      <h2>Model</h2>
      <div className="metrics" style={{ marginBottom: "1.25rem" }}>
        <Metric label="Global model" value={`v${snap.status.version}`} sub={`${snap.model.uploads.length} updates received`} />
        <Metric label="Update received" value={`${u.bytes} B`} sub={`checksum ${hex(u.checksum)}`} />
        <Metric label="From" value={`Device #${u.device}`} sub={ago(u.t)} />
        <Metric label="Global weights moved" value={u.step_norm.toFixed(3)} sub={u.stepped ? `now v${u.version}` : "queued"} />
      </div>

      <div className="sv-chips" style={{ marginBottom: "1rem" }}>
        {ups.map((x, i) => (
          <button key={x.t} className={"sv-chip pickchip" + (i === pick ? " hot" : "")} onClick={() => setPick(i)}>#{x.device} · v{x.version} · {hex(x.checksum).slice(2)}</button>
        ))}
      </div>

      <div className="grid2">
        <Card title="Received from the phone: the noised update">
          <Bars values={u.vec} names={names} />
        </Card>
        <Card title="Global weights: before and after">
          <Bars values={u.before} names={names} overlay={u.after} color="#9ca3af" />
          <div className="legend2"><span style={{ background: "#9ca3af" }} />before<span style={{ background: "#0072B2" }} />after</div>
        </Card>
      </div>

      <div className="grid2">
        <Card title="Change this step">
          <Bars values={step} names={names} color="#009E73" />
        </Card>
        <Card title="Largest changes">
          <table>
            <thead><tr><th>Weight</th><th className="num">Before</th><th className="num">After</th></tr></thead>
            <tbody>
              {moved.map((m) => (
                <tr key={m.i}><td>{names[m.i]}</td><td className="num">{u.before[m.i].toFixed(3)}</td><td className="num">{u.after[m.i].toFixed(3)}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
