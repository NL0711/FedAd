// "perks": a demo voucher shop on the phone. Browsing is open; cart, orders and behaviour events need an account.
// Taps on products are recorded ON THE PHONE ONLY (they feed the on-device "For you" row and, if the user opts in, a noised
// model update). The inspector shows every request the page really sent, split by who it identifies.
import "./phone.css";
import { ApiError, STEPS, categoryRates, contribute, getSchema, getModel, readModel, register, Refused } from "./client.ts";
import type { Proof, Schema } from "./client.ts";
import { HttpError, api, chips, clearLog, entries, installSpy, onLog, shortPath } from "./net.ts";
import type { Entry } from "./net.ts";
import { epsAfter } from "./rdp.ts";

interface Product { id: string; title: string; kind: string; category: string; amounts: number[]; off: number; photo: string | null; bg: string; fg: string }
interface Ev { id: number; t: number; cat: string; placement: string; hour: number; dev: number; raw: Record<string, number>; y: number }
interface CartItem { product_id: string; amount: number; qty: number }
interface Session { token: string; email: string }

const MIN_VIEWS = 20;
const MIN_TAPS = 2;
const MAX_EVENTS = 2000;

// ---- storage (localStorage; stays on the device) ------------------------------------------------------------------------
const K = { session: "perks.session", fl: "perks.fl", events: "perks.events", uploads: "perks.uploads", ceiling: "perks.ceiling", seq: "perks.seq", code: "perks.code" };
const ls = {
  get: (k: string) => localStorage.getItem(k),
  set: (k: string, v: string) => localStorage.setItem(k, v),
  del: (k: string) => localStorage.removeItem(k),
  num: (k: string, d: number) => { const v = localStorage.getItem(k); return v !== null && Number.isFinite(Number(v)) ? Number(v) : d; },
};
let events: Ev[] = JSON.parse(ls.get(K.events) ?? "[]");
const saveEvents = () => { if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS); ls.set(K.events, JSON.stringify(events)); };
let session: Session | null = JSON.parse(ls.get(K.session) ?? "null");
const fl = (): { token: string; id: number } | null => JSON.parse(ls.get(K.fl) ?? "null");

// ---- tiny DOM helpers -----------------------------------------------------------------------------------------------------
type Child = Node | string | null | undefined | false;
function h(tag: string, props: Record<string, any> = {}, ...kids: Child[]): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v !== undefined) e.setAttribute(k, String(v));
  }
  for (const c of kids) if (c) e.append(c);
  return e;
}
const ICONS = {
  home: '<path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  cart: '<path d="M3 4h2l2.4 11h10.2l2-8H6.2"/><circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/>',
  bag: '<path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
};
function ico(name: keyof typeof ICONS, size = 22): HTMLElement {
  const s = document.createElement("span");
  s.style.display = "grid";
  s.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return s;
}
const inr = (n: number) => "₹" + n.toLocaleString("en-IN");
const sale = (n: number, off: number) => Math.round((n * (100 - off)) / 100);
const app = document.getElementById("app")!;

function toast(msg: string) {
  const t = h("div", { class: "toast" }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 1800);
}
function sheet(content: HTMLElement, onClose?: () => void): () => void {
  const bg = h("div", { class: "sheet-bg" }, h("div", { class: "sheet" }, content));
  const close = () => { bg.remove(); onClose?.(); };
  bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
  document.body.append(bg);
  return close;
}

// ---- state ---------------------------------------------------------------------------------------------------------------
let products: Product[] = [];
let categories: string[] = [];
let category = "All";
let tab: "home" | "cart" | "orders" | "me" = "home";
let cart: CartItem[] = [];
let mainEl: HTMLElement;
let headEl: HTMLElement;
let navEl: HTMLElement;
const byId = (id: string) => products.find((p) => p.id === id)!;

async function call<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<T> {
  try {
    return await api<T>(method, path, body, session?.token);
  } catch (e) {
    if (e instanceof HttpError && e.status === 401 && session) {         // the server forgot this session (restart or logout elsewhere)
      session = null;
      ls.del(K.session);
      cart = [];
      toast("Signed out");
      refresh();
    }
    throw e;
  }
}

