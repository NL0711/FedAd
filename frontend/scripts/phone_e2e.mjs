// End-to-end check of the phone's real client code against a running server (no browser needed):
//   node scripts/phone_e2e.mjs http://127.0.0.1:8000 <join code> [contributions]
// Registers a device, fabricates impressions of a user who likes Tech ads in the evening, and contributes through
// src/phone/client.ts (the same code the phone runs), printing each step.
import { contribute, getSchema, register, readModel, STEPS } from "../src/phone/client.ts";

const [base, code, times = "1"] = process.argv.slice(2);
const schema = await getSchema(base);
const reg = await register(base, code, "node-e2e");
const F = schema.n_features;
const grp = Object.fromEntries(schema.groups.map((g) => [g.name, g]));

const n = 120;
const X = new Float64Array(n * F);
const y = new Float64Array(n);
for (let i = 0; i < n; i++) {
  const cat = i % 8, hour = (i * 7) % 6;
  X[i * F + grp.device.offset] = 1;
  X[i * F + grp.hour_bucket.offset + hour] = 1;
  X[i * F + grp.ad_category.offset + cat] = 1;
  X[i * F + grp.placement.offset + (i % 4)] = 1;
  y[i] = cat === 1 && hour === 5 ? 1 : i % 17 === 0 ? 1 : 0;
}

let last;
for (let k = 0; k < Number(times); k++) {
  last = await contribute({
    base, token: reg.token, schema, X, y, ceilingPerUpload: 150, allowNonPrivate: false, uploadsSoFar: k,
    onStep: (i, state, detail) => console.log(`  [${state}] ${STEPS[i]}${detail ? " -> " + detail : ""}`),
  });
  console.log(`contribution ${k + 1}:`, JSON.stringify(last.reply), "eps one upload", last.epsCharged.toFixed(2));
}
const m = await (await fetch(base + "/v1/model")).json();
console.log("global model says:", JSON.stringify(readModel(schema, m.weights)));
