// Background worker: stores the events the content script observed on the campaign's site and on sites the user allowed one by one,
// trains on them, and talks to the server. No browsing history is read; only the sites on the allow-list are ever observed, and
// only a clipped, noised model update (never the events, pages or host names) leaves this computer.
import { categoryRates, contribute, getModel, getSchema, register, Refused, type Schema } from "../../frontend/src/phone/client.ts";
import { buildProfile, buildRows, summarize, type Ev } from "./features.ts";

export interface LogEntry {
  t: number; n: number; categories: Record<string, number>; bytes: number; checksum: number; eps: number; version: number; stepped: boolean;
  kind?: "profile"; email?: string;
  /** Predicted click rate per category: this device's own model, the server model it started from, and the server model afterwards.
   *  Computed here from weights; the local column never leaves this computer. */
  models?: { name: string; local: number; before: number; after: number }[];
}
export interface State {
  consent: boolean; paused: boolean; base: string; joined: boolean; deviceId: number | null; uploads: number;
  ceiling: number; log: LogEntry[]; views: number; taps: number;
  /** Sites the user allowed one by one (origins), and this computer's own per-host counts. Nothing here is ever sent. */
  sites: string[]; siteStats: Record<string, { views: number; taps: number }>;
}
const DEFAULTS = { consent: false, paused: false, base: "", joined: false, deviceId: null, uploads: 0, ceiling: 150, log: [] as LogEntry[], events: [] as Ev[], sites: [] as string[], localModel: null as unknown };
const MAX_EVENTS = 2000;
const MIN_VIEWS = 20, MIN_TAPS = 2;
const SCRIPT_ID = "fedad-content";

type Stored = typeof DEFAULTS & { token?: string };
async function load(): Promise<Stored> { return { ...DEFAULTS, ...(await chrome.storage.local.get(null)) } as Stored; }
const save = (patch: Record<string, unknown>) => chrome.storage.local.set(patch);

async function publicState(): Promise<State> {
  const { token: _t, events, ...s } = await load();
  const siteStats: State["siteStats"] = {};
  for (const e of events) {
    const k = e.site ?? new URL(s.base || "http://shop").hostname;
    const r = (siteStats[k] ??= { views: 0, taps: 0 });
    r.views++; if (e.y === 1) r.taps++;
  }
  return { ...s, views: events.length, taps: events.filter((e) => e.y === 1).length, siteStats };
}

const siteScriptId = (origin: string) => "fedad-site-" + origin.replace(/[^a-z0-9]/gi, "_");
async function allowSite(origin: string) {
  const s = await load();
  if (!s.consent || !s.joined) throw new Error("Agree and join a campaign first.");
  if (!/^https?:\/\/[^/]+$/.test(origin)) throw new Error("Enter a site address such as https://example.com");
  if (!(await chrome.permissions.contains({ origins: [origin + "/*"] }))) throw new Error("The browser did not grant access to that site.");
  try { await chrome.scripting.unregisterContentScripts({ ids: [siteScriptId(origin)] }); } catch { /* none registered */ }
  await chrome.scripting.registerContentScripts([{ id: siteScriptId(origin), matches: [origin + "/*"], js: ["content.js"], runAt: "document_idle", persistAcrossSessions: true }]);
  if (!s.sites.includes(origin)) await save({ sites: [...s.sites, origin] });
}
/** Stop watching a site and forget everything recorded there. */
async function forgetSite(origin: string) {
  const s = await load();
  try { await chrome.scripting.unregisterContentScripts({ ids: [siteScriptId(origin)] }); } catch { /* none registered */ }
  const host = new URL(origin).hostname;
  await save({ sites: s.sites.filter((o) => o !== origin), events: s.events.filter((e) => e.site !== host) });
}

// Events arrive from many cards at once; serialise read-modify-write so none are lost.
let chain: Promise<unknown> = Promise.resolve();
const queue = <T>(fn: () => Promise<T>): Promise<T> => (chain = chain.then(fn, fn)) as Promise<T>;

async function addEvent(ev: Ev) {
  const s = await load();
  if (!s.consent || s.paused || !s.joined) return;               // nothing is recorded without consent, or while paused
  await save({ events: [...s.events, ev].slice(-MAX_EVENTS) });
}
async function markTap(id: number) {
  const s = await load();
  if (!s.consent || s.paused) return;
  await save({ events: s.events.map((e) => (e.id === id ? { ...e, y: 1 } : e)) });
}

async function registerContentScript(base: string) {
  const match = new URL(base).origin + "/*";
  try { await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }); } catch { /* none registered */ }
  await chrome.scripting.registerContentScripts([{ id: SCRIPT_ID, matches: [match], js: ["content.js"], runAt: "document_idle", persistAcrossSessions: true }]);
}

