import { Card, Metric, Notice } from "../components";
import { pct, useLive, type Insight, type LiveInsights } from "../live";

function reliability(n: number): { label: string; kind: "error" | "warn" | "info"; text: string } {
  if (n < 3) return { label: "Very low", kind: "error", text: "Fewer than 3 contributions: what you see is mostly noise. Do not act on it." };
  if (n < 8) return { label: "Low", kind: "warn", text: "A few contributions: the strongest effects may be real, the rest is noise. Treat it as a hint." };
  if (n < 20) return { label: "Moderate", kind: "info", text: "Enough contributions for the large effects to stand out from the noise." };
  return { label: "Reasonable", kind: "info", text: "Many contributions: noise averages out. Small differences are still uncertain." };
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
      <p className="lede">
        Predicted click rate by ad category and time of day, read from the global model alone. Every number here comes from noised model updates; no click, timestamp or
        user identifier was ever received.
      </p>

      <div className="metrics" style={{ marginBottom: "1.25rem" }}>
        <Metric label="Average predicted click rate" value={pct(ins.baseline_ctr)} sub="across categories and times" />
        <Metric label="Contributions behind this" value={String(ins.n_updates)} sub={`model version ${ins.version}`} />
        <Metric label="Reliability" value={rel.label} sub={ins.dp ? `noise σ ${ins.noise_sigma_per_upload.toFixed(2)} per upload` : "no noise added"} />
      </div>
      <Notice kind="info" title={`Reliability: ${rel.label}`}>{rel.text} {ins.reading}</Notice>

      {flat ? (
        <Card title="Waiting for the first contribution">
          <p>The model is still at its starting point, so every cell is the same. Join with a phone, tap a few ads in the feed and press Contribute.</p>
        </Card>
      ) : (
        <>
          <Card title="Where to show which ad" note={`Each cell is the model's predicted click rate for that category in that part of the day (other factors held at their typical values). Darker is higher. Outlined cell: the highest. The model starts from a prior click rate of ${pct(snap.campaign.prior_ctr, 0)} that you set, and moves away from it slowly: compare cells with each other, and treat absolute rates as uncalibrated until many contributions are in.`}>
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
            <Card title="What the model suggests">
              <ul className="tight">
                <li>Highest predicted click rate: <strong>{a.best.cat}</strong> ads at <strong>{a.best.hour} h</strong>, {pct(a.best.v)} against an average of {pct(ins.baseline_ctr)}.</li>
                <li>Lowest: <strong>{a.worst.cat}</strong> at <strong>{a.worst.hour} h</strong>, {pct(a.worst.v)}.</li>
              </ul>
              <p className="note">
                {ins.n_updates < 8
                  ? "Too few contributions to shift budget on this. Add devices or contributions, or raise the privacy budget, and see whether the pattern holds."
                  : "A starting point for a test, not a decision: run a small campaign in the top cells and check against measured clicks."}
              </p>
            </Card>
            <Card title="Never received">
<div className="sv-chips">{["Taps", "Timestamps", "Identifiers", "Location"].map((x) => <span key={x} className="sv-chip">{x}</span>)}</div>
            </Card>
          </div>

          <div className="grid2">
            <Card title="By category and time"><Bars title="Category" rows={ins.by_category} base={ins.baseline_ctr} /><Bars title="Time of day" rows={ins.by_hour} base={ins.baseline_ctr} /></Card>
            <Card title="By device and placement"><Bars title="Device" rows={ins.by_device} base={ins.baseline_ctr} /><Bars title="Placement" rows={ins.by_placement} base={ins.baseline_ctr} />
              <p className="note">Bars in blue are above the average (the tick), grey below. Device and placement estimates need many more contributions than category and time.</p>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