// ---- behaviour recorded on the phone ------------------------------------------------------------------------------------------
const sessionStart = Date.now();
let nextId = ls.num(K.seq, 1);
let adsSeen = 0;
let lastDwell = 3;
let scroll = { y: window.scrollY, t: performance.now(), speed: 0 };
window.addEventListener("scroll", () => {
  const now = performance.now(), y = window.scrollY, dt = Math.max(now - scroll.t, 16);
  scroll = { y, t: now, speed: scroll.speed * 0.6 + ((Math.abs(y - scroll.y) / dt) * 1000) * 0.4 };
}, { passive: true });

function deviceIndex(): number {
  const ua = navigator.userAgent;
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) return 1;
  if (/Mobi|iPhone|Android/i.test(ua)) return 0;
  return 2;
}
function netQuality(): number {
  const t = (navigator as any).connection?.effectiveType as string | undefined;
  return ({ "slow-2g": 0, "2g": 1, "3g": 2, "4g": 3 } as Record<string, number>)[t ?? ""] ?? 2;
}
const tapTimes = () => events.filter((e) => e.y === 1).map((e) => e.t);

function record(cat: string, placement: string, visibleMs: number): Ev {
  const now = new Date();
  const lastTap = tapTimes().at(-1);
  const ev: Ev = {
    id: nextId++, t: Date.now(), cat, placement, hour: Math.floor(now.getHours() / 4), dev: deviceIndex(), y: 0,
    raw: {
      recency_min: lastTap ? Math.min(60, (Date.now() - lastTap) / 60000) : 60,
      taps_24h: tapTimes().filter((t) => Date.now() - t < 864e5).length,
      prev_dwell_s: lastDwell,
      scroll_speed: performance.now() - scroll.t > 300 ? 0 : scroll.speed,
      position: adsSeen, session_min: (Date.now() - sessionStart) / 60000, weekday: (now.getDay() + 6) % 7,
      screen_w: window.innerWidth, net_quality: netQuality(), visible_ms: visibleMs,
    },
  };
  ls.set(K.seq, String(nextId));
  adsSeen++;
  events.push(ev);
  saveEvents();
  return ev;
}

function encodeRow(S: Schema, e: Ev): number[] {
  const row = new Array<number>(S.n_features).fill(0);
  const hot = (group: string, value: string | number) => {
    const g = S.groups.find((x) => x.name === group)!;
    row[g.offset + (typeof value === "number" ? value : g.values.indexOf(value))] = 1;
  };
  hot("device", e.dev); hot("hour_bucket", e.hour); hot("ad_category", e.cat); hot("placement", e.placement);
  S.numeric.forEach((d, j) => {
    row[S.numeric_offset + j] = Math.max(-S.numeric_clamp, Math.min(S.numeric_clamp, (e.raw[d.name] - d.center) / d.scale));
  });
  return row;
}

interface Track { p: Product; placement: string; first: number; timer?: number; ev?: Ev; shownAt?: number }
const tracking = new WeakMap<Element, Track>();
let io: IntersectionObserver | null = null;

function onIntersect(list: IntersectionObserverEntry[]) {
  for (const en of list) {
    const t = tracking.get(en.target);
    if (!t) continue;
    if (en.intersectionRatio > 0 && !t.first) t.first = performance.now();
    if (en.intersectionRatio >= 0.6 && !t.ev && t.timer === undefined) {
      t.timer = window.setTimeout(() => {
        t.timer = undefined;
        if (document.visibilityState !== "visible" || t.ev) return;
        t.ev = record(t.p.category, t.placement, performance.now() - t.first);
        t.shownAt = performance.now();
      }, 400);
    } else if (en.intersectionRatio < 0.6) {
      if (t.timer !== undefined) { clearTimeout(t.timer); t.timer = undefined; }
      if (t.shownAt) { lastDwell = (performance.now() - t.shownAt) / 1000; t.shownAt = undefined; }
    }
  }
}
function watch(el: HTMLElement, p: Product, placement: string) {
  tracking.set(el, { p, placement, first: 0 });
  io?.observe(el);
}
function tapped(el: HTMLElement, p: Product, placement: string) {
  const t = tracking.get(el);
  const ev = t?.ev ?? (t ? (t.ev = record(p.category, placement, 400)) : undefined);
  if (ev && ev.y === 0) { ev.y = 1; saveEvents(); }
}

