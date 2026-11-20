// Federated client logic for the phone, free of DOM and storage so Node can run it against the real server in tests.
// It mirrors backend/src/fedad/api/client.py (RemoteClient.participate) and pipeline.Client.make_upload.
import { epsAfter } from "./rdp.ts";
import { addNoise, clipL2, localTrain, norm2, topK } from "./train.ts";
import { adler32, encodeUpdate, toBase64 } from "./wire.ts";

export interface Group { name: string; values: string[]; offset: number }
export interface NumericDef { name: string; doc: string; center: number; scale: number }
export interface Schema {
  spec: string; n_features: number; n_params: number; feature_names: string[];
  groups: Group[]; numeric: NumericDef[]; numeric_offset: number; numeric_clamp: number;
}
export interface Policy {
  clip_c: number; top_k: number; dp: boolean; eps_per_upload: number; delta_per_upload: number; max_uploads: number;
  local_epochs: number; lr: number; batch: number; sigma: number; accountant: string; eps_total: number; delta_total: number;
}
export interface ModelReply { version: number; weights: number[]; n_params: number; spec_hash: string; mode: string; policy: Policy }

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function call<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(base + path, init);
  const text = await r.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { /* not JSON */ }
  if (!r.ok) throw new ApiError(r.status, body.detail ?? body.error ?? `HTTP ${r.status}`);
  return body as T;
}

export const getSchema = (base: string) => call<Schema>(base, "/v1/schema");
export const getModel = (base: string) => call<ModelReply>(base, "/v1/model");
export const register = (base: string, join_code: string, label: string) =>
  call<{ token: string; device_id: number; label: string }>(base, "/v1/register", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ join_code, label }),
  });

export type StepState = "run" | "done" | "fail";
export interface ContributeInput {
  base: string; token: string; schema: Schema; X: Float64Array; y: Float64Array;
  /** Optional weight per row (default 1). The extension weights a clicked row by how long the person stayed on the page it led to. */
  weights?: Float64Array;
  ceilingPerUpload: number; allowNonPrivate: boolean; uploadsSoFar: number;
  onStep: (index: number, state: StepState, detail: string) => void;
}
/** What this phone computed and sent, kept so the app can show it (and the admin can match it by checksum). */
export interface Proof {
  rawDelta: number[]; clipped: number[]; sent: number[]; bytes: number; checksum: number;
  lossBefore: number; lossAfter: number; wGlobal: number[]; wLocal: number[]; sigma: number;
}
export interface ContributeResult { reply: { accepted: boolean; version: number; model_stepped: boolean }; model: ModelReply; epsCharged: number; proof: Proof }

export class Refused extends Error {}

export const STEPS = ["Get model", "Privacy limit", "Train here", "Clip", "Add noise", "Pack", "Send"];

