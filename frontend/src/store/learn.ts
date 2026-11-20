// Private learning inside the store page: no extension needed. With the visitor's consent the page keeps a LOCAL cache (this
// browser's localStorage, capped at 2000 events) of which product cards were seen and tapped, trains the shared model on it while
// the visitor is on the site, and sends only a clipped, noised update when they press Contribute. The optional advertiser-matching
// profile is built and noised here too. Reuses the phone client (src/phone) for the protocol.
import { ApiError, Refused, contribute, getSchema, register } from "../phone/client.ts";
import type { Schema } from "../phone/client.ts";

export interface Ev { id: number; t: number; cat: string; placement: string; hour: number; dev: number; raw: Record<string, number>; y: number }

export const MIN_VIEWS = 20, MIN_TAPS = 2, MAX_EVENTS = 2000;
const K = { consent: "perks.learn.consent", events: "perks.learn.events", fl: "perks.learn.fl", uploads: "perks.learn.uploads", ceiling: "perks.learn.ceiling", code: "perks.learn.code", seq: "perks.learn.seq" };
const ls = localStorage;
const num = (k: string, d: number) => { const v = ls.getItem(k); return v !== null && Number.isFinite(Number(v)) ? Number(v) : d; };

let events: Ev[] = JSON.parse(ls.getItem(K.events) ?? "[]");
const save = () => { if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS); ls.setItem(K.events, JSON.stringify(events)); changed(); };
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());
export const onChange = (f: () => void) => { listeners.add(f); return () => listeners.delete(f); };

export type Consent = "yes" | "no" | null;
export const consent = (): Consent => (ls.getItem(K.consent) as Consent) ?? null;
export function setConsent(v: "yes" | "no") {
  ls.setItem(K.consent, v);
  if (v === "no") wipe();
  changed();
}
/** Delete everything this page stored for learning: events, device token, counters. The server keeps only the aggregated model. */
export function wipe() {
  for (const k of [K.events, K.fl, K.uploads, K.seq]) ls.removeItem(k);
  events = [];
  changed();
}
export const stats = () => ({ views: events.length, taps: events.filter((e) => e.y === 1).length, joined: !!ls.getItem(K.fl), uploads: num(K.uploads, 0) });
export const ready = () => { const s = stats(); return s.views >= MIN_VIEWS && s.taps >= MIN_TAPS; };
export const ceiling = () => num(K.ceiling, 150);
export const setCeiling = (v: number) => ls.setItem(K.ceiling, String(Math.max(1, v || 150)));
export const savedCode = () => ls.getItem(K.code) ?? "";

// ---- recording ------------------------------------------------------------------------------------------------------------
const t0 = Date.now();
let position = 0, lastDwell = 3, lastTap = 0;
const tapTimes = () => events.filter((e) => e.y === 1).map((e) => e.t);
let scroll = { y: window.scrollY, t: performance.now(), speed: 0 };
window.addEventListener("scroll", () => {
  const now = performance.now(), y = window.scrollY, dt = Math.max(now - scroll.t, 16);
  scroll = { y, t: now, speed: scroll.speed * 0.6 + ((Math.abs(y - scroll.y) / dt) * 1000) * 0.4 };
}, { passive: true });

const deviceIndex = () => /iPad|Tablet|Android(?!.*Mobile)/i.test(navigator.userAgent) ? 1 : /Mobi|iPhone|Android/i.test(navigator.userAgent) ? 0 : 2;
const netQuality = () => ({ "slow-2g": 0, "2g": 1, "3g": 2, "4g": 3 } as Record<string, number>)[(navigator as any).connection?.effectiveType ?? ""] ?? 2;

function record(cat: string, placement: string, visibleMs: number): Ev | null {
  if (consent() !== "yes") return null;                       // nothing is cached without consent
  const now = new Date();
  const ev: Ev = {
    id: num(K.seq, 1), t: Date.now(), cat, placement, hour: Math.floor(now.getHours() / 4), dev: deviceIndex(), y: 0,
    raw: {
      recency_min: lastTap ? Math.min(60, (Date.now() - lastTap) / 60000) : 60,
      taps_24h: tapTimes().filter((t) => Date.now() - t < 864e5).length,
      prev_dwell_s: lastDwell,
      scroll_speed: performance.now() - scroll.t > 300 ? 0 : scroll.speed,
      position, session_min: (Date.now() - t0) / 60000, weekday: (now.getDay() + 6) % 7,
      screen_w: window.innerWidth, net_quality: netQuality(), visible_ms: visibleMs,
    },
  };
  ls.setItem(K.seq, String(ev.id + 1));
  position++;
  events.push(ev);
  save();
  return ev;
}

interface Track { first: number; timer?: number; ev?: Ev | null; shownAt?: number }
const tracks = new WeakMap<Element, Track>();
const io = new IntersectionObserver((list) => {
  for (const en of list) {
    const el = en.target as HTMLElement, t = tracks.get(el);
    if (!t) continue;
    if (en.intersectionRatio > 0 && !t.first) t.first = performance.now();
    if (en.intersectionRatio >= 0.6 && !t.ev && t.timer === undefined) {
      t.timer = window.setTimeout(() => {
        t.timer = undefined;
        if (document.visibilityState !== "visible" || t.ev) return;
        t.ev = record(el.dataset.fedadCat!, el.dataset.fedadPlacement ?? "feed-middle", performance.now() - t.first);
        if (t.ev) t.shownAt = performance.now();
      }, 400);
    } else if (en.intersectionRatio < 0.6) {
      if (t.timer !== undefined) { clearTimeout(t.timer); t.timer = undefined; }
      if (t.shownAt) { lastDwell = (performance.now() - t.shownAt) / 1000; t.shownAt = undefined; }
    }
  }
}, { threshold: [0, 0.6] });