// ---- views ---------------------------------------------------------------------------------------------------------------------
function visual(p: Product, cls: string): HTMLElement {
  if (p.photo) return h("div", { class: cls }, h("img", { src: p.photo, alt: p.title, loading: "lazy" }));
  return h("div", { class: cls, style: `background:${p.bg};color:${p.fg}` }, h("div", { class: "mark" }, p.title));
}
function card(p: Product, placement: string): HTMLElement {
  const lo = Math.min(...p.amounts);
  // data-* attributes are the public contract a browser extension (extension/src/content.ts) reads: category and placement.
  const el = h("button", { class: "card", "data-fedad-cat": p.category, "data-fedad-placement": placement }, visual(p, "pic"), h("div", { class: "nm" }, p.title),
    h("div", { class: "pr" }, `from ${inr(sale(lo, p.off))}`, p.off ? h("span", { class: "off" }, `${p.off}%`) : ""));
  el.addEventListener("click", () => { tapped(el, p, placement); openProduct(p); });
  watch(el, p, placement);
  return el;
}
function forYou(): Product[] {
  const stat = new Map<string, { v: number; t: number }>();
  for (const e of events) { const s = stat.get(e.cat) ?? { v: 0, t: 0 }; s.v++; s.t += e.y; stat.set(e.cat, s); }
  const score = (c: string) => { const s = stat.get(c) ?? { v: 0, t: 0 }; return (s.t + 0.5) / (s.v + 8); };
  const ranked = [...categories].sort((a, b) => score(b) - score(a));
  return products.filter((p) => ranked.slice(0, 2).includes(p.category)).sort((a, b) => b.off - a.off).slice(0, 6);
}

function renderHome() {
  io?.disconnect();
  io = new IntersectionObserver(onIntersect, { threshold: [0, 0.6] });
  const list = products.filter((p) => category === "All" || p.category === category);
  const featured = [...list].filter((p) => p.photo).sort((a, b) => b.off - a.off)[0] ?? list[0];
  const picks = forYou().filter((p) => p.id !== featured?.id);
  const cats = h("div", { class: "cats" }, ...["All", ...categories].map((c) => {
    const b = h("button", { class: "cat", "aria-pressed": String(c === category) }, c);
    b.addEventListener("click", async () => { category = c; await loadProducts(); renderHome(); });
    return b;
  }));
  const frag: Child[] = [cats];
  if (featured) {
    const hero = h("button", { class: "hero" }, h("img", { src: featured.photo ?? "", alt: featured.title }), h("div", { class: "shade" }),
      h("div", { class: "t" }, h("b", {}, featured.title), h("span", {}, `up to ${featured.off}% off`)));
    if (!featured.photo) hero.replaceChildren(h("div", { style: `position:absolute;inset:0;background:${featured.bg}` }), h("div", { class: "t" }, h("b", {}, featured.title)));
    hero.addEventListener("click", () => { tapped(hero, featured, "feed-top"); openProduct(featured); });
    watch(hero, featured, "feed-top");
    frag.push(hero);
  }
  if (category === "All" && picks.length) {
    frag.push(h("div", { class: "sect" }, events.length >= 10 ? "For you" : "Deals"), h("div", { class: "row-h" }, ...picks.map((p) => card(p, "feed-bottom"))), h("div", { style: "height:18px" }));
  }
  frag.push(h("div", { class: "sect" }, category === "All" ? "All vouchers" : category), h("div", { class: "grid" }, ...list.map((p) => card(p, "feed-middle"))),
    h("div", { class: "credit" }, "Photos: Wikimedia Commons contributors, CC BY and CC BY-SA (shop/credits.json)"));
  mainEl.replaceChildren(...(frag.filter(Boolean) as Node[]));
}

function lockScreen(what: string): HTMLElement {
  return h("div", { class: "empty" }, h("div", { class: "ring" }, ico("lock", 34)), h("h2", {}, what),
    h("button", { class: "btn", onclick: () => openLogin() }, "Sign in"));
}

