// Runs the phone app's real wire / training / accounting code (src/phone/*.ts, executed by Node's built-in TypeScript
// stripping) on the cases in the JSON file given as argv[2], and prints the results as JSON. Used by
// backend/tests/test_phone_wire.py to prove the browser code matches the Python backend.
import { readFileSync } from "node:fs";
import { encodeUpdate, toBase64 } from "../src/phone/wire.ts";
import { localTrain } from "../src/phone/train.ts";
import { epsAfter } from "../src/phone/rdp.ts";

const cases = JSON.parse(readFileSync(process.argv[2], "utf8"));
const out = {};

out.encode = cases.encode.map((v) => toBase64(encodeUpdate(Float64Array.from(v))));

if (cases.train) {
  const t = cases.train;
  const F = t.X[0].length;
  const X = Float64Array.from(t.X.flat());
  let e = 0;
  const r = localTrain(Float64Array.from(t.w), X, Float64Array.from(t.y), F, t.epochs, t.lr, t.batch, () => t.perms[e++]);
  out.train = { delta: Array.from(r.delta), before: r.before, after: r.after };
}

out.rdp = (cases.rdp ?? []).map(([sigma, sens, releases, delta]) => epsAfter(sigma, sens, releases, delta));

process.stdout.write(JSON.stringify(out));
