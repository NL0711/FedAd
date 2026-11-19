import { CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ApiError, getExperiments } from "../api";
import { Card, Loading, Notice, useLoad } from "../components";
import { COLORS, eps, fixed, pm } from "../format";
import type { Technique } from "../types";

const AX = { fontSize: 14, fill: "#111827" };

const GROUP_TITLES: Record<string, string> = {
  centralised: "Without federated learning: the admin collects every raw impression",
  baseline: "Federated, no privacy noise",
  aggregation: "Aggregation",
  "secure aggregation": "Secure aggregation",
  communication: "Communication",
  scheduling: "Scheduling",
  "differential privacy": "Differential privacy",
  combined: "Combined",
};

export default function BuildingBlocks() {
  const { data, error, loading } = useLoad(getExperiments);
  const missing = error instanceof ApiError && error.status === 404;

  const groups: { group: string; rows: Technique[] }[] = [];
  data?.techniques.forEach((t) => {
    const g = groups.find((x) => x.group === t.group);
    if (g) g.rows.push(t);
    else groups.push({ group: t.group, rows: [t] });
  });

  const comp = data?.compression.map((c) => ({ kb: c.kb_per_upload.mean, auc: c.auc.mean, label: c.top_k === 0 ? "dense" : `top-${c.top_k}` }));

  return (
    <>
      <h2>Building blocks</h2>
      <p className="lede">What each technique costs or buys, measured on the same real Criteo task (20 simulated publisher clients). Values are mean ± 95% CI over {data ? data.seeds.length : "several"} seeds.</p>
      {loading && <Loading what="experiment results" />}
      {error && (
        <Notice kind={missing ? "warn" : "error"} title={missing ? "No experiment results yet" : "Could not load results"}>
          {missing ? (
            <>
              Run <code>python -m fedad.experiments</code> in <code>backend/</code> (about 4 minutes), then reload.
            </>
          ) : (
            error.message
          )}
        </Notice>
      )}

      {data && (
        <>
          <Card title="Techniques compared" note="ε (run) is what the run's own accountant reports for the worst client; ε (Rényi) is the tighter bound for the same noise. Paillier time is for a 1024-bit demo key, not a secure size. A client in these runs is a simulated cohort, not a phone.">
            <table>
              <thead>
                <tr>
                  <th>Technique</th>
                  <th className="num">AUC</th>
                  <th className="num">Log loss</th>
                  <th className="num">KB / upload</th>
                  <th className="num">ε (run)</th>
                  <th className="num">ε (Rényi)</th>
                  <th className="num">Seconds / run</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <GroupRows key={g.group} title={GROUP_TITLES[g.group] ?? g.group} rows={g.rows} />
                ))}
              </tbody>
            </table>
          </Card>

          <div className="grid2">
            <Card title="Top-k sparsification: upload size against AUC" note="The logistic CTR model has 430 parameters, so absolute savings are small (a few KB); the ratio carries over to larger models. Sparsifying after noise is post-processing and costs no extra privacy.">
              <div style={{ width: "100%", height: 300 }}>
                <ResponsiveContainer>
                  <LineChart data={comp} margin={{ top: 22, right: 30, bottom: 28, left: 8 }}>
                    <CartesianGrid stroke="#e5e7eb" />
                    <XAxis dataKey="kb" type="number" domain={["dataMin - 0.005", "dataMax + 0.005"]} tick={AX} tickFormatter={(v) => Number(v).toFixed(3)} label={{ value: "KB per upload", position: "insideBottom", offset: -14, fontSize: 15, fill: "#111827" }} />
                    <YAxis domain={["auto", "auto"]} tick={AX} width={70} tickFormatter={(v) => Number(v).toFixed(4)}label={{ value: "test AUC", angle: -90, position: "insideLeft", fontSize: 15, fill: "#111827" }} />
                    <Tooltip formatter={(v) => (typeof v === "number" ? v.toFixed(4) : String(v))} />
                    <Line dataKey="auc" name="AUC" stroke={COLORS.green} strokeWidth={3} dot={{ r: 5 }} isAnimationActive={false}>
                      <LabelList dataKey="label" position="top" style={{ fontSize: 14, fill: "#111827" }} />
                    </Line>
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {data.flower_parity && data.flower_parity.length > 0 ? (
              <Card title="Flower runtime vs native engine" note="Both engines run the same Client, Edge and secure-sum code. Flower owns the ServerApp and ClientApp lifecycle and message passing on Ray; the update that crosses its message boundary is the already noised, compressed blob.">
                <table>
                  <thead>
                    <tr>
                      <th>Run</th>
                      <th className="num">AUC native</th>
                      <th className="num">AUC Flower</th>
                      <th className="num">Max |Δ weight|</th>
                      <th className="num">Flower s</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.flower_parity.map((p) => (
                      <tr key={p.name}>
                        <td>{p.name}</td>
                        <td className="num">{fixed(p.auc_native, 4)}</td>
                        <td className="num">{fixed(p.auc_flower, 4)}</td>
                        <td className="num">{p.max_abs_weight_diff.toExponential(1)}</td>
                        <td className="num">{fixed(p.flower_seconds, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="note">Flower {data.flower_parity[0].flower_version ?? ""}, one seed.</p>
              </Card>
            ) : (
              <Card title="Flower runtime vs native engine">
                <Notice kind="warn">
                  No parity results in this file. Run <code>python -m fedad.experiments --flower</code> (adds about 1 minute) to compare the two engines weight by weight.
                </Notice>
              </Card>
            )}
          </div>
        </>
      )}
    </>
  );
}

function GroupRows({ title, rows }: { title: string; rows: Technique[] }) {
  return (
    <>
      <tr className="group">
        <td colSpan={7}>{title}</td>
      </tr>
      {rows.map((t) => (
        <tr key={t.name}>
          <td>{t.name}</td>
          <td className="num">{pm(t.auc, 3)}</td>
          <td className="num">{pm(t.logloss, 3)}</td>
          <td className="num">{fixed(t.kb_per_upload.mean, 3)}</td>
          <td className="num">{eps(t.eps_run.mean)}</td>
          <td className="num">{eps(t.eps_rdp.mean)}</td>
          <td className="num">{fixed(t.seconds.mean, 2)}</td>
        </tr>
      ))}
    </>
  );
}
