// Renyi-DP accounting for Gaussian releases, a port of backend/src/fedad/privacy/rdp.py. The phone uses it to enforce ITS OWN
// privacy ceiling: it converts the server's per-upload noise std into the epsilon one upload costs, and refuses to upload if
// that is above what the user allowed, whatever the server's policy says.

function geomspace(a: number, b: number, n: number): number[] {
  const la = Math.log(a);
  const lb = Math.log(b);
  return Array.from({ length: n }, (_, i) => Math.exp(la + ((lb - la) * i) / (n - 1)));
}

export const ORDERS: number[] = [...geomspace(1e-3, 1, 120).map((x) => 1 + x), ...geomspace(2, 4096, 240)];

/** Total epsilon of ``releases`` Gaussian releases (noise std ``sigma``, L2 sensitivity ``sensitivity``) at ``delta``. */
export function epsAfter(sigma: number, sensitivity: number, releases: number, delta: number): number {
  if (releases <= 0) return 0;
  if (!(sigma > 0)) return Infinity;
  let best = Infinity;
  for (const a of ORDERS) {
    const rdp = (releases * a * sensitivity * sensitivity) / (2 * sigma * sigma);
    const eps = rdp + Math.log((a - 1) / a) - (Math.log(delta) + Math.log(a)) / (a - 1);
    if (eps < best) best = eps;
  }
  return Math.max(best, 0);
}
