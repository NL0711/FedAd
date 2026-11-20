// Background worker: joins the campaign on its own, stores what the content script saw (a topic label per page and whether the person
// clicked), trains on this device, and sends a clipped, noised model update when there is enough activity. Only that update leaves this
// computer: never the events, pages, addresses or site names.
import { contribute, getSchema, register, Refused, type Schema } from "../../frontend/src/phone/client.ts";
import { buildRows, type Ev } from "./features.ts";

declare const FEDAD_BASE: string;                                   // set at build time (build.mjs)
const BASE = FEDAD_BASE.replace(/\/+$/, "");

export interface State { consent: boolean; joined: boolean; deviceId: number | null; uploads: number; views: number; taps: number; message: string }
interface Session { start: number; lastT: number; count: number }
interface PendingTap { id: number; t: number; destStartedAt?: number }
const DEFAULTS = { consent: false, joined: false, deviceId: null as number | null, uploads: 0, events: [] as Ev[], localModel: null as unknown,
                   message: "", sentEvents: 0, sentAt: 0, session: null as Session | null, lastDwell: 3, pendingTap: null as PendingTap | null };
const MAX_EVENTS = 2000, MIN_VIEWS = 20, MIN_TAPS = 2, MIN_NEW_EVENTS = 5, MIN_GAP_MS = 60_000, CEILING = 150;
const SESSION_GAP_MS = 30 * 60_000;                                 // 30 minutes without a link counts as a new session
// A clicked link is weighted 1 + the seconds the person stayed on the page it led to / DWELL_SECONDS_PER_UNIT (at most DWELL_MAX_EXTRA more), the
// way YouTube weights positive examples by watch time. Unclicked links stay at 1. This makes the model's score an engagement-weighted click score,
// not a plain click probability; set DWELL_WEIGHT to false to train on plain clicks.
const DWELL_WEIGHT = true, DWELL_SECONDS_PER_UNIT = 20, DWELL_MAX_EXTRA = 3;

type Stored = typeof DEFAULTS & { token?: string };
async function load(): Promise<Stored> { return { ...DEFAULTS, ...(await chrome.storage.local.get(null)) } as Stored; }
const save = (patch: Record<string, unknown>) => chrome.storage.local.set(patch);

// Events arrive from many pages at once; serialise read-modify-write so none are lost.
let chain: Promise<unknown> = Promise.resolve();
const queue = <T>(fn: () => Promise<T>): Promise<T> => (chain = chain.then(fn, fn)) as Promise<T>;

async function publicState(): Promise<State> {
  const { token: _t, events, sentEvents: _a, sentAt: _b, localModel: _c, session: _d, lastDwell: _e, pendingTap: _f, ...s } = await load();
  return { ...s, views: events.length, taps: events.filter((e) => e.y === 1).length };
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

// ---- recording ------------------------------------------------------------------------------------------------------------
async function addEvent(ev: Ev) {
  const s = await load();
  if (!s.consent) return;
  if (!s.joined) await ensureJoined().catch(() => {});
  // The numbers that depend on the whole session are computed here, where every page's links are visible. They only use earlier rows, never
  // this row's own label.
  const now = ev.t;
  let ss: Session = s.session && now - s.session.lastT <= SESSION_GAP_MS ? s.session : { start: now, lastT: now, count: 0 };
  ev.raw.position = ss.count;
  ev.raw.session_min = (now - ss.start) / 60_000;
  ss = { ...ss, lastT: now, count: ss.count + 1 };
  const lastTap = [...s.events].reverse().find((e) => e.y === 1);
  ev.raw.recency_min = lastTap ? Math.min(60, (now - lastTap.t) / 60_000) : 60;
  ev.raw.taps_24h = s.events.filter((e) => e.y === 1 && now - e.t < 864e5).length;
  ev.raw.prev_dwell_s = s.lastDwell;
  await save({ events: [...s.events, ev].slice(-MAX_EVENTS), session: ss, ...(ev.y === 1 ? { pendingTap: { id: ev.id, t: now } } : {}) });
  void maybeContribute();
}
async function markTap(id: number) {
  const s = await load();
  if (!s.consent) return;
  await save({ events: s.events.map((e) => (e.id === id ? { ...e, y: 1 } : e)), pendingTap: { id, t: Date.now() } });
  void maybeContribute();
}
/** The content script reports how long a page held the person. The page a click led to sets that click's weight. */
async function dwell(seconds: number, startedAt: number) {
  const s = await load();
  if (!s.consent) return;
  const patch: Record<string, unknown> = { lastDwell: Math.min(seconds, 300) };
  const p = s.pendingTap;
  if (DWELL_WEIGHT && p) {
    const sameDest = p.destStartedAt === startedAt;
    const isDest = p.destStartedAt === undefined && startedAt >= p.t - 1500 && startedAt - p.t < 120_000;   // the next page that opened after the click
    if (sameDest || isDest) {
      const w = 1 + Math.min(DWELL_MAX_EXTRA, Math.min(seconds, 120) / DWELL_SECONDS_PER_UNIT);
      patch.events = s.events.map((e) => (e.id === p.id ? { ...e, w } : e));
      patch.pendingTap = { ...p, destStartedAt: startedAt };
    } else if (p.destStartedAt !== undefined || startedAt - p.t >= 120_000) patch.pendingTap = null;        // a later page, or too long ago
  }
  await save(patch);
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
    const { X, y, w } = buildRows(S, s.events);
    const res = await contribute({
      base: BASE, token: s.token, schema: S, X, y, weights: DWELL_WEIGHT ? w : undefined, ceilingPerUpload: CEILING, allowNonPrivate: false, uploadsSoFar: s.uploads, onStep: () => {},
    });
    // The local model lives in this browser's extension storage (DevTools > Application > Extension storage > Local > localModel):
    // the server model this device started from plus what it learned here. Only the clipped, noised update was sent.
    const localModel = { t: Date.now(), basedOnServerVersion: res.model.version, labels: [...S.feature_names, "bias"], local: res.proof.wLocal, serverBefore: res.proof.wGlobal };
    await save({ uploads: s.uploads + 1, sentEvents: s.events.length, localModel, message: "" });
  } catch (e) {
    if (e instanceof Refused && /Unknown device/.test(e.message)) {
      await join().catch(() => {});                                   // the campaign was reset or replaced: join the new one, then send on the next round
      return;
    }
    await save({ message: e instanceof Refused ? e.message : `Could not send an update: ${String(e)}` });
  } finally { sending = false; }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    switch (msg.type) {
      case "state": return publicState();
      case "event": await queue(() => addEvent(msg.ev as Ev)); return { ok: true };
      case "tap": await queue(() => markTap(Number(msg.id))); return { ok: true };
      case "dwell": await queue(() => dwell(Number(msg.seconds), Number(msg.startedAt))); return { ok: true };
      case "consent":
        await save({ consent: !!msg.value });
        if (msg.value) await ensureJoined().catch(() => {});
        return publicState();
      case "retry": await join().catch(() => {}); return publicState();
      case "delete":                         // wipes everything this extension stores; the server keeps only the shared model
        await queue(() => chrome.storage.local.clear());
        return publicState();
      default: return { error: "unknown message" };
    }
  })().then(reply, (e) => reply({ error: String(e?.message ?? e) }));
  return true;
});
