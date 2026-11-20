import { useState } from "react";
import { Metric, Notice } from "../components";
import { ago, useLive } from "../live";

const GREY = "#a3a39e", INK = "#1a1a1a";

function Bars({ values, names, overlay, color = INK }: { values: number[]; names: string[]; overlay?: number[]; color?: string }) {
  const W = 640, H = 120, n = values.length, bw = W / n;
  const max = Math.max(1e-9, ...values.map(Math.abs), ...(overlay ?? []).map(Math.abs));
  const rect = (v: number, i: number, fill: string, inset: number, key: string) => {
    const h = (Math.abs(v) / max) * (H / 2 - 3);
    return <rect key={key + i} x={i * bw + inset} y={v >= 0 ? H / 2 - h : H / 2} width={bw - 2 * inset - 1.5} height={Math.max(h, 0.6)} fill={fill}><title>{`${names[i]}: ${v.toFixed(4)}`}</title></rect>;
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img">
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="#c9c9c4" />
      {values.map((v, i) => rect(v, i, color, 0, "a"))}
      {(overlay ?? []).map((v, i) => rect(v, i, INK, 4, "b"))}
    </svg>
  );
}

const hex = (n: number) => "0x" + n.toString(16).toUpperCase().padStart(8, "0");

export default function ProofView() {
  const { snap, error } = useLive(1200);
  const [pick, setPick] = useState(0);
  if (error && !snap) return <Notice kind="error" title="Cannot reach the server">{error}</Notice>;
  if (!snap) return <p className="loading">Loading</p>;
  const ups = snap.model.uploads;
  if (!ups.length) return <><h2>Model</h2><p className="status">No updates received yet.</p></>;
  const u = ups[Math.min(pick, ups.length - 1)];
  const names = snap.model.names;
  const step = u.after.map((w, i) => w - u.before[i]);
  const moved = step.map((d, i) => ({ i, d })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 6);

  return (
    <>
      <h2>Model</h2>
      <div className="metrics">
        <Metric label="Model version" value={`v${snap.status.version}`} sub={`${ups.length} updates received`} />
        <Metric label="Update size" value={`${u.bytes} B`} sub={`checksum ${hex(u.checksum)}`} />
        <Metric label="From" value={`Device #${u.device}`} sub={ago(u.t)} />
        <Metric label="Weights moved" value={u.step_norm.toFixed(3)} sub={u.stepped ? `now v${u.version}` : "queued"} />
      </div>

      <div className="chips">
        {ups.map((x, i) => (
          <button key={x.t} className="chip" aria-pressed={i === pick} onClick={() => setPick(i)}>#{x.device} · v{x.version} · {hex(x.checksum).slice(2)}</button>
        ))}
      </div>

      <div className="grid2">
        <section className="card">
          <h3>Update received (noised)</h3>
          <Bars values={u.vec} names={names} />
        </section>
        <section className="card">
          <h3>Global weights, before and after</h3>
          <Bars values={u.before} names={names} overlay={u.after} color={GREY} />
          <div className="legend"><span><i style={{ background: GREY }} />before</span><span><i style={{ background: INK }} />after</span></div>
        </section>
      </div>

      <div className="grid2">
        <section className="card">
          <h3>Change this step</h3>
          <Bars values={step} names={names} />
        </section>
        <section className="card">
          <h3>Largest changes</h3>
          <table>
            <thead><tr><th>Weight</th><th className="num">Before</th><th className="num">After</th></tr></thead>
            <tbody>
              {moved.map((m) => (
                <tr key={m.i}><td>{names[m.i]}</td><td className="num">{u.before[m.i].toFixed(3)}</td><td className="num">{u.after[m.i].toFixed(3)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
