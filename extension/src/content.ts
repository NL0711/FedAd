// Content script, run on every page. The unit is one LINK THE PERSON SAW, like an ad impression: a link counts as seen once at least half of it
// has been on screen for LINK_DWELL_MS, and as clicked if the person then clicks it (y = 1), otherwise y = 0. Each seen link gets a topic from
// its own words (text, label, title, address words), falling back to the page's topic, and a placement from where it sits on the page. At most
// MAX_LINKS links are counted per page. A click on a link that was not counted yet is counted at that moment. A click on something clickable that
// is not a link counts once per page, with the page's topic. How long the person stays on the page a click leads to is reported to the
// background worker, which uses it to weight that click. Nothing leaves the browser from here: the words, addresses and site names are used on
// this device to pick a topic and are never stored. Pages with a password or card field are skipped.
import type { Ev } from "./features.ts";
import { classifyLink, classifyPage } from "./classify.ts";

const LINK_DWELL_MS = 700, LINK_VISIBLE = 0.5, MAX_LINKS = 12, MAX_WATCHED = 80, WATCH_EVERY_MS = 3000;

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

// ---- per-page state -------------------------------------------------------------------------------------------------------------
let pageKey = "", pageCat: string | null = null, pageCatTries = 0, nonLinkTapped = false;
let tracked = new Map<Element, Ev>(), watched = new WeakSet<Element>(), counted = 0, observed = 0;
let timers = new Map<Element, number>();
let io: IntersectionObserver | undefined, watchTimer: number | undefined;

/** The page's topic, tried a few times because some pages fill in their title and headings late. */
function pageTopic(): string | null {
  if (pageCat === null && pageCatTries < 4) { pageCatTries++; pageCat = classifyPage(); }
  return pageCat;
}

/** Where a link sits: in the header, menu or side column, or in the top, middle or bottom third of the page. */
function placementOf(el: Element): string {
  if (el.closest("header, nav, aside, footer, [role=navigation], [role=banner]")) return "banner";
  const r = el.getBoundingClientRect();
  const h = Math.max(document.documentElement.scrollHeight, 1);
  const f = (r.top + window.scrollY) / h;
  return f < 1 / 3 ? "feed-top" : f < 2 / 3 ? "feed-middle" : "feed-bottom";
}

function linkWords(a: HTMLAnchorElement): string {
  return `${a.innerText || a.textContent || ""} ${a.getAttribute("aria-label") ?? ""} ${a.title ?? ""}`.slice(0, 300);
}

function record(cat: string, placement: string, tapped: boolean): Ev {
  const now = new Date();
  // recency_min, taps_24h, prev_dwell_s, position and session_min are filled in by the background worker, which sees every page of the
  // session. This page only knows its own.
  const ev: Ev = {
    id: Date.now() * 1000 + Math.floor(Math.random() * 1000), t: Date.now(), cat, placement, hour: Math.floor(now.getHours() / 4), dev: deviceIndex(),
    y: tapped ? 1 : 0,
    raw: { scroll_speed: performance.now() - scroll.t > 300 ? 0 : scroll.speed, weekday: (now.getDay() + 6) % 7, screen_w: window.innerWidth,
           net_quality: netQuality(), visible_ms: LINK_DWELL_MS },
  };
  void chrome.runtime.sendMessage({ type: "event", ev });
  return ev;
}

// ---- seeing links -------------------------------------------------------------------------------------------------------------------
function ensureObserver() {
  if (io) return;
  io = new IntersectionObserver((list) => {
    for (const en of list) {
      const el = en.target;
      const t = timers.get(el);
      if (en.intersectionRatio >= LINK_VISIBLE && t === undefined && !tracked.has(el) && counted < MAX_LINKS) {
        timers.set(el, window.setTimeout(() => {
          timers.delete(el);
          if (document.visibilityState !== "visible" || tracked.has(el) || counted >= MAX_LINKS || sensitive()) return;
          const a = el as HTMLAnchorElement;
          const cat = classifyLink(linkWords(a), a.href) ?? pageTopic();
          if (!cat) return;
          tracked.set(el, record(cat, placementOf(el), false));
          counted++;
        }, LINK_DWELL_MS));
      } else if (en.intersectionRatio < LINK_VISIBLE && t !== undefined) {
        clearTimeout(t);
        timers.delete(el);
      }
    }
  }, { threshold: [0, LINK_VISIBLE] });
}