async function attempt(inp: ContributeInput, retry: boolean): Promise<ContributeResult> {
  const { base, token, schema: S, onStep: step } = inp;
  const F = S.n_features;
  step(0, "run", "");
  const m = await getModel(base);
  if (S.spec !== "phone-ctr-v1" || m.n_params !== S.n_params) throw new Refused("model layout does not match the schema this app knows");
  const pol = m.policy;
  step(0, "done", `v${m.version}`);

  step(1, "run", "");
  const epsOne = pol.dp ? epsAfter(pol.sigma, 2 * pol.clip_c, 1, pol.delta_per_upload) : Infinity;
  if (!pol.dp && !inp.allowNonPrivate) {
    step(1, "fail", "no noise in this campaign");
    throw new Refused("Privacy is off here. Nothing sent.");
  }
  if (pol.dp && epsOne > inp.ceilingPerUpload) {
    step(1, "fail", `ε ${epsOne.toFixed(0)} is over your limit ${inp.ceilingPerUpload}`);
    throw new Refused(`Over your privacy limit (ε ${epsOne.toFixed(0)} > ${inp.ceilingPerUpload}). Nothing sent.`);
  }
  if (inp.uploadsSoFar >= pol.max_uploads) {
    step(1, "fail", "budget used");
    throw new Refused(`Budget used (${inp.uploadsSoFar} of ${pol.max_uploads}).`);
  }
  step(1, "done", pol.dp ? `ε ${epsOne.toFixed(0)} of ${inp.ceilingPerUpload}` : "off");

  step(2, "run", "");
  const n = inp.y.length;
  const res = localTrain(Float64Array.from(m.weights), inp.X, inp.y, F, pol.local_epochs, pol.lr, pol.batch, undefined, undefined, inp.weights);
  step(2, "done", `${n} views, loss ${res.before.toFixed(2)} → ${res.after.toFixed(2)}`);

  step(3, "run", "");
  const rawNorm = norm2(res.delta);
  const clipped = clipL2(res.delta, pol.clip_c);
  step(3, "done", `${rawNorm.toFixed(2)} → max ${pol.clip_c}`);

  step(4, "run", "");
  const noised = pol.dp ? addNoise(clipped, pol.sigma) : clipped;
  step(4, "done", pol.dp ? `σ ${pol.sigma.toFixed(2)}, ${(norm2(noised.map((x, i) => x - clipped[i])) / Math.max(norm2(clipped), 1e-9)).toFixed(1)}× the update` : "none");

  step(5, "run", "");
  const sparse = topK(noised, pol.top_k);
  const blob = encodeUpdate(sparse);
  step(5, "done", `${blob.length} B`);

  step(6, "run", "");
  try {
    const reply = await call<ContributeResult["reply"]>(base, "/v1/updates", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ base_version: m.version, n, loss_before: Math.max(res.before, 1e-9), loss_after: Math.max(res.after, 1e-9), blob: toBase64(blob) }),
    });
    step(6, "done", reply.model_stepped ? `model v${reply.version}` : "queued");
    const proof: Proof = {
      rawDelta: Array.from(res.delta), clipped: Array.from(clipped), sent: Array.from(sparse), bytes: blob.length, checksum: adler32(blob),
      lossBefore: res.before, lossAfter: res.after, wGlobal: m.weights, wLocal: m.weights.map((w, i) => w + res.delta[i]), sigma: pol.sigma,
    };
    return { reply, model: m, epsCharged: pol.dp ? epsOne : 0, proof };
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && retry) {
      step(6, "fail", "model moved, retrying");
      return attempt(inp, false);
    }
    const msg = e instanceof ApiError ? ({ 401: "Unknown device. Rejoin.", 429: "Budget used.", 413: "Too large." } as Record<number, string>)[e.status] ?? e.message : String(e);
    step(6, "fail", msg);
    throw new Refused(msg);
  }
}

export function contribute(inp: ContributeInput): Promise<ContributeResult> {
  return attempt(inp, true);
}

/** Predicted tap rate per ad category for a weight vector (local or global), same maths as the admin's insights. */
export function categoryRates(S: Schema, w: number[]): { name: string; ctr: number }[] {
  const sig = (z: number) => 1 / (1 + Math.exp(-z));
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const g = (name: string) => { const x = S.groups.find((q) => q.name === name)!; return { values: x.values, w: w.slice(x.offset, x.offset + x.values.length) }; };
  const base = w[w.length - 1] + mean(g("device").w) + mean(g("placement").w) + mean(g("hour_bucket").w);
  const cat = g("ad_category");
  return cat.values.map((name, i) => ({ name, ctr: sig(base + cat.w[i]) }));
}

/** What the global model says, computed from its weights exactly like the admin's insights (web/live.py). */
export function readModel(S: Schema, w: number[]) {
  const sig = (z: number) => 1 / (1 + Math.exp(-z));
  const grp = (name: string) => {
    const g = S.groups.find((x) => x.name === name)!;
    return { values: g.values, w: w.slice(g.offset, g.offset + g.values.length) };
  };
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const dev = grp("device"), hr = grp("hour_bucket"), cat = grp("ad_category"), pl = grp("placement");
  const base = w[w.length - 1] + mean(dev.w) + mean(pl.w);
  const byCat = cat.values.map((name, i) => ({ name, ctr: sig(base + cat.w[i] + mean(hr.w)) }));
  const byHour = hr.values.map((name, i) => ({ name, ctr: sig(base + hr.w[i] + mean(cat.w)) }));
  const top = (a: { name: string; ctr: number }[]) => a.reduce((b, x) => (x.ctr > b.ctr ? x : b));
  return { topCategory: top(byCat), topHour: top(byHour), average: sig(base + mean(cat.w) + mean(hr.w)) };
}
