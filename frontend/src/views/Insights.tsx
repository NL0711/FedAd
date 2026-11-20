import { Metric, Notice } from "../components";
import { pct, useLive, type Insight, type LiveInsights } from "../live";

/** Light grey to near-black, so the grid reads in the same monochrome as the rest of the console. */
function heat(v: number, lo: number, hi: number): { bg: string; fg: string } {
  const t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
  const l = 94 - 72 * t;
  return { bg: `hsl(60 3% ${l}%)`, fg: l < 55 ? "#ffffff" : "#1a1a1a" };
}

function Bars({ title, rows, base }: { title: string; rows: Insight[]; base: number }) {
  const max = Math.max(...rows.map((r) => r.ctr), base) * 1.1;
  return (
    <div className="bars">
      <h4>{title}</h4>
      {rows.map((r) => (
        <div className="bar-row" key={r.name}>
          <span>{r.name}</span>
          <span className="bar-track">
            <i style={{ width: `${(100 * r.ctr) / max}%`, background: r.ctr >= base ? "#1a1a1a" : "#a3a39e" }} />
            <b style={{ left: `${(100 * base) / max}%` }} title="average" />
          </span>
          <span className="bar-val">{pct(r.ctr)}</span>
        </div>
      ))}
    </div>
  );
}

function extremes(ins: LiveInsights) {
  const { categories, hours, ctr } = ins.grid;
  let best = { c: 0, h: 0, v: -1 };
  let worst = { c: 0, h: 0, v: 2 };
  ctr.forEach((row, c) => row.forEach((v, h) => {
    if (v > best.v) best = { c, h, v };
    if (v < worst.v) worst = { c, h, v };
  }));
  return { best: { cat: categories[best.c], hour: hours[best.h], v: best.v }, worst: { cat: categories[worst.c], hour: hours[worst.h], v: worst.v } };
}

export default function Insights() {
  const { snap, error } = useLive(1500);
  if (error && !snap) return <Notice kind="error" title="Cannot reach the server">{error}</Notice>;
  if (!snap) return <p className="loading">Loading</p>;
  const ins = snap.insights;
  if (ins.n_updates === 0) return <><h2>Insights</h2><p className="status">No updates received yet.</p></>;

  const a = extremes(ins);
  const all = ins.grid.ctr.flat();
  const lo = Math.min(...all);
  const hi = Math.max(...all);

  return (
    <>
      <h2>Insights</h2>

      <div className="metrics">
        <Metric label="Average predicted click rate" value={pct(ins.baseline_ctr)} />
        <Metric label="Updates" value={String(ins.n_updates)} />
        <Metric label="Model version" value={String(ins.version)} />
        {ins.dp && <Metric label="Noise per update" value={`σ ${ins.noise_sigma_per_upload.toFixed(2)}`} />}
      </div>

      <section className="card">
        <h3>Predicted click rate by category and time of day</h3>
        <div className="heat-wrap">
          <table className="heat">
            <thead>
              <tr><th />{ins.grid.hours.map((h) => <th key={h}>{h} h</th>)}</tr>
            </thead>
            <tbody>
              {ins.grid.categories.map((c, ci) => (
                <tr key={c}>
                  <th scope="row">{c}</th>
                  {ins.grid.ctr[ci].map((v, hi2) => {
                    const col = heat(v, lo, hi);
                    const isBest = c === a.best.cat && ins.grid.hours[hi2] === a.best.hour;
                    return <td key={hi2} className={isBest ? "best" : ""} style={{ background: col.bg, color: col.fg }}>{pct(v)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3>Highest and lowest</h3>
        <div className="extremes">
          <div><span className="muted">Highest</span><b>{a.best.cat}, {a.best.hour} h</b><span className="v">{pct(a.best.v)}</span></div>
          <div><span className="muted">Lowest</span><b>{a.worst.cat}, {a.worst.hour} h</b><span className="v">{pct(a.worst.v)}</span></div>
        </div>
      </section>

      <div className="grid2">
        <section className="card">
          <Bars title="Category" rows={ins.by_category} base={ins.baseline_ctr} />
          <Bars title="Time of day" rows={ins.by_hour} base={ins.baseline_ctr} />
        </section>
        <section className="card">
          <Bars title="Device" rows={ins.by_device} base={ins.baseline_ctr} />
          <Bars title="Placement" rows={ins.by_placement} base={ins.baseline_ctr} />
        </section>
      </div>
    </>
  );
}