async function renderCart() {
  if (!session) return mainEl.replaceChildren(lockScreen("Cart"));
  try { cart = (await call<{ items: CartItem[] }>("GET", "/v1/shop/cart")).items; } catch { return; }
  refreshBadges();
  if (!cart.length) return mainEl.replaceChildren(h("div", { class: "empty" }, h("h2", {}, "Cart is empty")));
  let total = 0;
  const rows = cart.map((it) => {
    const p = byId(it.product_id);
    const line = sale(it.amount, p.off) * it.qty;
    total += line;
    return h("div", { class: "li" }, visual(p, "sw"), h("div", { class: "tx" }, h("b", {}, p.title), h("span", {}, `${inr(it.amount)} × ${it.qty}`)),
      h("b", {}, inr(line)),
      h("button", { class: "x", "aria-label": "Remove", onclick: async () => { await call("POST", "/v1/shop/cart/remove", { product_id: it.product_id, amount: it.amount }); renderCart(); } }, ico("x", 18)));
  });
  mainEl.replaceChildren(h("div", { class: "sect" }, "Cart"), h("div", { class: "list" }, ...rows), h("div", { class: "total" }, h("span", {}, "Total"), h("span", {}, inr(total))),
    h("div", { class: "list" }, h("button", { class: "btn green", onclick: async () => {
      try { await call("POST", "/v1/shop/checkout"); cart = []; toast("Order placed"); setTab("orders"); } catch (e) { toast((e as Error).message); }
    } }, "Pay " + inr(total))));
}

async function renderOrders() {
  if (!session) return mainEl.replaceChildren(lockScreen("Orders"));
  let items: { id: string; t: number; total: number; items: CartItem[] }[] = [];
  try { items = (await call<{ items: typeof items }>("GET", "/v1/shop/orders")).items; } catch { return; }
  if (!items.length) return mainEl.replaceChildren(h("div", { class: "empty" }, h("h2", {}, "No orders")));
  mainEl.replaceChildren(h("div", { class: "sect" }, "Orders"), h("div", { class: "list" }, ...items.map((o) =>
    h("div", { class: "li" }, h("div", { class: "tx" }, h("b", {}, "#" + o.id), h("span", {}, new Date(o.t * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) + " · " + o.items.map((i) => byId(i.product_id).title).join(", "))), h("b", {}, inr(o.total))))));
}

function renderMe() {
  const taps = events.filter((e) => e.y === 1).length;
  const rows: Child[] = [
    h("div", { class: "big-id" }, session ? session.email : "Guest"),
    session ? h("button", { class: "btn alt", onclick: signOut }, "Sign out") : h("button", { class: "btn green", onclick: () => openLogin() }, "Sign in"),
    h("button", { class: "btn alt", onclick: openInspector }, ico("eye", 20), "Data sent"),
    h("button", { class: "btn alt", onclick: openLearn }, "Private learning"),
    h("div", { class: "li" }, h("div", { class: "tx" }, h("b", {}, `${events.length} views · ${taps} taps`), h("span", {}, "on this phone")),
      h("button", { class: "x", "aria-label": "Delete", onclick: () => { events = []; saveEvents(); renderMe(); toast("Deleted"); } }, ico("x", 18))),
  ];
  mainEl.replaceChildren(h("div", { class: "me" }, ...(rows.filter(Boolean) as Node[])));
}