/** Pick links to watch: up to MAX_WATCHED per page, spread through the page, only real destinations with some words. */
function watchLinks() {
  if (observed >= MAX_WATCHED || sensitive()) return;
  ensureObserver();
  const all = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).filter((a) => {
    if (watched.has(a)) return false;
    const h = a.getAttribute("href") ?? "";
    if (!h || h.startsWith("#") || /^(javascript|mailto|tel):/i.test(h)) return false;
    return linkWords(a).trim().length >= 3;
  });
  const room = MAX_WATCHED - observed;
  const step = Math.max(1, Math.ceil(all.length / room));
  for (let i = 0; i < all.length && observed < MAX_WATCHED; i += step) {
    watched.add(all[i]);
    io!.observe(all[i]);
    observed++;
  }
}

// ---- clicks ---------------------------------------------------------------------------------------------------------------------------
const CLICKABLE = 'a[href], button, [role="button"], [role="link"], [role="tab"], [role="menuitem"], input[type="submit"], input[type="button"], summary, [onclick]';
function clickableIn(path: EventTarget[]): Element | null {
  for (const n of path.slice(0, 8)) {                                   // composedPath also crosses shadow DOM
    if (!(n instanceof Element)) continue;
    if (n.matches(CLICKABLE) || getComputedStyle(n).cursor === "pointer") return n;
  }
  return null;
}
function onClick(e: Event) {
  if (!e.isTrusted || sensitive()) return;                               // a real user click only
  const path = e.composedPath();
  const link = path.slice(0, 8).find((n): n is HTMLAnchorElement => n instanceof HTMLAnchorElement && n.hasAttribute("href"));
  if (link) {
    const seen = tracked.get(link);
    if (seen) {
      if (seen.y === 0) { seen.y = 1; void chrome.runtime.sendMessage({ type: "tap", id: seen.id }); }
      return;
    }
    const cat = classifyLink(linkWords(link), link.href) ?? pageTopic();   // clicked before it was counted as seen: count it now, as a click
    if (cat) tracked.set(link, record(cat, placementOf(link), true));
    return;
  }
  const el = clickableIn(path);
  if (!el || nonLinkTapped) return;                                      // a button or other clickable thing: one click per page
  const cat = pageTopic();
  if (cat) { nonLinkTapped = true; record(cat, placementOf(el), true); }
}
document.addEventListener("click", onClick, true);
document.addEventListener("auxclick", onClick, true);                    // middle click opens the link in a new tab

// ---- time on the page, reported so the background worker can weight a click by how long the next page held the person -----------------
let pageStartedAt = Date.now(), visibleAcc = 0, visibleSince = document.visibilityState === "visible" ? Date.now() : 0;
function reportDwell() {
  const total = visibleAcc + (visibleSince ? Date.now() - visibleSince : 0);
  if (total >= 500 && !sensitive()) void chrome.runtime.sendMessage({ type: "dwell", seconds: Math.round(total) / 1000, startedAt: pageStartedAt });
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") { if (visibleSince) { visibleAcc += Date.now() - visibleSince; visibleSince = 0; } reportDwell(); }
  else visibleSince = Date.now();
});
window.addEventListener("pagehide", reportDwell);

// ---- pages ---------------------------------------------------------------------------------------------------------------------------
// Single-page apps change the path without a reload, so the path is watched and each new path is a new page.
function startPage() {
  if (pageKey) reportDwell();                                            // the page we are leaving
  pageKey = location.pathname + location.search;
  pageCat = null; pageCatTries = 0; nonLinkTapped = false; counted = 0; observed = 0;
  for (const t of timers.values()) clearTimeout(t);
  timers = new Map(); tracked = new Map(); watched = new WeakSet();
  io?.disconnect(); io = undefined;
  pageStartedAt = Date.now(); visibleAcc = 0; visibleSince = document.visibilityState === "visible" ? Date.now() : 0;
  if (watchTimer !== undefined) clearInterval(watchTimer);
  watchTimer = window.setInterval(watchLinks, WATCH_EVERY_MS);          // also picks up links added later, such as infinite scroll
  window.setTimeout(watchLinks, 800);
}
setInterval(() => { if (location.pathname + location.search !== pageKey) startPage(); }, 1000);
startPage();
