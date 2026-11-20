import { Card, Metric, Notice } from "../components";
import { pct, useLive, type Insight, type LiveInsights } from "../live";

function reliability(n: number): { label: string } {
  return { label: n < 3 ? "Very low" : n < 8 ? "Low" : n < 20 ? "Moderate" : "Reasonable" };
}

function heat(v: number, lo: number, hi: number): { bg: string; fg: string } {
  const t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
  const l = 96 - 62 * t;                        // light to dark blue, lightness 96 to 34
  return { bg: `hsl(205 85% ${l}%)`, fg: l < 58 ? "#ffffff" : "#111827" };
}

function Bars({ title, rows, base }: { title: string; rows: Insight[]; base: number }) {
  const max = Math.max(...rows.map((r) => r.ctr), base) * 1.1;
  return (
    <div className="bars">
      <h4>{title}</h4>
      {rows.map((r) => (
        <div className="bar-row" key={r.name}>
          <span className="bar-name">{r.name}</span>
          <span className="bar-track">
            <i style={{ width: `${(100 * r.ctr) / max}%`, background: r.ctr >= base ? "#0072b2" : "#6b7280" }} />
            <b style={{ left: `${(100 * base) / max}%` }} title="average" />
          </span>
          <span className="bar-val">{pct(r.ctr)}</span>
        </div>
      ))}
    </div>
  );
}

function actions(ins: LiveInsights) {
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
  if (error && !snap) return <Notice kind="error" title="Cannot reach the backend">{error}</Notice>;
  if (!snap) return <p className="loading">Loading insights…</p>;
  const ins = snap.insights;
  const rel = reliability(ins.n_updates);
  const flat = ins.n_updates === 0;
  const a = actions(ins);
  const all = ins.grid.ctr.flat();
  const lo = Math.min(...all);
  const hi = Math.max(...all);

  return (
    <>
      <h2>Insights</h2>

      <div className="metrics" style={{ marginBottom: "1.5rem" }}>
        <Metric label="Average predicted click rate" value={pct(ins.baseline_ctr)} />
        <Metric label="Updates behind this" value={String(ins.n_updates)} sub={`model version ${ins.version}`} />
        <Metric label="Reliability" value={rel.label} sub={ins.dp ? `noise σ ${ins.noise_sigma_per_upload.toFixed(2)} per update` : "no noise added"} />
      </div>

      {flat ? (
        <Card title="Waiting for the first update">
          <p className="empty">The model is still at its starting point.</p>
        </Card>
      ) : (
        <>
          <Card title="Predicted click rate by category and time of day">
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
                        return (
                          <td key={hi2} className={isBest ? "best" : ""} style={{ background: col.bg, color: col.fg }}>{pct(v)}</td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid2">
            <Card title="Highest and lowest">
              <div className="extremes">
                <div><span className="muted">Highest</span><b>{a.best.cat}, {a.best.hour} h</b><span>{pct(a.best.v)}</span></div>
                <div><span className="muted">Lowest</span><b>{a.worst.cat}, {a.worst.hour} h</b><span>{pct(a.worst.v)}</span></div>
              </div>
            </Card>
          </div>

          <div className="grid2">
            <Card title="By category and time"><Bars title="Category" rows={ins.by_category} base={ins.baseline_ctr} /><Bars title="Time of day" rows={ins.by_hour} base={ins.baseline_ctr} /></Card>
            <Card title="By device and placement"><Bars title="Device" rows={ins.by_device} base={ins.baseline_ctr} /><Bars title="Placement" rows={ins.by_placement} base={ins.baseline_ctr} /></Card>
          </div>
        </>
      )}
    </>
  );
}