// ---- product page --------------------------------------------------------------------------------------------------------------
function openProduct(p: Product) {
  let amount = p.amounts[0];
  if (session) call("POST", "/v1/shop/events", { type: "view", product_id: p.id, category: p.category }).catch(() => undefined);
  else api("GET", `/v1/shop/products/${p.id}`).catch(() => undefined);                       // a guest's view is still a request for that product
  const price = h("div", { class: "price" });
  const amts = h("div", { class: "amts" });
  const paint = () => {
    amts.replaceChildren(...p.amounts.map((a) => {
      const b = h("button", { class: "amt", "aria-pressed": String(a === amount) }, inr(a));
      b.addEventListener("click", () => { amount = a; paint(); });
      return b;
    }));
    price.replaceChildren(inr(sale(amount, p.off)), p.off ? h("s", {}, inr(amount)) : "");
  };
  paint();
  const add = async (go: boolean) => {
    if (!session) return openLogin();
    try {
      cart = (await call<{ items: CartItem[] }>("POST", "/v1/shop/cart", { product_id: p.id, amount })).items;
      refreshBadges();
      if (go) { page.remove(); setTab("cart"); } else toast("Added");
    } catch (e) { toast((e as Error).message); }
  };
  const lock = session ? "" : ico("lock", 18);
  const page = h("div", { class: "page" },
    visual(p, "big"), h("button", { class: "back", "aria-label": "Back", onclick: () => page.remove() }, ico("back", 22)),
    h("div", { class: "body" }, h("h1", {}, p.title), h("div", { class: "sub" }, p.kind), amts, price),
    h("div", { class: "bar" }, h("button", { class: "btn alt", onclick: () => add(false) }, lock, "Add to cart"), h("button", { class: "btn", onclick: () => add(true) }, lock, "Buy now")));
  document.body.append(page);
}

// ---- login ---------------------------------------------------------------------------------------------------------------------
function openLogin() {
  const email = h("input", { class: "field", type: "email", placeholder: "Email", autocomplete: "email", autocapitalize: "none" }) as HTMLInputElement;
  const pw = h("input", { class: "field", type: "password", placeholder: "Password", autocomplete: "current-password" }) as HTMLInputElement;
  const err = h("div", { class: "err" });
  const go = h("button", { class: "btn green", style: "width:100%;flex:none", onclick: async () => {
    err.textContent = "";
    go.setAttribute("disabled", "true");
    try {
      const r = await api<{ token: string; email: string }>("POST", "/v1/shop/login", { email: email.value, password: pw.value });
      session = { token: r.token, email: r.email };
      ls.set(K.session, JSON.stringify(session));
      close();
      toast("Signed in");
      refresh();
    } catch (e) {
      err.textContent = e instanceof HttpError ? e.message : "No connection";
      go.removeAttribute("disabled");
    }
  } }, "Continue");
  const close = sheet(h("div", {}, h("h2", {}, "Sign in"), email, pw, err, go, h("button", { class: "link", onclick: () => close() }, "Browse as guest")));
}
async function signOut() {
  try { await call("POST", "/v1/shop/logout"); } catch { /* the session is dropped either way */ }
  session = null;
  ls.del(K.session);
  cart = [];
  refresh();
}

// ---- inspector: what really left the phone -----------------------------------------------------------------------------------------
const LABEL: Record<Entry["kind"], string> = { guest: "Guest", login: "Login", account: "Signed in", learn: "Learning" };
function openInspector() {
  const list = h("div", {});
  const counts = h("div", { class: "cols4" });
  const paint = () => {
    const all = entries();
    counts.replaceChildren(...(["guest", "login", "account", "learn"] as const).map((k) =>
      h("div", { class: `cnt ${k}` }, h("b", {}, String(all.filter((e) => e.kind === k).length)), h("span", {}, LABEL[k]))));
    list.replaceChildren(...all.slice(0, 60).map((e) => {
      const pre = h("pre", { hidden: "true" });
      const hdr: Record<string, string> = e.body ? { "Content-Type": "application/json" } : {};
      if (e.token) hdr.Authorization = "Bearer ••••";
      const shown = e.body ? { ...e.body, ...("password" in e.body ? { password: "••••••" } : {}) } : null;
      pre.textContent = JSON.stringify({ [`${e.method} ${e.path}`]: e.status, headers: hdr, body: shown }, null, 1);
      const row = h("button", { class: `req ${e.kind}` },
        h("div", {}, h("span", { class: "m" }, e.method + " "), h("span", { class: "p" }, shortPath(e.path))),
        h("div", { class: "c" }, ...chips(e).map((c) => h("span", { class: "chip" + (e.kind !== "guest" ? " id" : "") }, c))), pre);
      row.addEventListener("click", () => pre.toggleAttribute("hidden"));
      return row;
    }));
  };
  paint();
  const off = onLog(paint);
  sheet(h("div", {}, h("h2", {}, "Sent from this phone"), counts,
    h("div", { class: "auto" }, h("span", { class: "chip auto" }, "IP"), h("span", { class: "chip auto" }, "device"), h("span", { class: "chip auto" }, "language")),
    list, h("button", { class: "link", onclick: () => clearLog() }, "Clear")), off);
}