/** Call for every product card (elements carrying data-fedad-cat). Views count at 60% visible for 400 ms; a click is a tap. */
export function watchCard(el: HTMLElement) {
  const t: Track = { first: 0 };
  tracks.set(el, t);
  io.observe(el);
  el.addEventListener("click", () => {
    if (consent() !== "yes") return;
    const ev = t.ev ?? (t.ev = record(el.dataset.fedadCat!, el.dataset.fedadPlacement ?? "feed-middle", 400));
    if (ev && ev.y === 0) { ev.y = 1; lastTap = Date.now(); save(); }
  });
}

// ---- training and sending -------------------------------------------------------------------------------------------------
function encodeRow(S: Schema, e: Ev): number[] {
  const row = new Array<number>(S.n_features).fill(0);
  const hot = (group: string, value: string | number) => {
    const g = S.groups.find((x) => x.name === group)!;
    const i = typeof value === "number" ? value : g.values.indexOf(value);
    if (i >= 0) row[g.offset + i] = 1;
  };
  hot("device", e.dev); hot("hour_bucket", e.hour); hot("ad_category", e.cat); hot("placement", e.placement);
  S.numeric.forEach((d, j) => {
    row[S.numeric_offset + j] = Math.max(-S.numeric_clamp, Math.min(S.numeric_clamp, ((e.raw[d.name] ?? d.center) - d.center) / d.scale));
  });
  return row;
}

export async function join(code: string): Promise<void> {
  try {
    const r = await register("", code.trim(), "store visitor");
    ls.setItem(K.fl, JSON.stringify({ token: r.token, id: r.device_id }));
    ls.setItem(K.code, code.trim());
    ls.setItem(K.uploads, "0");
    changed();
  } catch (e) {
    throw new Error(e instanceof ApiError && e.status === 403 ? "That join code is wrong." : "Could not reach the server.");
  }
}

export async function contributeNow(): Promise<string> {
  const dev = JSON.parse(ls.getItem(K.fl) ?? "null") as { token: string } | null;
  if (consent() !== "yes") throw new Error("Learning is off.");
  if (!dev) throw new Error("Join with the campaign code first.");
  if (!ready()) throw new Error(`Browse a little more: ${MIN_VIEWS} views and ${MIN_TAPS} taps needed.`);
  const S = await getSchema("");
  const X = new Float64Array(events.length * S.n_features);
  events.forEach((e, i) => X.set(encodeRow(S, e), i * S.n_features));
  const y = Float64Array.from(events.map((e) => e.y));
  try {
    const r = await contribute({ base: "", token: dev.token, schema: S, X, y, ceilingPerUpload: ceiling(), allowNonPrivate: false, uploadsSoFar: num(K.uploads, 0), onStep: () => {} });
    ls.setItem(K.uploads, String(num(K.uploads, 0) + 1));
    changed();
    return `Sent one noised update (${r.proof.bytes} bytes, model v${r.reply.version}). Nothing you viewed was sent.`;
  } catch (e) {
    if (e instanceof Refused) throw new Error(e.message);
    if (e instanceof ApiError && e.status === 401) { ls.removeItem(K.fl); changed(); throw new Error("The campaign was reset. Join again."); }
    throw e;
  }
}

function gaussian(): number {
  const r = new Uint32Array(2);
  crypto.getRandomValues(r);
  return Math.sqrt(-2 * Math.log((r[0] + 1) / 4294967297)) * Math.cos((2 * Math.PI * (r[1] + 1)) / 4294967297);
}

/** Vertical FL: ONE interest profile (8 category shares + 6 hour shares), clipped and noised here, sent with the shop email. */
export async function shareProfile(email: string): Promise<string> {
  const dev = JSON.parse(ls.getItem(K.fl) ?? "null") as { token: string } | null;
  if (consent() !== "yes" || !dev) throw new Error("Turn learning on and join first.");
  if (events.length < MIN_VIEWS) throw new Error(`Browse a little more: ${MIN_VIEWS} views needed.`);
  const S = await getSchema("");
  const pol = await (await fetch("/v1/platform/policy")).json();
  const cats = S.groups.find((g) => g.name === "ad_category")!.values;
  const nHours = S.groups.find((g) => g.name === "hour_bucket")!.values.length;
  const c = new Array(cats.length).fill(0), h = new Array(nHours).fill(0);
  for (const e of events) { const w = e.y ? 2 : 1; const i = cats.indexOf(e.cat); if (i >= 0) c[i] += w; h[Math.min(nHours - 1, e.hour)] += w; }
  const sum = (a: number[]) => a.reduce((s, x) => s + x, 0) || 1;
  const x = [...c.map((q) => q / sum(c)), ...h.map((q) => q / sum(h))];
  const scale = Math.min(1, pol.clip / (Math.sqrt(x.reduce((s, q) => s + q * q, 0)) || 1));
  const profile = x.map((q) => q * scale + pol.sigma * gaussian());
  if (profile.length !== pol.dims) throw new Error("Profile layout does not match the server.");
  const r = await fetch("/v1/platform/profile", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${dev.token}` }, body: JSON.stringify({ email, profile }) });
  if (!r.ok) throw new Error(`Server refused (${r.status}).`);
  return "Sent a noised interest profile (14 numbers) with your shop email. The advertiser only ever sees group results.";
}
