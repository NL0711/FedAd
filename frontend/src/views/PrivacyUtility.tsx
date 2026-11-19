import { useEffect, useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ApiError, calibrate, getExperiments } from "../api";
import { Card, Loading, Metric, Notice, useLoad } from "../components";
import { COLORS, fixed, pm } from "../format";
import type { Calibration } from "../types";

const TICKS = [100, 300, 1000, 3000, 10000, 30000];
const AX = { fontSize: 14, fill: "#111827" };

export default function PrivacyUtility() {
  const { data, error, loading } = useLoad(getExperiments);

  return (
    <>
      <h2>Privacy vs utility</h2>
      <p className="lede">
        Local DP costs accuracy. Each point is the mean over independent seeds (each seed redraws the Criteo impressions, the client split and the training and noise
        randomness); bands are 95% confidence intervals. The only difference between the two curves is how the total ε is accounted for.
      </p>
      {loading && <Loading what="experiment results" />}
      {error && (
        <Notice kind={error instanceof ApiError && error.status === 404 ? "warn" : "error"} title={error instanceof ApiError && error.status === 404 ? "No experiment results yet" : "Could not load results"}>
          {error instanceof ApiError && error.status === 404 ? (
            <>
              Run <code>python -m fedad.experiments</code> in <code>backend/</code> (about 4 minutes), then reload this page. The interactive calibrator below works without it.
            </>
          ) : (
            error.message
          )}
        </Notice>
      )}
      {data && <Curves />}
      <Calibrator />
    </>
  );

  function Curves() {
    const pu = data!.privacy_utility;
    const rows = useMemo(
      () =>
        pu.curves.basic.map((b, i) => {
          const r = pu.curves.rdp[i];
          return {
            eps: b.eps_total,
            basic: b.auc.mean,
            basic_band: [b.auc.mean - b.auc.ci, b.auc.mean + b.auc.ci],
            rdp: r.auc.mean,
            rdp_band: [r.auc.mean - r.auc.ci, r.auc.mean + r.auc.ci],
          };
        }),
      [pu],
    );
    const nseeds = data!.seeds.length;
    return (
      <>
        <Card title={`Test AUC against total ε per client (${data!.n_clients} clients, ${pu.rounds} rounds, ${nseeds} seeds, δ = ${pu.delta_total.toExponential(0)})`}>
          <div className="legend">
            <span><span className="swatch" style={{ background: COLORS.blue }} />Basic composition</span>
            <span><span className="swatch" style={{ background: COLORS.orange }} />Rényi (RDP) accounting</span>
            <span><span className="swatch" style={{ background: COLORS.grey }} />No privacy baseline: {pm(pu.no_dp.auc)}</span>
          </div>
          <div style={{ width: "100%", height: 380 }}>
            <ResponsiveContainer>
              <ComposedChart data={rows} margin={{ top: 10, right: 24, bottom: 28, left: 8 }}>
                <CartesianGrid stroke="#e5e7eb" />
                <XAxis dataKey="eps" type="number" scale="log" domain={[80, 40000]} ticks={TICKS} tick={AX} label={{ value: "total ε per client (log scale)", position: "insideBottom", offset: -16, fontSize: 15, fill: "#111827" }} />
                <YAxis domain={[0.4, 1]} ticks={[0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]} tick={AX} width={60}label={{ value: "test AUC", angle: -90, position: "insideLeft", fontSize: 15, fill: "#111827" }} />
                <Tooltip formatter={(v) => (Array.isArray(v) ? `${Number(v[0]).toFixed(3)} to ${Number(v[1]).toFixed(3)}` : typeof v === "number" ? v.toFixed(3) : String(v))} labelFormatter={(l) => `ε = ${l}`} />
                <Legend wrapperStyle={{ display: "none" }} />
                <ReferenceLine y={pu.no_dp.auc.mean} stroke={COLORS.grey} strokeDasharray="8 5" strokeWidth={2} />
                <ReferenceLine y={0.5} stroke={COLORS.light} strokeDasharray="2 4" label={{ value: "chance", position: "insideBottomRight", fontSize: 13, fill: "#374151" }} />
                <Area dataKey="basic_band" name="Basic 95% CI" stroke="none" fill={COLORS.blue} fillOpacity={0.18} isAnimationActive={false} legendType="none" />
                <Area dataKey="rdp_band" name="RDP 95% CI" stroke="none" fill={COLORS.orange} fillOpacity={0.18} isAnimationActive={false} legendType="none" />
                <Line dataKey="basic" name="Basic composition" stroke={COLORS.blue} strokeWidth={3} dot={{ r: 4 }} isAnimationActive={false} />
                <Line dataKey="rdp" name="Rényi (RDP)" stroke={COLORS.orange} strokeWidth={3} dot={{ r: 4 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="note">
            Honest reading: with 20 clients and a 430-parameter model, local DP needs a total ε in the thousands before AUC approaches the no-privacy baseline.
            The paired gain below removes the seed-to-seed spread and isolates the effect of the accountant.
          </p>
        </Card>

        <div className="grid2">
          <Card title="Paired AUC gain of RDP over basic" note="Same seed, same data, same training randomness; only the noise differs. Positive means RDP is better.">
            {pu.paired_auc_gain_rdp ? (
              <table>
                <thead>
                  <tr>
                    <th className="num">Total ε</th>
                    <th className="num">AUC basic</th>
                    <th className="num">AUC RDP</th>
                    <th className="num">Gain (± 95% CI)</th>
                  </tr>
                </thead>
                <tbody>
                  {pu.paired_auc_gain_rdp.map((g, i) => (
                    <tr key={g.eps_total}>
                      <td className="num">{g.eps_total}</td>
                      <td className="num">{fixed(pu.curves.basic[i].auc.mean, 3)}</td>
                      <td className="num">{fixed(pu.curves.rdp[i].auc.mean, 3)}</td>
                      <td className="num">{(g.mean >= 0 ? "+" : "") + g.mean.toFixed(3)} ± {g.ci.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Notice kind="warn">These results predate the paired comparison. Re-run <code>python -m fedad.experiments</code> to add it.</Notice>
            )}
          </Card>

          <Card title="Noise needed for the same total (ε, δ)" note="Per-update noise std σ with clip C = 1 (sensitivity 2). The right column is the total ε the Rényi accountant assigns to the basic calibration: basic is valid but loose.">
            <div style={{ width: "100%", height: 200 }}>
              <ResponsiveContainer>
                <LineChart data={pu.noise} margin={{ top: 6, right: 16, bottom: 22, left: 4 }}>
                  <CartesianGrid stroke="#e5e7eb" />
                  <XAxis dataKey="eps_total" type="number" scale="log" domain={[80, 40000]} ticks={TICKS} tick={AX} label={{ value: "total ε", position: "insideBottom", offset: -12, fontSize: 14, fill: "#111827" }} />
                  <YAxis scale="log" domain={["auto", "auto"]} tick={AX} width={56} tickFormatter={(v) => Number(v).toPrecision(2)} />
                  <Tooltip formatter={(v) => (typeof v === "number" ? v.toFixed(3) : String(v))} labelFormatter={(l) => `ε = ${l}`} />
                  <Line dataKey="sigma_basic" name="σ basic" stroke={COLORS.blue} strokeWidth={3} dot isAnimationActive={false} />
                  <Line dataKey="sigma_rdp" name="σ RDP" stroke={COLORS.orange} strokeWidth={3} dot isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <table style={{ marginTop: "0.6rem" }}>
              <thead>
                <tr>
                  <th className="num">Total ε</th>
                  <th className="num">σ basic</th>
                  <th className="num">σ RDP</th>
                  <th className="num">RDP / basic</th>
                  <th className="num">Rényi ε of basic σ</th>
                </tr>
              </thead>
              <tbody>
                {pu.noise.map((n) => (
                  <tr key={n.eps_total}>
                    <td className="num">{n.eps_total}</td>
                    <td className="num">{fixed(n.sigma_basic, 3)}</td>
                    <td className="num">{fixed(n.sigma_rdp, 3)}</td>
                    <td className="num">{fixed(n.noise_ratio, 2)}</td>
                    <td className="num">{fixed(n.eps_rdp_of_basic, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </>
    );
  }
}

function Calibrator() {
  const [epsLog, setEpsLog] = useState(2);
  const [rounds, setRounds] = useState(20);
  const [clip, setClip] = useState(1);
  const epsTotal = Math.round(Math.pow(10, epsLog) * 10) / 10;
  const [res, setRes] = useState<Calibration | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      calibrate({ eps_total: epsTotal, rounds, clip_c: clip, delta_total: 1e-5 })
        .then((r) => {
          setRes(r);
          setErr(null);
        })
        .catch((e: Error) => setErr(e.message));
    }, 200);
    return () => window.clearTimeout(t);
  }, [epsTotal, rounds, clip]);

  return (
    <Card title="Calibrator: how much noise does a target guarantee need?" note="Gaussian mechanism, sensitivity 2C, δ = 1e-5. Basic composition splits (ε, δ) into T equal parts; Rényi accounting calibrates the whole T-fold composition. No amplification by subsampling is claimed.">
      <div className="controls">
        <div className="field">
          <label htmlFor="c-eps">Total ε per client: <span className="slider-val">{epsTotal}</span></label>
          <input id="c-eps" type="range" min={0} max={4} step={0.02} value={epsLog} onChange={(e) => setEpsLog(parseFloat(e.target.value))} />
        </div>
        <div className="field">
          <label htmlFor="c-rounds">Releases T (rounds): <span className="slider-val">{rounds}</span></label>
          <input id="c-rounds" type="range" min={1} max={200} step={1} value={rounds} onChange={(e) => setRounds(parseInt(e.target.value, 10))} />
        </div>
        <div className="field">
          <label htmlFor="c-clip">Clip bound C: <span className="slider-val">{clip}</span></label>
          <input id="c-clip" type="range" min={0.1} max={5} step={0.1} value={clip} onChange={(e) => setClip(parseFloat(e.target.value))} />
        </div>
      </div>
      {err && <Notice kind="error">{err}</Notice>}
      {res && (
        <div className="metrics" style={{ marginTop: "1rem" }}>
          <Metric label="σ, basic composition" value={fixed(res.sigma_basic, 3)} sub={`noise multiplier ${fixed(res.noise_multiplier_basic, 2)}`} />
          <Metric label="σ, Rényi accounting" value={fixed(res.sigma_rdp, 3)} sub={`noise multiplier ${fixed(res.noise_multiplier_rdp, 2)}`} />
          <Metric label="Noise ratio RDP / basic" value={fixed(res.noise_ratio, 2)} sub={res.noise_ratio < 1 ? `${Math.round((1 - res.noise_ratio) * 100)}% less noise` : "no saving"} />
          <Metric label="Rényi ε of the basic σ" value={fixed(res.eps_rdp_of_basic, 1)} sub={`target was ${epsTotal}`} />
        </div>
      )}
    </Card>
  );
}
