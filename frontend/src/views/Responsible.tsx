import { ApiError, getExperiments } from "../api";
import { Card, Loading, Notice, useLoad } from "../components";
import { fixed } from "../format";

const SDGS = [
  { n: "9", name: "Industry, innovation", why: "Private ad infrastructure" },
  { n: "10", name: "Reduced inequalities", why: "Less data concentration" },
  { n: "12", name: "Responsible consumption", why: "Data minimised in commerce" },
  { n: "16", name: "Strong institutions", why: "Privacy as a right" },
];

const KEPT = ["Raw taps", "Timestamps", "Identifiers", "Location"];
const OPEN = ["Update size", "Loss values", "Who joins", "One person, many devices"];

export default function Responsible() {
  const { data, error, loading } = useLoad(getExperiments);
  const missing = error instanceof ApiError && error.status === 404;

  const dense = data?.compression.find((c) => c.top_k === 0);
  const sparse = data ? [...data.compression].filter((c) => c.top_k > 0).sort((a, b) => a.kb_per_upload.mean - b.kb_per_upload.mean)[0] : undefined;
  const ratio = dense && sparse ? dense.kb_per_upload.mean / sparse.kb_per_upload.mean : null;
  const fed = data?.techniques.find((t) => t.name.includes("Federated (FedAvg"));
  const rdp10k = data?.techniques.find((t) => t.name.includes("eps 10000, RDP"));

  return (
    <>
      <h2>Responsible AI</h2>
      <div className="grid2">
        <Card title="Stays on the device">
          <div className="sv-chips">{KEPT.map((k) => <span key={k} className="sv-chip">{k}</span>)}</div>
        </Card>
        <Card title="Not covered by the guarantee">
          <div className="sv-chips">{OPEN.map((k) => <span key={k} className="sv-chip hot">{k}</span>)}</div>
        </Card>
      </div>

      <Card title="Law">
        <div className="sv-chips"><span className="sv-chip">DPDP Act 2023</span><span className="sv-chip">GDPR Art. 5(1)(c)</span><span className="sv-chip hot">not a compliance claim</span></div>
      </Card>

      {loading && <Loading what="measurements" />}
      {error && (
        <Notice kind={missing ? "warn" : "error"}>{missing ? "Run python -m fedad.experiments" : error.message}</Notice>
      )}
      {data && fed && (
        <div className="metrics" style={{ marginBottom: "1.25rem" }}>
          <div className="metric"><div className="metric-label">AUC, no noise</div><div className="metric-value">{fixed(fed.auc.mean, 3)}</div></div>
          <div className="metric"><div className="metric-label">AUC at ε 10 000</div><div className="metric-value">{rdp10k ? fixed(rdp10k.auc.mean, 3) : "n/a"}</div></div>
          <div className="metric"><div className="metric-label">Upload, top-k</div><div className="metric-value">{ratio ? `${fixed(ratio, 1)}× smaller` : "n/a"}</div></div>
        </div>
      )}

      <Card title="SDGs">
        <table>
          <tbody>
            {SDGS.map((s) => (
              <tr key={s.n}>
                <td style={{ whiteSpace: "nowrap" }}><strong>SDG {s.n}</strong> {s.name}</td>
                <td>{s.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
