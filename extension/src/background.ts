// Background worker: joins the campaign on its own, records what the content script sees on the sites the user allowed one by one,
// trains on this device, and sends a clipped, noised model update when there is enough activity. No browsing history is read; only
// allowed sites are observed, and only the noised update (never events, pages or host names) leaves this computer.
//
// Everything that must happen after a browser permission prompt runs HERE, driven by permissions.onAdded: the toolbar popup closes
// when the prompt opens, so code waiting in the popup would never run.
import { contribute, getSchema, register, Refused, type Schema } from "../../frontend/src/phone/client.ts";
import { buildRows, type Ev } from "./features.ts";

declare const FEDAD_BASE: string;                                   // set at build time (build.mjs)
const BASE = FEDAD_BASE.replace(/\/+$/, "");

export interface State {
  consent: boolean; joined: boolean; deviceId: number | null; uploads: number; views: number; taps: number; message: string;
  /** Sites the user allowed one by one (origins) and this computer's own per-host counts. Nothing here is ever sent. */
  sites: string[]; siteStats: Record<string, { views: number; taps: number }>;
}
const DEFAULTS = { consent: false, joined: false, deviceId: null as number | null, uploads: 0, events: [] as Ev[], sites: [] as string[],
                   localModel: null as unknown, message: "", sentEvents: 0, sentAt: 0 };
const MAX_EVENTS = 2000, MIN_VIEWS = 20, MIN_TAPS = 2, MIN_NEW_EVENTS = 5, MIN_GAP_MS = 60_000, CEILING = 150;

type Stored = typeof DEFAULTS & { token?: string };
async function load(): Promise<Stored> { return { ...DEFAULTS, ...(await chrome.storage.local.get(null)) } as Stored; }
const save = (patch: Record<string, unknown>) => chrome.storage.local.set(patch);

// Events arrive from many pages at once; serialise read-modify-write so none are lost.
let chain: Promise<unknown> = Promise.resolve();
const queue = <T>(fn: () => Promise<T>): Promise<T> => (chain = chain.then(fn, fn)) as Promise<T>;

async function publicState(): Promise<State> {
  const { token: _t, events, sentEvents: _a, sentAt: _b, localModel: _c, ...s } = await load();
  const siteStats: State["siteStats"] = {};
  for (const e of events) {
    const r = (siteStats[e.site ?? "?"] ??= { views: 0, taps: 0 });
    r.views++; if (e.y === 1) r.taps++;
  }
  return { ...s, views: events.length, taps: events.filter((e) => e.y === 1).length, siteStats };
}

// ---- joining: automatic, no code ------------------------------------------------------------------------------------------
async function join(): Promise<void> {
  try {
    const r = await register(BASE, "", "extension");
    await save({ token: r.token, deviceId: r.device_id, joined: true, uploads: 0, sentEvents: 0, message: "" });
  } catch (e) {
    await save({ message: `Could not reach ${BASE}. It may be waking up; try again in a minute.` });
    throw e;
  }
}
async function ensureJoined() { if (!(await load()).joined) await join(); }