// ---- private learning (federated contribution) ------------------------------------------------------------------------------------------
function openLearn() {
  const body = h("div", {});
  const close = sheet(body);
  const paint = () => {
    const dev = fl();
    if (!dev) {
      const code = h("input", { class: "field", placeholder: "Join code", value: new URLSearchParams(location.search).get("code") ?? ls.get(K.code) ?? "", autocapitalize: "characters", maxlength: 8 }) as HTMLInputElement;
      const err = h("div", { class: "err" });
      body.replaceChildren(h("h2", {}, "Private learning"), code, err, h("button", { class: "btn green", style: "width:100%;flex:none", onclick: async () => {
        try {
          const r = await register("", code.value.trim(), session ? session.email.split("@")[0].slice(0, 12) : "guest phone");
          ls.set(K.fl, JSON.stringify({ token: r.token, id: r.device_id })); ls.set(K.code, code.value.trim()); ls.set(K.uploads, "0");
          paint();
        } catch (e) { err.textContent = e instanceof ApiError && e.status === 403 ? "Wrong code" : "Cannot join"; }
      } }, "Join"));
      return;
    }
    const taps = events.filter((e) => e.y === 1).length;
    const ready = events.length >= MIN_VIEWS && taps >= MIN_TAPS;
    const steps = STEPS.map((s) => h("li", {}, h("span", { class: "d" }, "·"), h("div", {}, h("b", {}, s), h("span", { class: "num" }, ""))));
    const out = h("div", {});
    const go = h("button", { class: "btn green", style: "flex:1", disabled: ready ? undefined : "true", onclick: run }, "Contribute");
    const ceil = h("input", { class: "field", type: "number", value: String(ls.num(K.ceiling, 150)), style: "margin:0;width:110px" }) as HTMLInputElement;
    ceil.addEventListener("change", () => ls.set(K.ceiling, String(Math.max(1, Number(ceil.value) || 150))));
    body.replaceChildren(h("h2", {}, "Private learning"),
      h("div", { class: "li", style: "margin-bottom:10px" }, h("div", { class: "tx" }, h("b", {}, `${events.length} views · ${taps} taps`), h("span", {}, ready ? "ready" : `need ${MIN_VIEWS} views, ${MIN_TAPS} taps`)),
        h("div", {}, h("span", { class: "chip" }, "ε limit"), ceil)),
      h("ol", { class: "steps" }, ...steps), out, h("div", { class: "row2" }, go));
    async function run() {
      go.setAttribute("disabled", "true");
      out.replaceChildren();
      steps.forEach((li) => { li.className = ""; (li.querySelector(".d") as HTMLElement).textContent = "·"; (li.querySelector(".num") as HTMLElement).textContent = ""; });
      try {
        const S = await getSchema("");
        const X = new Float64Array(events.length * S.n_features);
        events.forEach((e, i) => X.set(encodeRow(S, e), i * S.n_features));
        const y = Float64Array.from(events.map((e) => e.y));
        const r = await contribute({
          base: "", token: dev!.token, schema: S, X, y, ceilingPerUpload: ls.num(K.ceiling, 150), allowNonPrivate: false, uploadsSoFar: ls.num(K.uploads, 0),
          onStep: (i, state, detail) => {
            steps[i].className = state;
            (steps[i].querySelector(".d") as HTMLElement).textContent = state === "done" ? "✓" : state === "fail" ? "!" : "…";
            (steps[i].querySelector(".num") as HTMLElement).textContent = detail;
          },
        });
        ls.set(K.uploads, String(ls.num(K.uploads, 0) + 1));
        const pol = r.model.policy, n = ls.num(K.uploads, 0);
        const spent = pol.dp ? epsAfter(pol.sigma, 2 * pol.clip_c, n, pol.delta_total) : 0;
        const fresh = (await getModel("")).weights;
        const says = readModel(S, fresh);
        out.replaceChildren(h("div", { class: "li", style: "display:block" },
          h("b", {}, `${n} of ${pol.max_uploads} · ε ${spent.toFixed(0)} of ${pol.eps_total.toFixed(0)}`),
          h("div", { class: "meter" }, h("i", { style: `width:${Math.min(100, (100 * n) / pol.max_uploads)}%` })),
          h("span", { style: "color:var(--muted);font-weight:600" }, `Model: ${says.topCategory.name}, ${says.topHour.name} h`)),
          h("button", { class: "btn alt", style: "width:100%;flex:none;margin-top:10px", onclick: () => openProof(r.proof, fresh, S) }, "Proof"));
      } catch (e) {
        const msg = e instanceof Refused ? e.message : (e as Error).message;
        out.replaceChildren(h("div", { class: "err" }, msg));
        if (/Unknown device/.test(msg)) out.append(h("button", { class: "btn alt", style: "width:100%;flex:none", onclick: () => { ls.del(K.fl); ls.set(K.uploads, "0"); paint(); } }, "Rejoin"));
      }
      go.removeAttribute("disabled");
    }
  };
  paint();
  void close;
}

