// On-device training and privacy steps. A line-by-line port of backend/src/fedad/ml/model.py (Model.local_train),
// backend/src/fedad/privacy/dp.py (clip_l2, add_gaussian_noise) and backend/src/fedad/aggregation/compress.py (top_k).
// Rows are stored flat: X[i * F + j]. The model is w = [F weights..., bias].

function randomUint32(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

/** Uniform integer in [0, n) without modulo bias. */
export function randomInt(n: number): number {
  const limit = Math.floor(0x100000000 / n) * n;
  let x = randomUint32();
  while (x >= limit) x = randomUint32();
  return x % n;
}

export function cryptoPermutation(n: number): Int32Array {
  const p = new Int32Array(n);
  for (let i = 0; i < n; i++) p[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  return p;
}

/** N(0, 1) from the browser's cryptographic RNG (Box-Muller). */
export function gaussian(): number {
  const u1 = (randomUint32() + 1) / 4294967297;
  const u2 = (randomUint32() + 1) / 4294967297;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function sigmoidClipped(z: number): number {
  const c = Math.max(-30, Math.min(30, z));
  return 1 / (1 + Math.exp(-c));
}

function predictRow(w: Float64Array, X: Float64Array, i: number, F: number): number {
  let z = w[F];
  const o = i * F;
  for (let j = 0; j < F; j++) z += X[o + j] * w[j];
  return sigmoidClipped(z);
}

/** Mean log loss. ``wts`` is an optional weight per row (default 1): the loss is the weighted mean. */
export function logLoss(w: Float64Array, X: Float64Array, y: Float64Array, F: number, wts?: Float64Array): number {
  const n = y.length;
  let s = 0, ws = 0;
  for (let i = 0; i < n; i++) {
    const p = Math.min(1 - 1e-7, Math.max(1e-7, predictRow(w, X, i, F)));
    const wi = wts ? wts[i] : 1;
    s += wi * (y[i] * Math.log(p) + (1 - y[i]) * Math.log(1 - p));
    ws += wi;
  }
  return -s / ws;
}

export interface LocalResult {
  delta: Float64Array;
  before: number;
  after: number;
}

/** Minibatch SGD from ``w`` (same loop as Model.local_train). ``perm`` supplies each epoch's shuffle order.
 *  ``wts`` is an optional weight per row (default 1, which is exactly Model.local_train): a batch's gradient is the weighted mean, so the
 *  step size stays the same however large the weights are. The update is clipped afterwards, so weights never raise the privacy cost. */
export function localTrain(w: Float64Array, X: Float64Array, y: Float64Array, F: number, epochs: number, lr: number,
                           batch: number, perm: (n: number) => ArrayLike<number> = cryptoPermutation, l2 = 1e-4, wts?: Float64Array): LocalResult {
  const n = y.length;
  const before = logLoss(w, X, y, F, wts);
  const cur = Float64Array.from(w);
  const g = new Float64Array(F + 1);
  for (let e = 0; e < epochs; e++) {
    const order = perm(n);
    for (let s = 0; s < n; s += batch) {
      const m = Math.min(batch, n - s);
      g.fill(0);
      let errSum = 0, wSum = 0;
      for (let k = 0; k < m; k++) {
        const i = order[s + k];
        const wi = wts ? wts[i] : 1;
        const err = (predictRow(cur, X, i, F) - y[i]) * wi;
        errSum += err;
        wSum += wi;
        const o = i * F;
        for (let j = 0; j < F; j++) g[j] += X[o + j] * err;
      }
      for (let j = 0; j < F; j++) g[j] = g[j] / wSum + l2 * cur[j];
      g[F] = errSum / wSum;
      for (let j = 0; j <= F; j++) cur[j] -= lr * g[j];
    }
  }
  const delta = new Float64Array(F + 1);
  for (let j = 0; j <= F; j++) delta[j] = cur[j] - w[j];
  return { delta, before, after: logLoss(cur, X, y, F, wts) };
}

export function norm2(v: Float64Array): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return Math.sqrt(s);
}

/** dp.clip_l2: v / max(1, ||v|| / c). */
export function clipL2(v: Float64Array, c: number): Float64Array {
  const f = Math.max(1, norm2(v) / c);
  return v.map((x) => x / f);
}

/** Eq. (4): v + N(0, sigma^2 I), fresh noise from crypto.getRandomValues. */
export function addNoise(v: Float64Array, sigma: number): Float64Array {
  return v.map((x) => x + sigma * gaussian());
}

/** compress.top_k: keep the k largest magnitudes, zero the rest. Apply AFTER noise (post-processing, no privacy cost). */
export function topK(v: Float64Array, k: number): Float64Array {
  if (k <= 0 || k >= v.length) return v;
  const order = Array.from(v.keys()).sort((a, b) => Math.abs(v[b]) - Math.abs(v[a]));
  const out = new Float64Array(v.length);
  for (let t = 0; t < k; t++) out[order[t]] = v[order[t]];
  return out;
}
