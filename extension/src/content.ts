// Content script, injected only on the campaign server's own pages (the demo shop). It watches product cards the site tags with
// data-fedad-cat / data-fedad-placement: a card counts as VIEWED when 60% is visible for 400 ms, and as TAPPED when clicked.
// Each event is turned into the phone-schema features here and handed to the background worker; nothing leaves the browser.
import type { Ev } from "./features.ts";

const MIN_VISIBLE = 0.6, DWELL_MS = 400;
const t0 = Date.now();
let position = 0, lastDwell = 3, lastTap = 0;
const tapTimes: number[] = [];
let scroll = { y: window.scrollY, t: performance.now(), speed: 0 };
window.addEventListener("scroll", () => {
  const now = performance.now(), y = window.scrollY, dt = Math.max(now - scroll.t, 16);
  scroll = { y, t: now, speed: scroll.speed * 0.6 + ((Math.abs(y - scroll.y) / dt) * 1000) * 0.4 };
}, { passive: true });

const deviceIndex = () => {
  const ua = navigator.userAgent;
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) return 1;
  if (/Mobi|iPhone|Android/i.test(ua)) return 0;
  return 2;
};
const netQuality = () =>
  ({ "slow-2g": 0, "2g": 1, "3g": 2, "4g": 3 } as Record<string, number>)[(navigator as any).connection?.effectiveType ?? ""] ?? 2;

interface Track { first: number; timer?: number; ev?: Ev; shownAt?: number }
const tracks = new WeakMap<Element, Track>();

function record(cat: string, placement: string, visibleMs: number): Ev {
  const now = new Date();
  const ev: Ev = {
    id: Date.now() * 1000 + Math.floor(Math.random() * 1000), t: Date.now(), cat, placement, hour: Math.floor(now.getHours() / 4), dev: deviceIndex(), y: 0,
    raw: {
      recency_min: lastTap ? Math.min(60, (Date.now() - lastTap) / 60000) : 60,
      taps_24h: tapTimes.filter((t) => Date.now() - t < 864e5).length,
      prev_dwell_s: lastDwell,
      scroll_speed: performance.now() - scroll.t > 300 ? 0 : scroll.speed,
      position, session_min: (Date.now() - t0) / 60000, weekday: (now.getDay() + 6) % 7,
      screen_w: window.innerWidth, net_quality: netQuality(), visible_ms: visibleMs,
    },
  };
  position++;
  void chrome.runtime.sendMessage({ type: "event", ev });
  return ev;
}

const io = new IntersectionObserver((list) => {
  for (const en of list) {
    const el = en.target as HTMLElement, t = tracks.get(el);
    if (!t) continue;
    if (en.intersectionRatio > 0 && !t.first) t.first = performance.now();
    if (en.intersectionRatio >= MIN_VISIBLE && !t.ev && t.timer === undefined) {
      t.timer = window.setTimeout(() => {
        t.timer = undefined;
        if (document.visibilityState !== "visible" || t.ev) return;
        t.ev = record(el.dataset.fedadCat!, el.dataset.fedadPlacement ?? "feed-middle", performance.now() - t.first);
        t.shownAt = performance.now();
      }, DWELL_MS);
    } else if (en.intersectionRatio < MIN_VISIBLE) {
      if (t.timer !== undefined) { clearTimeout(t.timer); t.timer = undefined; }
      if (t.shownAt) { lastDwell = (performance.now() - t.shownAt) / 1000; t.shownAt = undefined; }
    }
  }
}, { threshold: [0, MIN_VISIBLE] });

function attach(el: HTMLElement) {
  if (tracks.has(el) || !el.dataset.fedadCat) return;
  const t: Track = { first: 0 };
  tracks.set(el, t);
  io.observe(el);
  el.addEventListener("click", () => {
    const ev = t.ev ?? (t.ev = record(el.dataset.fedadCat!, el.dataset.fedadPlacement ?? "feed-middle", 400));
    lastTap = Date.now(); tapTimes.push(lastTap);
    void chrome.runtime.sendMessage({ type: "tap", id: ev.id });
  });
}

const scan = (root: ParentNode) => root.querySelectorAll<HTMLElement>("[data-fedad-cat]").forEach(attach);
scan(document);
new MutationObserver((muts) => {
  for (const m of muts) m.addedNodes.forEach((n) => { if (n instanceof HTMLElement) { if (n.dataset.fedadCat) attach(n); scan(n); } });
}).observe(document.documentElement, { childList: true, subtree: true });
