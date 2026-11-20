// Service worker: the only place that reads history, trains and talks to the server.
import { contribute, getSchema, register, Refused, type Schema } from "../../frontend/src/phone/client.ts";
import { buildProfile, buildRows, collectVisits } from "./features.ts";

export interface LogEntry {
  t: number; n: number; categories: Record<string, number>; bytes: number; checksum: number; eps: number; version: number; stepped: boolean;
  kind?: "profile"; email?: string;
}
export interface State {
  consent: boolean; paused: boolean; base: string; joined: boolean; deviceId: number | null; uploads: number;
  ceiling: number; log: LogEntry[];
}
const DEFAULTS: State = { consent: false, paused: false, base: "", joined: false, deviceId: null, uploads: 0, ceiling: 150, log: [] };
const DAYS = 7;
const MIN_ROWS = 20, MIN_POSITIVE = 2;

async function load(): Promise<State & { token?: string }> {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(null)) } as State & { token?: string };
}
const save = (patch: Record<string, unknown>) => chrome.storage.local.set(patch);

async function publicState(): Promise<State> {
  const { token: _t, ...s } = await load();
  return s;
}

async function doContribute(screenWidth: number): Promise<{ ok: boolean; message: string; entry?: LogEntry; steps?: string[] }> {
  const s = await load();
  if (!s.consent) return { ok: false, message: "No consent given." };
  if (s.paused) return { ok: false, message: "Paused." };
  if (!s.joined || !s.token) return { ok: false, message: "Join a campaign first." };
  const S: Schema = await getSchema(s.base);
  const visits = await collectVisits(DAYS);
  const rows = buildRows(S, visits, screenWidth);
  const positives = rows.y.reduce((a, b) => a + b, 0);
  if (rows.n < MIN_ROWS || positives < MIN_POSITIVE) {
    return { ok: false, message: `Not enough activity in known categories yet (${rows.n} visits, ${positives} repeat visits; need ${MIN_ROWS} and ${MIN_POSITIVE}).` };
  }
  const steps: string[] = [];
  try {
    const res = await contribute({
      base: s.base, token: s.token, schema: S, X: rows.X, y: rows.y, ceilingPerUpload: s.ceiling, allowNonPrivate: false,
      uploadsSoFar: s.uploads, onStep: (i, st, d) => { if (st !== "run") steps.push(`${i}:${st}:${d}`); },
    });
    const entry: LogEntry = { t: Date.now(), n: rows.n, categories: rows.categories, bytes: res.proof.bytes, checksum: res.proof.checksum,
                              eps: res.epsCharged, version: res.reply.version, stepped: res.reply.model_stepped };
    await save({ uploads: s.uploads + 1, log: [entry, ...s.log].slice(0, 50) });
    return { ok: true, message: "Sent one noised update.", entry, steps };
  } catch (e) {
    return { ok: false, message: e instanceof Refused ? e.message : `Failed: ${String(e)}`, steps };
  }
}

/** Vertical FL: send ONE locally noised interest profile, keyed by the email the user also uses at the advertiser's shop. */
async function shareProfile(email: string): Promise<{ ok: boolean; message: string }> {
  const s = await load();
  if (!s.consent || s.paused || !s.joined || !s.token) return { ok: false, message: "Consent, join and un-pause first." };
  if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, message: "Enter the email you use at the shop." };
  const S = await getSchema(s.base);
  const pol = await (await fetch(s.base + "/v1/platform/policy")).json();
  const visits = await collectVisits(DAYS);
  if (visits.length < MIN_ROWS) return { ok: false, message: `Not enough activity in known categories yet (${visits.length} visits, need ${MIN_ROWS}).` };
  const profile = buildProfile(S, visits, pol.sigma, pol.clip);
  if (profile.length !== pol.dims) return { ok: false, message: "Profile layout does not match the server." };
  const r = await fetch(s.base + "/v1/platform/profile", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.token}` }, body: JSON.stringify({ email, profile }),
  });
  if (!r.ok) return { ok: false, message: `Server refused (${r.status}).` };
  const entry: LogEntry = { t: Date.now(), n: visits.length, categories: {}, bytes: JSON.stringify(profile).length, checksum: 0, eps: 0, version: -1, stepped: false,
                            kind: "profile", email };
  await save({ log: [entry, ...s.log].slice(0, 50), sharedEmail: email });
  return { ok: true, message: "Sent a noised interest profile (14 numbers) with your email, so the advertiser can match you without seeing it." };
}

// Some browsers (Firefox for Android) give an extension no visible toolbar popup. Open the same page as a tab once on install,
// so the consent screen is always reachable.
chrome.runtime.onInstalled.addListener((d) => {
  if (d.reason === "install") void chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    switch (msg.type) {
      case "state": return publicState();
      case "consent": await save({ consent: !!msg.value }); return publicState();
      case "pause": await save({ paused: !!msg.value }); return publicState();
      case "ceiling": await save({ ceiling: Math.max(1, Number(msg.value) || 150) }); return publicState();
      case "join": {
        const base = String(msg.base).replace(/\/+$/, "");
        const r = await register(base, String(msg.code), "extension");
        await save({ base, token: r.token, deviceId: r.device_id, joined: true, uploads: 0 });
        return publicState();
      }
      case "contribute": return doContribute(Number(msg.screenWidth) || 1280);
      case "profile": return shareProfile(String(msg.email).trim().toLowerCase());
      case "delete": {                       // wipes everything this extension stores; the server keeps only the aggregated model
        await chrome.storage.local.clear();
        return publicState();
      }
      default: return { error: "unknown message" };
    }
  })().then(reply, (e) => reply({ error: String(e?.message ?? e) }));
  return true;
});
