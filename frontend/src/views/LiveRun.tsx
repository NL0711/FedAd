import { useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { followRun, getHealth, startRun } from "../api";
import { Card, Metric, Notice, useLoad } from "../components";
import { COLORS, eps, fixed, kb } from "../format";
import type { RoundRow, RunRequest, RunSummary } from "../types";

const DEFAULTS: RunRequest = {
  engine: "native",
  mode: "sync",
  n_clients: 20,
  rounds: 15,
  seed: 0,
  dp: false,
  eps_total: 3000,
  accountant: "rdp",
  secure_agg: false,
  he: false,
  top_k: 0,
  agg: "fedavg",
  n_edges: 2,
};

const PRESETS: { label: string; patch: Partial<RunRequest> }[] = [
  { label: "No privacy baseline", patch: { dp: false } },
  { label: "Local DP ε=1000 (basic)", patch: { dp: true, eps_total: 1000, accountant: "basic" } },
  { label: "Local DP ε=1000 (RDP)", patch: { dp: true, eps_total: 1000, accountant: "rdp" } },
];

interface Finished {
  n: number;
  label: string;
  req: RunRequest;
  summary: RunSummary;
}

function describe(r: RunRequest): string {
  const parts = [r.dp ? `DP ε=${r.eps_total} ${r.accountant === "rdp" ? "RDP" : "basic"}` : "no DP"];
  if (r.secure_agg) parts.push("secret sharing");
  if (r.he) parts.push("Paillier HE");
  if (r.top_k) parts.push(`top-${r.top_k}`);
  if (r.agg === "weighted") parts.push("weighted");
  if (r.mode === "async") parts.push("async");
  return parts.join(", ");
}

function Chart({ title, rows, lines, yLabel, domain }: {
  title: string;
  rows: Record<string, number | null>[];
  lines: { key: string; name: string; color: string; dash?: string }[];
  yLabel: string;
  domain?: [number | "auto", number | "auto"];
}) {
  return (
    <Card title={title}>
      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 18, left: 4 }}>
            <CartesianGrid stroke="#e5e7eb" />
            <XAxis dataKey="step" tick={{ fontSize: 14, fill: "#111827" }} label={{ value: "round / model version", position: "insideBottom", offset: -10, fontSize: 14, fill: "#111827" }} />
            <YAxis domain={domain ?? ["auto", "auto"]} tick={{ fontSize: 14, fill: "#111827" }} width={64} label={{ value: yLabel, angle: -90, position: "insideLeft", fontSize: 14, fill: "#111827" }} />
            <Tooltip formatter={(v) => (typeof v === "number" ? v.toFixed(3) : String(v))} />
            <Legend wrapperStyle={{ fontSize: 15 }} />
            {lines.map((l) => (
              <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} strokeDasharray={l.dash} strokeWidth={3} dot={false} isAnimationActive={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export default function LiveRun() {
  const [req, setReq] = useState<RunRequest>(DEFAULTS);
  const [rows, setRows] = useState<RoundRow[]>([]);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Finished[]>([]);
  const stop = useRef<(() => void) | null>(null);
  const counter = useRef(0);
  const health = useLoad(getHealth);

  useEffect(() => () => stop.current?.(), []);

  const set = <K extends keyof RunRequest>(k: K, v: RunRequest[K]) => setReq((r) => ({ ...r, [k]: v }));
  const flowerOk = health.data ? health.data.engines.includes("flower") : false;

  function launch(r: RunRequest) {
    stop.current?.();
    setRows([]);
    setSummary(null);
    setError(null);
    setRunning(true);
    startRun(r)
      .then(({ id }) => {
        stop.current = followRun(id, {
          onRound: (row) => setRows((prev) => [...prev, row]),
          onDone: (s) => {
            setSummary(s);
            setRunning(false);
            counter.current += 1;
            const n = counter.current;
            setHistory((h) => [{ n, label: describe(r), req: r, summary: s }, ...h].slice(0, 6));
          },
          onError: (m) => {
            setError(m);
            setRunning(false);
          },
        });
      })
      .catch((e: Error) => {
        setError(e.message);
        setRunning(false);
      });
  }

  function preset(patch: Partial<RunRequest>) {
    const next = { ...req, ...patch };
    setReq(next);
    launch(next);
  }

  const chartRows = useMemo(() => {
    let cum = 0;
    return rows.map((r, i) => {
      cum += r.bytes_up / 1024;
      return { step: i + 1, auc: r.auc, logloss: r.logloss, eps_basic: r.eps_basic, eps_rdp: r.eps_rdp, cum_kb: cum };
    });
  }, [rows]);

  const dpRun = req.dp;
  const status = running ? (rows.length ? `Running: ${rows.length} of ${req.rounds}${req.mode === "async" ? "+" : ""} steps` : req.engine === "flower" ? "Starting Flower and Ray (about 25 s)…" : "Starting…") : summary ? "Finished" : "Idle";

  return (
    <>
      <h2>Benchmark run</h2>
      <p className="lede">Configure a federated training run on real Criteo ad impressions (split across simulated publisher clients) and watch it round by round. Run a baseline, then DP with each accountant, and compare in the table below.</p>

      <Card title="Configuration">
        <div className="row" style={{ marginTop: 0, marginBottom: "0.9rem" }}>
          <span style={{ fontWeight: 600 }}>Presets (start immediately):</span>
          {PRESETS.map((p) => (
            <button key={p.label} className="btn secondary" disabled={running} onClick={() => preset(p.patch)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="controls">
          <div className="field">
            <label htmlFor="engine">Federated runtime</label>
            <select id="engine" value={req.engine} onChange={(e) => setReq((r) => ({ ...r, engine: e.target.value as RunRequest["engine"], mode: e.target.value === "flower" ? "sync" : r.mode }))}>
              <option value="native">Native (fast, in-process)</option>
              <option value="flower" disabled={!flowerOk}>Flower (Ray simulation)</option>
            </select>
            {req.engine === "flower" && <span className="hint">Flower and Ray start-up takes about 25 s per run. Results match the native engine.</span>}
            {!flowerOk && health.data && <span className="hint">Flower is not installed in the backend environment.</span>}
          </div>
          <div className="field">
            <label htmlFor="mode">Round scheduling</label>
            <select id="mode" value={req.mode} onChange={(e) => set("mode", e.target.value as RunRequest["mode"])}>
              <option value="sync">Synchronous</option>
              <option value="async" disabled={req.engine === "flower"}>Asynchronous (buffered, K=4)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="clients">Clients</label>
            <input id="clients" type="number" min={5} max={50} value={req.n_clients} onChange={(e) => set("n_clients", clampInt(e.target.value, 5, 50))} />
          </div>
          <div className="field">
            <label htmlFor="rounds">{req.mode === "async" ? "Uploads per client" : "Rounds"}</label>
            <input id="rounds" type="number" min={3} max={40} value={req.rounds} onChange={(e) => set("rounds", clampInt(e.target.value, 3, 40))} />
          </div>
          <div className="field">
            <label htmlFor="seed">Seed</label>
            <input id="seed" type="number" min={0} max={999} value={req.seed} onChange={(e) => set("seed", clampInt(e.target.value, 0, 999))} />
          </div>
          <div className="field">
            <label htmlFor="edges">Edge nodes</label>
            <input id="edges" type="number" min={1} max={4} value={req.n_edges} onChange={(e) => set("n_edges", clampInt(e.target.value, 1, 4))} />
          </div>
          <div className="field">
            <label htmlFor="agg">Aggregation weights</label>
            <select id="agg" value={req.agg} onChange={(e) => set("agg", e.target.value as RunRequest["agg"])}>
              <option value="fedavg">FedAvg</option>
              <option value="weighted">Paper eq. 3</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="topk">Top-k sparsification <span className="hint">(0 = dense, 430 parameters)</span></label>
            <input id="topk" type="number" min={0} max={430} value={req.top_k} onChange={(e) => set("top_k", clampInt(e.target.value, 0, 430))} />
          </div>
          <div className="field">
            <span className="lab">Secure aggregation</span>
            <label className="check">
              <input type="checkbox" checked={req.secure_agg} onChange={(e) => setReq((r) => ({ ...r, secure_agg: e.target.checked, he: e.target.checked ? false : r.he }))} />
              Secret sharing (3 servers)
            </label>
            <label className="check">
              <input type="checkbox" checked={req.he} onChange={(e) => setReq((r) => ({ ...r, he: e.target.checked, secure_agg: e.target.checked ? false : r.secure_agg }))} />
              Paillier HE (1024-bit demo size)
            </label>
          </div>
          <div className="field">
            <span className="lab">Differential privacy</span>
            <label className="check">
              <input type="checkbox" checked={req.dp} onChange={(e) => set("dp", e.target.checked)} />
              Local DP on every update
            </label>
          </div>
          <div className="field">
            <label htmlFor="eps">Total ε per client {dpRun && <span className="slider-val">{req.eps_total}</span>}</label>
            <input id="eps" type="range" min={1} max={5} step={0.05} disabled={!dpRun} value={Math.log10(req.eps_total)} onChange={(e) => set("eps_total", roundEps(Math.pow(10, parseFloat(e.target.value))))} />
            <span className="hint">log scale, 10 to 100 000; δ = 1e-5. Real CTR data needs ε in the thousands.</span>
          </div>
          <div className="field">
            <label htmlFor="acct">Accountant <span className="hint">(RDP needs less noise)</span></label>
            <select id="acct" disabled={!dpRun} value={req.accountant} onChange={(e) => set("accountant", e.target.value as RunRequest["accountant"])}>
              <option value="rdp">Rényi (RDP)</option>
              <option value="basic">Basic (sum of ε)</option>
            </select>
          </div>
        </div>
        <div className="row">
          <button className="btn" disabled={running} onClick={() => launch(req)}>
            {running ? "Running…" : "Start run"}
          </button>
          <span aria-live="polite" style={{ fontWeight: 600 }}>{status}</span>
        </div>
      </Card>

      {error && <Notice kind="error" title="Run failed">{error}</Notice>}
      {health.error && <Notice kind="error" title="Backend not reachable">{health.error.message}</Notice>}

      {(rows.length > 0 || running) && (
        <>
          <div className="grid2">
            <Chart title="Test AUC (higher is better)" rows={chartRows} yLabel="AUC" domain={[0.4, 1]} lines={[{ key: "auc", name: "AUC", color: COLORS.blue }]} />
            <Chart title="Test log loss (lower is better)" rows={chartRows} yLabel="log loss" lines={[{ key: "logloss", name: "log loss", color: COLORS.orange }]} />
            <Chart
              title="Privacy budget spent (worst client)"
              rows={chartRows}
              yLabel="ε"
              lines={[
                { key: "eps_basic", name: "ε under the run's accountant", color: COLORS.blue },
                { key: "eps_rdp", name: "ε by Rényi bound (same releases)", color: COLORS.orange, dash: "8 5" },
              ]}
            />
            <Chart title="Cumulative upload (all clients)" rows={chartRows} yLabel="KB" lines={[{ key: "cum_kb", name: "uploaded KB", color: COLORS.green }]} />
          </div>
          {!dpRun && <p className="note">DP is off, so no privacy budget is spent and no formal guarantee applies to these updates.</p>}
          {dpRun && req.accountant === "rdp" && <p className="note">With the Rényi accountant the run's own ε is the Rényi bound, so the two budget lines coincide. Run the basic accountant to see them differ.</p>}
        </>
      )}

      {summary && (
        <Card title="Result" note="Held-out test split of the real Criteo clients, pooled. The ε shown is the worst client's. Both accountants describe the same noise; Rényi is the tighter bound.">
          <div className="metrics">
            <Metric label="Test AUC" value={fixed(summary.auc, 4)} />
            <Metric label="Log loss" value={fixed(summary.logloss, 4)} />
            <Metric label="Upload per client" value={kb(summary.kb_per_upload)} sub={`${fixed(summary.compression_ratio, 2)}× smaller than dense (${kb(summary.dense_kb)})`} />
            <Metric label="ε, run's accountant" value={eps(summary.eps_run)} />
            <Metric label="ε, Rényi bound" value={eps(summary.eps_rdp)} sub={summary.eps_run && summary.eps_rdp && summary.eps_rdp < summary.eps_run * 0.999 ? "tighter than the sum" : undefined} />
            <Metric label="Noise σ per update" value={summary.sigma_min === null ? "none" : summary.sigma_min === summary.sigma_max ? fixed(summary.sigma_min, 3) : `${fixed(summary.sigma_min, 2)} – ${fixed(summary.sigma_max, 2)}`} sub="clip C = 1" />
            <Metric label="Wall time" value={`${fixed(summary.seconds, 1)} s`} sub={`${summary.engine} engine, ${summary.mode}`} />
          </div>
        </Card>
      )}

      {history.length > 0 && (
        <Card title="Compare runs (last 6)">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Configuration</th>
                <th>Engine</th>
                <th className="num">AUC</th>
                <th className="num">Log loss</th>
                <th className="num">KB / upload</th>
                <th className="num">ε run</th>
                <th className="num">ε Rényi</th>
                <th className="num">σ</th>
                <th className="num">Seconds</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={h.n} className={i === 0 ? "current" : undefined}>
                  <td>{h.n}</td>
                  <td>{h.label}</td>
                  <td>{h.summary.engine}</td>
                  <td className="num">{fixed(h.summary.auc, 4)}</td>
                  <td className="num">{fixed(h.summary.logloss, 4)}</td>
                  <td className="num">{fixed(h.summary.kb_per_upload, 3)}</td>
                  <td className="num">{eps(h.summary.eps_run)}</td>
                  <td className="num">{eps(h.summary.eps_rdp)}</td>
                  <td className="num">{h.summary.sigma_min === null ? "none" : fixed(h.summary.sigma_min, 2)}</td>
                  <td className="num">{fixed(h.summary.seconds, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">Same seed means the same Criteo impressions and client split, so differences between rows come from the configuration. One seed is one draw: see Privacy vs utility for five-seed intervals.</p>
        </Card>
      )}
    </>
  );
}

function clampInt(s: string, lo: number, hi: number): number {
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? lo : Math.min(hi, Math.max(lo, n));
}

function roundEps(x: number): number {
  if (x >= 100) return Math.round(x / 5) * 5;
  if (x >= 10) return Math.round(x);
  return Math.round(x * 10) / 10;
}
