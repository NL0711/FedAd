import { ApiError, getExperiments } from "../api";
import { Card, Loading, Metric, Notice, useLoad } from "../components";
import { fixed, pm } from "../format";
import type { Experiments, Stat } from "../types";

function Bar({ label, s, max, color }: { label: string; s: Stat; max: number; color: string }) {
  return (
    <div className="bar-row wide">
      <span className="bar-name">{label}</span>
      <span className="bar-track">
        <i style={{ width: `${(100 * Math.max(s.mean - 0.5, 0)) / (max - 0.5)}%`, background: color }} />
      </span>
      <span className="bar-val">{pm(s, 3)}</span>
    </div>
  );
}

const find = (d: Experiments, text: string) => d.techniques.find((t) => t.name.includes(text));

export default function Benefit() {
  const { data, error, loading } = useLoad(getExperiments);
  const missing = error instanceof ApiError && error.status === 404;
  if (loading) return <Loading what="benchmark results" />;
  if (error || !data) {
    return (
      <Notice kind={missing ? "warn" : "error"} title={missing ? "No benchmark results yet" : "Could not load results"}>
        {missing ? <>Run <code>python -m fedad.experiments</code> in <code>backend/</code>, then reload.</> : error?.message}
      </Notice>
    );
  }

  const central = find(data, "Centralised");
  const fed = find(data, "Federated (FedAvg");
  const dp10k = find(data, "eps 10000, RDP");
  const dp1k = find(data, "eps 1000, RDP");
  const rdpCurve = data.privacy_utility.curves.rdp;
  const dp30k = rdpCurve.find((c) => c.eps_total === 30000);
  const rows = central?.raw_rows_collected ?? data.dataset?.sample_rows ?? 0;
  const gap = central && fed ? central.auc.mean - fed.auc.mean : null;
  const top = Math.max(...[central, fed, dp30k, dp10k, dp1k].filter(Boolean).map((x) => x!.auc.mean)) + 0.02;
  const ds = data.dataset;

  return (
    <>
      <h2>Benefit to the ad admin</h2>
      <p className="lede">
        Measured on real Criteo ad-click data{ds ? ` (${(data.rows ?? ds.sample_rows).toLocaleString("en-US")} impressions per run, drawn from a ${ds.sample_rows.toLocaleString("en-US")} sample; ${(100 * ds.click_rate).toFixed(1)}% clicks)` : ""},
        split across {data.n_clients} simulated publisher clients; mean ± 95% CI over {data.seeds.length} seeds.
      </p>

      <div className="metrics" style={{ marginBottom: "1.25rem" }}>
        <Metric label="Raw training impressions you must store" value={`${rows.toLocaleString("en-US")} → 0`} sub="centralised vs federated, per run" />
        <Metric label="Federated minus centralised AUC" value={gap === null ? "n/a" : (gap <= 0 ? "+" : "-") + fixed(Math.abs(gap), 3)} sub={central && fed ? `${fixed(fed.auc.mean, 3)} federated vs ${fixed(central.auc.mean, 3)} centralised: within noise` : undefined} />
        <Metric label="AUC with strong-ish noise" value={dp10k ? fixed(dp10k.auc.mean, 3) : "n/a"} sub="local DP, total ε 10 000, Rényi" />
      </div>

      <div className="grid2">
        <Card title="Accuracy: collect data, or keep it on the device" note="AUC is how well the model ranks clicked impressions above unclicked ones (0.5 is chance). Without noise, federated training matched pooling the raw data here (the centralised model is a plain regularised logistic regression, not a tuned ceiling). Adding differential privacy is what costs accuracy, and the cost grows quickly as ε falls.">
          {central && <Bar label="Centralised (raw data pooled)" s={central.auc} max={top} color="#111827" />}
          {fed && <Bar label="Federated, no noise" s={fed.auc} max={top} color="#0072b2" />}
          {dp30k && <Bar label="Federated + DP, ε 30 000" s={dp30k.auc} max={top} color="#009e73" />}
          {dp10k && <Bar label="Federated + DP, ε 10 000" s={dp10k.auc} max={top} color="#009e73" />}
          {dp1k && <Bar label="Federated + DP, ε 1 000" s={dp1k.auc} max={top} color="#d55e00" />}
          <p className="note">Bars start at 0.5 (chance). Wide intervals come from the seed-to-seed spread of the data split.</p>
        </Card>

        <Card title="Without and with federated learning">
          <table>
            <thead><tr><th /><th>Collect raw data</th><th>Federated + DP</th></tr></thead>
            <tbody>
              <tr><th scope="row">Personal data you hold</th><td>All {rows.toLocaleString("en-US")} training impressions, per user</td><td>None</td></tr>
              <tr><th scope="row">Breach exposes</th><td>Every user's behaviour</td><td>Noised updates</td></tr>
              <tr><th scope="row">Compliance load</th><td>Full</td><td>Much less</td></tr>
              <tr><th scope="row">Model accuracy (AUC)</th><td>{central ? pm(central.auc, 3) : "n/a"}</td><td>{fed ? pm(fed.auc, 3) : "n/a"}; {dp10k ? pm(dp10k.auc, 3) : "n/a"} at ε 10 000</td></tr>
              <tr><th scope="row">You take on</th><td>Storage, retention</td><td>Client code, ε budget</td></tr>
            </tbody>
          </table>
        </Card>
      </div>

<Notice kind="info">ε in the thousands is a weak guarantee. Federation simulated from one Criteo day; AUCs are not a forecast.</Notice>
    </>
  );
}