// ---- proof: the local model, the update that left, the global model afterwards ------------------------------------------------------------
function barsSvg(values: number[], overlay?: number[], color = "#15120f"): HTMLElement {
  const W = 340, H = 84, n = values.length;
  const max = Math.max(1e-9, ...values.map(Math.abs), ...(overlay ?? []).map(Math.abs));
  const bw = W / n;
  const bar = (v: number, i: number, fill: string, inset: number) => {
    const hh = (Math.abs(v) / max) * (H / 2 - 2);
    return `<rect x="${i * bw + inset}" y="${v >= 0 ? H / 2 - hh : H / 2}" width="${bw - 2 * inset - 1}" height="${Math.max(hh, 0.5)}" fill="${fill}"/>`;
  };
  const el = document.createElement("div");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="#bdb6a8"/>` +
    values.map((v, i) => bar(v, i, color, 0)).join("") + (overlay ?? []).map((v, i) => bar(v, i, "#0b7a57", 2.5)).join("") + "</svg>";
  return el;
}

function openProof(p: Proof, fresh: number[], S: Schema) {
  const local = categoryRates(S, p.wLocal), glob = categoryRates(S, p.wGlobal), after = categoryRates(S, fresh);
  const top = Math.max(...local.map((x) => x.ctr), ...after.map((x) => x.ctr), 0.01);
  const row = (name: string, a: number, b: number, c: number) => h("div", { class: "pf" }, h("span", {}, name),
    h("div", { class: "pf-b" }, h("i", { style: `width:${(100 * a) / top}%;background:#0b7a57` }), h("i", { style: `width:${(100 * b) / top}%;background:#bdb6a8` }), h("i", { style: `width:${(100 * c) / top}%;background:#15120f` })),
    h("b", {}, `${(100 * a).toFixed(0)}%`));
  const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  const noise = p.sent.map((x, i) => x - p.clipped[i]);
  sheet(h("div", {},
    h("h2", {}, "Proof"),
    h("div", { class: "sect2" }, "1  Local model on this phone"),
    h("div", { class: "legend" }, h("span", { style: "background:#0b7a57" }), "local", h("span", { style: "background:#bdb6a8" }), "global before", h("span", { style: "background:#15120f" }), "global after"),
    ...local.map((x, i) => row(x.name, x.ctr, glob[i].ctr, after[i].ctr)),
    h("div", { class: "stat" }, h("b", {}, `${p.lossBefore.toFixed(3)} → ${p.lossAfter.toFixed(3)}`), h("span", {}, "loss, trained here")),
    h("div", { class: "sect2" }, "2  Update that left the phone"),
    barsSvg(p.sent, p.clipped),
    h("div", { class: "legend" }, h("span", { style: "background:#15120f" }), "sent (clipped + noise)", h("span", { style: "background:#0b7a57" }), "clipped, before noise"),
    h("div", { class: "stat" }, h("b", {}, `${norm(p.rawDelta).toFixed(2)} → ${norm(p.clipped).toFixed(2)} → ${norm(p.sent).toFixed(2)}`), h("span", {}, `raw, clipped, sent · noise σ ${p.sigma.toFixed(2)} (${norm(noise).toFixed(2)})`)),
    h("div", { class: "stat" }, h("b", { class: "mono" }, `${p.bytes} B  0x${p.checksum.toString(16).toUpperCase().padStart(8, "0")}`), h("span", {}, "size and checksum: the server shows the same")),
    h("div", { class: "sect2" }, "3  Global model after"),
    barsSvg(fresh.map((w, i) => w - p.wGlobal[i])),
    h("div", { class: "stat" }, h("b", {}, norm(fresh.map((w, i) => w - p.wGlobal[i])).toFixed(3)), h("span", {}, "change in the global weights")),
    h("button", { class: "link", onclick: () => document.querySelector<HTMLElement>(".sheet-bg:last-of-type")?.click() }, "Close")));
}