async function doContribute(): Promise<{ ok: boolean; message: string; entry?: LogEntry; steps?: string[] }> {
  const s = await load();
  if (!s.consent) return { ok: false, message: "No consent given." };
  if (s.paused) return { ok: false, message: "Paused." };
  if (!s.joined || !s.token) return { ok: false, message: "Join a campaign first." };
  const taps = s.events.filter((e) => e.y === 1).length;
  if (s.events.length < MIN_VIEWS || taps < MIN_TAPS) {
    return { ok: false, message: `Browse the shop first: ${s.events.length} of ${MIN_VIEWS} views seen, ${taps} of ${MIN_TAPS} taps.` };
  }
  const S: Schema = await getSchema(s.base);
  const { X, y } = buildRows(S, s.events);
  const steps: string[] = [];
  try {
    const res = await contribute({
      base: s.base, token: s.token, schema: S, X, y, ceilingPerUpload: s.ceiling, allowNonPrivate: false,
      uploadsSoFar: s.uploads, onStep: (i, st, d) => { if (st !== "run") steps.push(`${i}:${st}:${d}`); },
    });
    let models: LogEntry["models"];
    try {
      const fresh = await getModel(s.base);                      // the server model as it is now
      const local = categoryRates(S, res.proof.wLocal), before = categoryRates(S, res.proof.wGlobal), after = categoryRates(S, fresh.weights);
      models = local.map((x, i) => ({ name: x.name, local: x.ctr, before: before[i].ctr, after: after[i].ctr }));
    } catch { /* the comparison is optional */ }
    const entry: LogEntry = { t: Date.now(), n: s.events.length, categories: summarize(s.events), bytes: res.proof.bytes, checksum: res.proof.checksum,
                              eps: res.epsCharged, version: res.reply.version, stepped: res.reply.model_stepped, models };
    // The local model lives in this browser's extension storage (DevTools > Application > Extension storage > Local > localModel).
    // It is the server model this device started from plus what it learned here; only the clipped, noised update was sent.
    const labels = [...S.feature_names, "bias"];
    const localModel = { t: Date.now(), basedOnServerVersion: res.model.version, labels, local: res.proof.wLocal, serverBefore: res.proof.wGlobal };
    await save({ uploads: s.uploads + 1, log: [entry, ...s.log].slice(0, 50), localModel });
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
  if (s.events.length < MIN_VIEWS) return { ok: false, message: `Browse the shop first (${s.events.length} of ${MIN_VIEWS} views).` };
  const S = await getSchema(s.base);
  const pol = await (await fetch(s.base + "/v1/platform/policy")).json();
  const profile = buildProfile(S, s.events, pol.sigma, pol.clip);
  if (profile.length !== pol.dims) return { ok: false, message: "Profile layout does not match the server." };
  const r = await fetch(s.base + "/v1/platform/profile", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.token}` }, body: JSON.stringify({ email, profile }),
  });
  if (!r.ok) return { ok: false, message: `Server refused (${r.status}).` };
  const entry: LogEntry = { t: Date.now(), n: s.events.length, categories: {}, bytes: JSON.stringify(profile).length, checksum: 0, eps: 0, version: -1,
                            stepped: false, kind: "profile", email };
  await save({ log: [entry, ...s.log].slice(0, 50) });
  return { ok: true, message: "Sent a noised interest profile (14 numbers) with your email, so the advertiser can match you without seeing it." };
}

// Some browsers (Firefox for Android) show no toolbar popup for an extension. Open the same page as a tab once on install.
chrome.runtime.onInstalled.addListener((d) => {
  if (d.reason === "install") void chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    switch (msg.type) {
      case "state": return publicState();
      case "event": await queue(() => addEvent(msg.ev as Ev)); return { ok: true };
      case "tap": await queue(() => markTap(Number(msg.id))); return { ok: true };
      case "consent": await save({ consent: !!msg.value }); return publicState();
      case "pause": await save({ paused: !!msg.value }); return publicState();
      case "ceiling": await save({ ceiling: Math.max(1, Number(msg.value) || 150) }); return publicState();
      case "join": {
        const base = String(msg.base).replace(/\/+$/, "");
        const r = await register(base, "", "extension");
        await save({ base, token: r.token, deviceId: r.device_id, joined: true, uploads: 0, events: [] });
        await registerContentScript(base);
        return publicState();
      }
      case "allowSite": await queue(() => allowSite(String(msg.origin))); return publicState();
      case "forgetSite": await queue(() => forgetSite(String(msg.origin))); return publicState();
      case "contribute": return doContribute();
      case "profile": return shareProfile(String(msg.email).trim().toLowerCase());
      case "delete": {                       // wipes everything this extension stores and stops observing; the server keeps only the model
        try { await chrome.scripting.unregisterContentScripts(); } catch { /* none registered */ }   // the campaign site and every allowed site
        await queue(() => chrome.storage.local.clear());
        return publicState();
      }
      default: return { error: "unknown message" };
    }
  })().then(reply, (e) => reply({ error: String(e?.message ?? e) }));
  return true;
});
