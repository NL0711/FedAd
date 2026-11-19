import { Card } from "../components";

const BLUE = "#0072B2";
const ORANGE = "#D55E00";
const GREEN = "#009E73";

function Box({ x, y, w, h, color, title, lines }: { x: number; y: number; w: number; h: number; color: string; title: string; lines: string[] }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="#fff" stroke={color} strokeWidth={4} />
      <rect x={x} y={y} width={w} height={44} fill={color} />
      <text x={x + w / 2} y={y + 30} textAnchor="middle" fontSize={22} fontWeight={700} style={{ fill: "#fff" }}>
        {title}
      </text>
      {lines.map((l, i) => (
        <text key={l} x={x + 16} y={y + 78 + i * 30} fontSize={19}>
          {l}
        </text>
      ))}
    </g>
  );
}

function Arrow({ x1, x2, y, label, label2 }: { x1: number; x2: number; y: number; label: string; label2?: string }) {
  return (
    <g>
      <line x1={x1} y1={y} x2={x2 - 10} y2={y} stroke="#111827" strokeWidth={4} />
      <polygon points={`${x2},${y} ${x2 - 16},${y - 9} ${x2 - 16},${y + 9}`} fill="#111827" />
      <text x={(x1 + x2) / 2} y={y - 14} textAnchor="middle" fontSize={17} fontWeight={600}>
        {label}
      </text>
      {label2 && (
        <text x={(x1 + x2) / 2} y={y + 28} textAnchor="middle" fontSize={17}>
          {label2}
        </text>
      )}
    </g>
  );
}

export default function Pipeline() {
  return (
    <>
      <h2>Pipeline: clients, edge nodes, cloud</h2>
      <p className="lede">
        Devices train on their own ad impressions and upload only a clipped, noised, compressed model update. Edge nodes pre-aggregate; the
        cloud combines the partial sums and steps the global model. Flower runs the federated lifecycle (ServerApp, ClientApp, message passing, virtual
        supernodes); FedAd supplies what happens inside each stage.
      </p>

      <Card title="One round">
        <svg className="flow" viewBox="0 0 1300 330" role="img" aria-label="Clients upload noised updates to edge nodes, which send partial sums to the cloud; the cloud sends the new global model back.">
          <Box x={10} y={20} w={360} h={250} color={BLUE} title="Client (device)" lines={["1. local SGD on own data", "2. clip update to L2 norm C", "3. add Gaussian noise (DP)", "4. optional top-k sparsify", "5. encode: gaps + float16 + DEFLATE"]} />
          <Box x={470} y={20} w={340} h={250} color={ORANGE} title="Edge node" lines={["1. decode the uploads", "2. weights a_i (FedAvg or eq. 3)", "3. partial sums:", "    S = Σ a_i · update_i", "    W = Σ a_i"]} />
          <Box x={910} y={20} w={380} h={250} color={GREEN} title="Cloud coordinator" lines={["1. combine [S, W] from edges", "   plain | secret sharing | Paillier HE", "2. new model  w ← w + S / W", "3. broadcast the global model", "    (no raw data, no single update)"]} />
          <Arrow x1={372} x2={468} y={120} label="noised" label2="update" />
          <Arrow x1={812} x2={908} y={120} label="[S, W]" label2="sums only" />
          <path d="M 1100 275 L 1100 312 L 190 312 L 190 275" fill="none" stroke="#111827" strokeWidth={4} strokeDasharray="10 8" />
          <polygon points="190,272 181,288 199,288" fill="#111827" />
          <text x={650} y={303} textAnchor="middle" fontSize={17} fontWeight={600} style={{ fill: "#111827" }} stroke="#fff" strokeWidth={6} paintOrder="stroke">
            global model, next round
          </text>
        </svg>
        <p className="note">
          The privacy boundary is the end of step 5 on the client: only that blob, the example count and two loss values leave the device. Secret
          sharing and Paillier HE are alternative cloud-side combiners, not layered.
        </p>
      </Card>

      <Card title="Who sees what">
        <table>
          <thead>
            <tr>
              <th>Party</th>
              <th>Sees</th>
              <th>Does not see</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Client</td>
              <td>Own taps, global model</td>
              <td>Others' data</td>
            </tr>
            <tr>
              <td>Edge (trusted)</td>
              <td>Noised updates</td>
              <td>Raw taps</td>
            </tr>
            <tr>
              <td>Cloud</td>
              <td>Sums only</td>
              <td>Any single update</td>
            </tr>
          </tbody>
        </table>
        <p className="note">
          Edges are trusted because computing weights needs individual updates. Secret sharing protects against fewer than k colluding servers
          only. This is a simulation on one machine, not a hardened deployment.
        </p>
      </Card>

      <Card title="Differential privacy">
        <p className="note">
          Each client gets a per-client (ε, δ) guarantee for its noised update under local DP: clip to C, add N(0, σ²I) with σ calibrated to the
          sensitivity 2C. Per-round spends are composed either by the basic theorem (sum of ε) or by Rényi accounting, which is much tighter.
          On this task a useful model needs a large total ε; the demo shows that plainly rather than hiding it.
        </p>
      </Card>
    </>
  );
}
