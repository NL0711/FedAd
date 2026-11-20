// Content script, run on every page. A page counts as ONE view once it has been open and visible for DWELL_MS and its topic could be
// guessed on this device (classify.ts). A click on anything clickable counts as the tap for that view, even before the dwell time is up
// (the page is classified at that moment). Each event is turned into the phone-schema features here and handed to the background worker;
// nothing leaves the browser. Pages with a password or card field are skipped entirely, and nothing about the page (text, address, site
// name) is kept: only the topic label, the hour, the device type and a few timing numbers.
import type { Ev } from "./features.ts";
import { classifyPage } from "./classify.ts";

const DWELL_MS = 2500;
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

const sensitive = () => !!document.querySelector('input[type="password"], input[autocomplete^="cc-"], input[name*="card" i]');

// `visible_ms` is the same constant for every row. It used to be the real time on the page, which differed between rows created by the dwell
// timer (>= DWELL_MS, mostly untapped) and rows created by an early click (< DWELL_MS, always tapped): the model could read the label from it.
function record(cat: string, tapped: boolean): Ev {
  const now = new Date();
  const ev: Ev = {
    id: Date.now() * 1000 + Math.floor(Math.random() * 1000), t: Date.now(), cat, placement: "feed-middle", hour: Math.floor(now.getHours() / 4),
    dev: deviceIndex(), y: tapped ? 1 : 0,
    raw: {
      recency_min: lastTap ? Math.min(60, (Date.now() - lastTap) / 60000) : 60,
      taps_24h: tapTimes.filter((t) => Date.now() - t < 864e5).length,
      prev_dwell_s: lastDwell,
      scroll_speed: performance.now() - scroll.t > 300 ? 0 : scroll.speed,
      position, session_min: (Date.now() - t0) / 60000, weekday: (now.getDay() + 6) % 7,
      screen_w: window.innerWidth, net_quality: netQuality(), visible_ms: DWELL_MS,
    },
  };
  position++;
  if (tapped) { lastTap = Date.now(); tapTimes.push(lastTap); }
  void chrome.runtime.sendMessage({ type: "event", ev });
  return ev;
}

// ---- one view per page ------------------------------------------------------------------------------------------------------
// Single-page apps change the path without a reload, so the path is watched and each new path is a new page.
let pageKey = "", pageTimer: number | undefined, pageEv: Ev | undefined;

function startPage() {
  pageKey = location.pathname + location.search;
  pageEv = undefined;
  if (pageTimer !== undefined) clearTimeout(pageTimer);
  pageTimer = window.setTimeout(viewNow, DWELL_MS);
}
function viewNow() {
  pageTimer = undefined;
  if (pageEv) return;
  if (document.visibilityState !== "visible") { pageTimer = window.setTimeout(viewNow, 1000); return; }   // count it once the tab is in front
  if (sensitive()) return;
  const cat = classifyPage();
  if (cat) pageEv = record(cat, false);
}

// ---- taps --------------------------------------------------------------------------------------------------------------------
const CLICKABLE = 'a[href], button, [role="button"], [role="link"], [role="tab"], [role="menuitem"], input[type="submit"], input[type="button"], summary, [onclick]';
function clickable(e: Event): boolean {
  for (const n of e.composedPath().slice(0, 8)) {                      // composedPath also crosses shadow DOM
    if (!(n instanceof Element)) continue;
    if (n.matches(CLICKABLE) || getComputedStyle(n).cursor === "pointer") return true;
  }
  return false;
}
function onClick(e: Event) {
  if (!e.isTrusted || !clickable(e)) return;                           // a real user click on something clickable
  if (pageEv) {
    if (pageEv.y === 1) return;                                        // one tap per page view
    pageEv.y = 1; lastTap = Date.now(); tapTimes.push(lastTap);
    void chrome.runtime.sendMessage({ type: "tap", id: pageEv.id });
    return;
  }
  if (sensitive()) return;
  const cat = classifyPage();                                          // clicked before the dwell time: count the view and the tap now
  if (!cat) return;
  if (pageTimer !== undefined) { clearTimeout(pageTimer); pageTimer = undefined; }
  pageEv = record(cat, true);
}
document.addEventListener("click", onClick, true);
document.addEventListener("auxclick", onClick, true);                  // middle click opens the link in a new tab

setInterval(() => { if (location.pathname + location.search !== pageKey) startPage(); }, 1000);
startPage();