// ---- shell ---------------------------------------------------------------------------------------------------------------------------
async function loadProducts() {
  const q = category === "All" ? "" : `?category=${encodeURIComponent(category)}`;
  const r = await call<{ items: Product[]; categories: string[] }>("GET", `/v1/shop/products${q}`);
  if (category === "All" || !products.length) { products = r.items; } else {
    const keep = new Map(products.map((p) => [p.id, p]));
    r.items.forEach((p) => keep.set(p.id, p));
    products = [...keep.values()];
  }
  const order = ["Travel", "Food", "Tech", "Fashion", "Games", "Sports", "Health", "Finance"];
  categories = (r.categories.length ? r.categories : categories).sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

function refreshBadges() {
  headEl.querySelector(".insp .badge")?.remove();
  const n = entries().length;
  if (n) headEl.querySelector(".insp")?.append(h("span", { class: "badge" + (session ? " red" : "") }, String(Math.min(n, 99))));
  navEl.querySelector(".cart .badge")?.remove();
  const q = cart.reduce((s, i) => s + i.qty, 0);
  if (q) navEl.querySelector(".cart")?.append(h("span", { class: "badge" }, String(q)));
}

function paintHeader() {
  headEl.replaceChildren(h("div", { class: "logo" }, "perks", h("i", {}, ".")), h("span", { class: "demo" }, "DEMO"),
    h("button", { class: "ib insp", "aria-label": "Data sent", onclick: openInspector }, ico("eye", 22)),
    h("button", { class: "who" + (session ? " in" : ""), onclick: () => (session ? setTab("me") : openLogin()) }, h("span", { class: "dot" }), session ? session.email.split("@")[0].slice(0, 9) : "Guest"));
  refreshBadges();
}

function paintNav() {
  const item = (id: typeof tab, label: string, icon: keyof typeof ICONS) => {
    const b = h("button", { class: id, "aria-current": String(tab === id), onclick: () => setTab(id) }, ico(icon, 24), label);
    return b;
  };
  navEl.replaceChildren(item("home", "Shop", "home"), item("cart", "Cart", "cart"), item("orders", "Orders", "bag"), item("me", "Me", "user"));
  refreshBadges();
}

function setTab(t: typeof tab) {
  tab = t;
  window.scrollTo(0, 0);
  paintNav();
  render();
}
function render() {
  if (tab === "home") renderHome();
  else if (tab === "cart") void renderCart();
  else if (tab === "orders") void renderOrders();
  else renderMe();
}
function refresh() {
  paintHeader();
  paintNav();
  if (session) call<{ items: CartItem[] }>("GET", "/v1/shop/cart").then((r) => { cart = r.items; refreshBadges(); }).catch(() => undefined);
  render();
}

async function boot() {
  installSpy();
  headEl = h("div", { class: "top" });
  mainEl = h("main", {});
  navEl = h("nav", { class: "nav" });
  app.replaceChildren(headEl, mainEl, navEl);
  onLog(refreshBadges);
  try {
    await loadProducts();
  } catch (e) {
    mainEl.replaceChildren(h("div", { class: "empty" }, h("h2", {}, "No connection"), h("button", { class: "btn", onclick: () => location.reload() }, "Retry")));
    paintHeader();
    paintNav();
    return;
  }
  refresh();
}
boot();