// ---- allowed sites --------------------------------------------------------------------------------------------------------
const siteScriptId = (origin: string) => "fedad-site-" + origin.replace(/[^a-z0-9]/gi, "_");
const originOf = (pattern: string) => (/^https?:\/\/[^/*]+\/\*$/.test(pattern) ? pattern.slice(0, -2) : null);

async function allowSite(origin: string) {
  const s = await load();
  if (!s.consent || origin === BASE) return;
  if (!(await chrome.permissions.contains({ origins: [origin + "/*"] }))) return;
  try { await chrome.scripting.unregisterContentScripts({ ids: [siteScriptId(origin)] }); } catch { /* none registered */ }
  await chrome.scripting.registerContentScripts([{ id: siteScriptId(origin), matches: [origin + "/*"], js: ["content.js"], runAt: "document_idle", persistAcrossSessions: true }]);
  if (!s.sites.includes(origin)) await save({ sites: [...s.sites, origin] });
  try { await ensureJoined(); } catch { /* the popup shows the message */ }
  // Start watching tabs that are already open on this site, so no reload is needed.
  for (const t of await chrome.tabs.query({ url: origin + "/*" })) {
    if (t.id !== undefined) await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["content.js"] }).catch(() => {});
  }
}
/** Stop watching a site and forget everything recorded there. */
async function forgetSite(origin: string) {
  const s = await load();
  if (!s.sites.includes(origin)) return;
  try { await chrome.scripting.unregisterContentScripts({ ids: [siteScriptId(origin)] }); } catch { /* none registered */ }
  const host = new URL(origin).hostname;
  await save({ sites: s.sites.filter((o) => o !== origin), events: s.events.filter((e) => e.site !== host) });
}
chrome.permissions.onAdded.addListener((p) => {
  for (const o of (p.origins ?? []).map(originOf)) if (o) void queue(() => allowSite(o));
});
chrome.permissions.onRemoved.addListener((p) => {
  for (const o of (p.origins ?? []).map(originOf)) if (o) void queue(() => forgetSite(o));
});

// ---- recording ------------------------------------------------------------------------------------------------------------
async function addEvent(ev: Ev) {
  const s = await load();
  if (!s.consent || !s.joined) return;
  await save({ events: [...s.events, ev].slice(-MAX_EVENTS) });
  void maybeContribute();
}
async function markTap(id: number) {
  const s = await load();
  if (!s.consent) return;
  await save({ events: s.events.map((e) => (e.id === id ? { ...e, y: 1 } : e)) });
  void maybeContribute();
}

// ---- training and sending: automatic once there is enough activity -------------------------------------------------------
let sending = false;
async function maybeContribute() {
  if (sending) return;
  const s = await load();
  const taps = s.events.filter((e) => e.y === 1).length;
  if (!s.consent || !s.joined || !s.token) return;
  if (s.events.length < MIN_VIEWS || taps < MIN_TAPS) return;
  if (s.events.length - s.sentEvents < MIN_NEW_EVENTS || Date.now() - s.sentAt < MIN_GAP_MS) return;
  sending = true;
  try {
    await save({ sentAt: Date.now() });                               // also spaces out retries after a failure
    const S: Schema = await getSchema(BASE);
    const { X, y } = buildRows(S, s.events);
    const res = await contribute({
      base: BASE, token: s.token, schema: S, X, y, ceilingPerUpload: CEILING, allowNonPrivate: false, uploadsSoFar: s.uploads, onStep: () => {},
    });
    // The local model lives in this browser's extension storage (DevTools > Application > Extension storage > Local > localModel):
    // the server model this device started from plus what it learned here. Only the clipped, noised update was sent.
    const localModel = { t: Date.now(), basedOnServerVersion: res.model.version, labels: [...S.feature_names, "bias"], local: res.proof.wLocal, serverBefore: res.proof.wGlobal };
    await save({ uploads: s.uploads + 1, sentEvents: s.events.length, localModel, message: "" });
  } catch (e) {
    await save({ message: e instanceof Refused ? e.message : `Could not send an update: ${String(e)}` });
  } finally { sending = false; }
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
      case "consent":
        await save({ consent: !!msg.value });
        if (msg.value) await ensureJoined().catch(() => {});
        return publicState();
      case "retry": await join().catch(() => {}); return publicState();
      case "allowSite": await queue(() => allowSite(String(msg.origin))); return publicState();
      case "forgetSite": await queue(() => forgetSite(String(msg.origin))); return publicState();
      case "delete": {                       // wipes everything this extension stores and stops observing; the server keeps only the model
        try { await chrome.scripting.unregisterContentScripts(); } catch { /* none registered */ }
        await queue(() => chrome.storage.local.clear());
        return publicState();
      }
      default: return { error: "unknown message" };
    }
  })().then(reply, (e) => reply({ error: String(e?.message ?? e) }));
  return true;
});
