// Perks: gift-card and voucher storefront. Talks to the shop API (backend/src/fedad/web/shop.py).
// Every product card carries data-fedad-cat and data-fedad-placement: that is all the FedAd browser extension reads.
import "./store.css";
import { MIN_TAPS, MIN_VIEWS, ceiling, consent, contributeNow, join, ready, savedCode, setCeiling, setConsent, shareProfile, stats, watchCard, wipe } from "./learn";

interface Product { id: string; title: string; kind: string; category: string; amounts: number[]; off: number; photo: string | null; bg: string; fg: string }
interface CartItem { product_id: string; amount: number; qty: number }
interface Session { token: string; email: string }

const KEY = "perks.store.session";
let products: Product[] = [];
let categories: string[] = [];
let session: Session | null = JSON.parse(localStorage.getItem(KEY) ?? "null");
let cart: CartItem[] = [];
let filter = "All";
let query = "";
type Page = "home" | "shop" | "travel";
const pageFromHash = (): Page => (location.hash === "#/travel" ? "travel" : location.hash === "#/shop" ? "shop" : "home");
let page: Page = pageFromHash();
window.addEventListener("hashchange", () => { page = pageFromHash(); window.scrollTo(0, 0); render(); });

type Kid = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, any> = {}, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v !== undefined) e.setAttribute(k, String(v));
  }
  for (const c of kids) if (c) e.append(c);
  return e;
}
const inr = (n: number) => "₹" + n.toLocaleString("en-IN");
const sale = (amount: number, off: number) => Math.floor((amount * (100 - off)) / 100);
const $app = document.getElementById("app")!;

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(session ? { Authorization: "Bearer " + session.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && session) { session = null; localStorage.removeItem(KEY); cart = []; render(); }
  if (!r.ok) throw new Error(j.detail ?? `Error ${r.status}`);
  return j as T;
}

function toast(msg: string) {
  const t = h("div", { class: "toast", role: "status" }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2400);
}

// ---- pieces --------------------------------------------------------------------------------------------------------------
function visual(p: Product, cls: string): HTMLElement {
  if (p.photo) return h("div", { class: cls }, h("img", { src: p.photo, alt: "", loading: "lazy" }));
  return h("div", { class: cls, style: `background:${p.bg};color:${p.fg}` }, h("div", { class: "mark" }, p.title));
}

function card(p: Product, placement: string): HTMLElement {
  const lo = Math.min(...p.amounts);
  const pic = visual(p, "pic");
  if (p.off) pic.append(h("span", { class: "off" }, `${p.off}% off`));
  const el = h("button", {
    class: "card", "data-fedad-cat": p.category, "data-fedad-placement": placement, onclick: () => openProduct(p),
  }, pic, h("div", { class: "meta" }, h("div", { class: "nm" }, p.title), h("div", { class: "kd" }, `${p.kind} · ${p.category}`),
    h("div", { class: "pr" }, `From ${inr(sale(lo, p.off))}`)));
  watchCard(el);                                       // local view and tap cache for private learning (does nothing without consent)
  return el;
}

// ---- private learning: consent banner and panel ---------------------------------------------------------------------------
function openLearn() {
  const body = h("div", {});
  const close = overlay(body, true);
  const put = (...k: Kid[]) => body.replaceChildren(...(k.filter(Boolean) as Node[]));
  let flash = { text: "", bad: false };               // survives the redraw that follows every action
  const paint = () => {
    const c = consent(), s = stats();
    if (c !== "yes") {
      put(h("h3", { style: "margin:0 0 8px;font-size:24px" }, "Private learning"),
        h("p", {}, "Let this page remember which vouchers you look at and tap, in this browser only, and teach a shared model from it."),
        h("p", { class: "note" }, "What stays here: your views and taps. What leaves, only when you press Contribute: one model update, clipped and with random noise added in your browser. You can stop and delete everything at any time."),
        h("button", { class: "btn accent block", onclick: () => { setConsent("yes"); paint(); } }, "Turn on"),
        c === "no" ? h("p", { class: "note" }, "It is currently off.") : null);
      return;
    }
    const msg = h("div", { class: "err", role: "status", style: `color:${flash.bad ? "#b00020" : "var(--ink)"}` }, flash.text);
    const say = (t: string, bad = false) => { flash.text = t; flash.bad = bad; msg.textContent = t; msg.style.color = bad ? "#b00020" : "var(--ink)"; };
    const code = h("input", { class: "field", placeholder: "Campaign join code", value: savedCode(), maxlength: "8", autocapitalize: "characters" });
    const ceil = h("input", { class: "field", type: "number", value: String(ceiling()), style: "width:120px;margin:0" });
    ceil.addEventListener("change", () => setCeiling(Number(ceil.value)));
    const busy = async (fn: () => Promise<string | void>, btn: HTMLButtonElement) => {
      btn.disabled = true;
      try { const r = await fn(); flash = { text: r || "", bad: false }; paint(); } catch (e) { say((e as Error).message, true); }
      btn.disabled = false;
    };
    const joinBtn = h("button", { class: "btn block", onclick: (e: Event) => busy(async () => { await join(code.value); }, e.currentTarget as HTMLButtonElement) }, "Join");
    const go = h("button", { class: "btn accent block", onclick: (e: Event) => busy(() => contributeNow(), e.currentTarget as HTMLButtonElement) }, "Contribute now");
    const share = h("button", { class: "btn block", onclick: (e: Event) => busy(() => shareProfile(session!.email), e.currentTarget as HTMLButtonElement) }, "Send interest profile for advertiser matching");
    if (!s.joined) go.setAttribute("disabled", "true");
    put(h("h3", { style: "margin:0 0 8px;font-size:24px" }, "Private learning"),
      h("div", { class: "row" }, h("span", {}, "Cached in this browser"), h("b", {}, `${s.views} views · ${s.taps} taps`)),
      h("div", { class: "row" }, h("span", {}, "Updates sent"), h("b", {}, String(s.uploads))),
      h("p", { class: "note" }, ready() ? "Enough activity to contribute." : `Keep browsing: ${MIN_VIEWS} views and ${MIN_TAPS} taps are needed.`),
      s.joined ? null : h("div", {}, code, joinBtn, h("div", { style: "height:10px" })),
      h("div", { style: "display:flex;align-items:center;gap:10px;margin:10px 0" }, h("label", {}, "Privacy limit per update (epsilon)"), ceil),
      go,
      h("div", { style: "height:10px" }),
      session ? share : h("p", { class: "note" }, "Sign in to the store to send the optional advertiser-matching profile (it is keyed by your shop email)."),
      h("div", { style: "height:10px" }), msg,
      h("button", { class: "btn ghost block", style: "margin-top:8px", onclick: () => { wipe(); setConsent("no"); close(); toast("Learning off, local data deleted"); render(); } }, "Stop and delete my local data"));
  };
  paint();
}

function consentBanner() {
  if (consent() !== null || document.getElementById("consent-bar")) return;
  const bar = h("div", { id: "consent-bar", class: "consent", role: "region", "aria-label": "Private learning" },
    h("span", {}, "Help improve recommendations without sharing what you browse? Your views stay in this browser; only a noised model update can leave, and only when you press a button."),
    h("div", { class: "consent-actions" },
      h("button", { class: "btn accent", onclick: () => { setConsent("yes"); bar.remove(); } }, "Turn on"),
      h("button", { class: "btn ghost", onclick: () => { setConsent("no"); bar.remove(); } }, "No thanks")));
  document.body.append(bar);
}

function shown(): Product[] {
  const q = query.trim().toLowerCase();
  return products.filter((p) => p.category !== "Travel" && (filter === "All" || p.category === filter) && (!q || `${p.title} ${p.category} ${p.kind}`.toLowerCase().includes(q)));
}

function overlay(content: HTMLElement, narrow = false): () => void {
  const scrim = h("div", { class: "scrim", role: "dialog", "aria-modal": "true" });
  const box = h("div", { class: "dialog" + (narrow ? " narrow" : "") }, content);
  const close = () => { scrim.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
  document.addEventListener("keydown", onKey);
  box.prepend(h("button", { class: "x", "aria-label": "Close", onclick: close }, "×"));
  scrim.append(box);
  document.body.append(scrim);
  (box.querySelector("button:not(.x), input") as HTMLElement | null)?.focus();
  return close;
}

function openProduct(p: Product) {
  let amount = p.amounts[0], qty = 1;
  const price = h("div", { class: "nm", style: "font-size:22px" });
  const amts = p.amounts.map((a) => h("button", { class: "amt", "aria-pressed": String(a === amount), onclick: () => { amount = a; paint(); } }, inr(a)));
  const qv = h("b", {}, "1");
  const paint = () => {
    amts.forEach((b, i) => b.setAttribute("aria-pressed", String(p.amounts[i] === amount)));
    qv.textContent = String(qty);
    price.textContent = `${inr(sale(amount * qty, p.off))}` + (p.off ? ` (you save ${inr(amount * qty - sale(amount * qty, p.off))})` : "");
  };
  const err = h("div", { class: "err" });
  const add = h("button", { class: "btn accent block", onclick: async () => {
    if (!session) { close(); openLogin(() => openProduct(p), `Sign in or create an account to add ${p.title} to your cart.`); return; }
    try { cart = (await api<{ items: CartItem[] }>("POST", "/v1/shop/cart", { product_id: p.id, amount, qty })).items; close(); render(); toast("Added to cart"); }
    catch (e) { err.textContent = (e as Error).message; }
  } }, "Add to cart");
  const body = h("div", { class: "body" }, h("h3", {}, p.title), h("div", { class: "kd" }, `${p.kind} · ${p.category}`),
    h("p", { class: "note" }, "Choose an amount"), h("div", { class: "amounts" }, ...amts),
    h("div", { class: "qty" }, h("button", { "aria-label": "Fewer", onclick: () => { qty = Math.max(1, qty - 1); paint(); } }, "−"), qv,
      h("button", { "aria-label": "More", onclick: () => { qty = Math.min(10, qty + 1); paint(); } }, "+")),
    price, h("div", { style: "height:16px" }), add, err);
  const close = overlay(h("div", { class: "detail" }, visual(p, "pic"), body));
  paint();
}

function openLogin(after?: () => void, reason?: string, startMode: "signin" | "signup" = "signin") {
  let mode = startMode;
  const body = h("div", {});
  const close = overlay(body, true);
  const paint = () => {
    const up = mode === "signup";
    const email = h("input", { class: "field", type: "email", autocomplete: "email", placeholder: "you@example.com", id: "em" });
    const pw = h("input", { class: "field", type: "password", autocomplete: up ? "new-password" : "current-password", id: "pw", placeholder: up ? "At least 4 characters" : "Your password" });
    const pw2 = h("input", { class: "field", type: "password", autocomplete: "new-password", id: "pw2", placeholder: "Re-enter password" });
    const err = h("div", { class: "err", role: "alert" });
    const submit = async () => {
      if (up && pw.value !== pw2.value) { err.textContent = "The two passwords do not match."; return; }
      try {
        const r = await api<Session>("POST", "/v1/shop/login", { email: email.value, password: pw.value, mode });
        session = { token: r.token, email: r.email };
        localStorage.setItem(KEY, JSON.stringify(session));
        cart = (await api<{ items: CartItem[] }>("GET", "/v1/shop/cart")).items;
        close(); render(); toast(up ? "Welcome to Perks" : "Signed in"); after?.();
      } catch (e) { err.textContent = (e as Error).message; }
    };
    const go = h("button", { class: "btn accent block", onclick: submit }, up ? "Create account" : "Sign in");
    for (const f of [email, pw, pw2]) f.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") void submit(); });
    const tab = (m: "signin" | "signup", label: string) => h("button", { role: "tab", "aria-selected": String(mode === m), onclick: () => { mode = m; paint(); } }, label);
    body.replaceChildren(
      h("h3", { style: "margin:0 0 6px;font-size:24px" }, up ? "Create your account" : "Welcome back"),
      h("p", { class: "note" }, reason ?? (up ? "Save your cart and check out faster." : "Sign in to your Perks account.")),
      h("div", { class: "tabs", role: "tablist" }, tab("signin", "Sign in"), tab("signup", "Create account")),
      h("label", { for: "em" }, "Email"), email, h("label", { for: "pw" }, "Password"), pw,
      ...(up ? [h("label", { for: "pw2" }, "Confirm password"), pw2] : []), go, err);
    email.focus();
  };
  paint();
}

function openCart() {
  const scrim = h("div", { class: "scrim", style: "justify-content:flex-end;padding:0" });
  const panel = h("aside", { class: "drawer", "aria-label": "Cart" });
  const close = () => scrim.remove();
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
  const paint = () => {
    const err = h("div", { class: "err" });
    let total = 0;
    const rows = cart.map((it) => {
      const p = products.find((x) => x.id === it.product_id)!;
      const line = sale(it.amount * it.qty, p.off);
      total += line;
      return h("div", { class: "row" }, h("div", {}, h("b", {}, p.title), h("div", { class: "kd" }, `${inr(it.amount)} × ${it.qty}`)),
        h("div", { style: "text-align:right" }, h("div", {}, inr(line)),
          h("button", { class: "pill", style: "height:30px;margin-top:4px", onclick: async () => {
            cart = (await api<{ items: CartItem[] }>("POST", "/v1/shop/cart/remove", { product_id: it.product_id, amount: it.amount })).items; render(); paint();
          } }, "Remove")));
    });
    const put = (...k: Kid[]) => panel.replaceChildren(...(k.filter(Boolean) as Node[]));
    put(h("button", { class: "x", "aria-label": "Close cart", onclick: close }, "×"), h("h3", { style: "font-size:24px;margin:0 0 12px" }, "Your cart"),
      ...(rows.length ? rows : [h("p", { class: "note" }, "Your cart is empty.")]),
      rows.length ? h("div", { class: "row", style: "font-weight:700;font-size:18px;border:0" }, h("span", {}, "Total"), h("span", {}, inr(total))) : null,
      rows.length ? h("button", { class: "btn accent block", onclick: async () => {
        try {
          const o = await api<{ id: string; total: number }>("POST", "/v1/shop/checkout");
          cart = []; render();
          panel.replaceChildren(h("button", { class: "x", "aria-label": "Close", onclick: close }, "×"), h("h3", { style: "font-size:24px" }, "Order placed"),
            h("p", {}, `Order ${o.id} for ${inr(o.total)} is confirmed.`), h("p", { class: "note" }, "Thank you for shopping with Perks."),
            h("button", { class: "btn block", onclick: close }, "Keep browsing"));
        } catch (e) { err.textContent = (e as Error).message; }
      } }, "Place order") : null, err);
  };
  paint();
  scrim.append(panel);
  document.body.append(scrim);
}

// ---- page ----------------------------------------------------------------------------------------------------------------
const nav = (to: Page) => { location.hash = to === "home" ? "#/" : "#/" + to; };

function header(): HTMLElement {
  const cartCount = cart.reduce((n, i) => n + i.qty, 0);
  const search = h("input", { type: "search", placeholder: "Search brands and vouchers", "aria-label": "Search", value: query });
  search.addEventListener("input", () => { query = search.value; paintGrid(); });
  search.addEventListener("keydown", (e) => { if (e.key === "Enter" && page !== "shop") { query = search.value; nav("shop"); } });
  const tab = (to: Page, label: string) => h("a", { class: "tab", href: to === "home" ? "#/" : "#/" + to, "aria-current": page === to ? "page" : false }, label);
  return h("header", { class: "top" }, h("div", { class: "wrap" },
    h("a", { class: "logo", href: "#/" }, h("i"), "Perks"),
    h("nav", { class: "tabs-nav", "aria-label": "Sections" }, tab("home", "Home"), tab("shop", "Gift cards"), tab("travel", "Travel")),
    h("div", { class: "search" }, search),
    h("div", { class: "actions" },
      session ? h("button", { class: "btn ghost", title: session.email, onclick: async () => { await api("POST", "/v1/shop/logout").catch(() => {}); session = null; cart = []; localStorage.removeItem(KEY); render(); toast("Signed out"); } }, `Sign out`)
              : h("button", { class: "btn ghost", onclick: () => openLogin() }, "Sign in"),
      session ? null : h("button", { class: "btn ghost hide-sm", onclick: () => openLogin(undefined, undefined, "signup") }, "Create account"),
      h("button", { class: "btn", onclick: () => (session ? openCart() : openLogin(openCart, "Sign in or create an account to view your cart.")) }, "Cart", cartCount ? h("span", { class: "badge" }, String(cartCount)) : null))));
}

function footer(): HTMLElement {
  const link = (label: string, to: Page, cat?: string) => h("a", { href: to === "home" ? "#/" : "#/" + to, onclick: () => { if (cat) filter = cat; } }, label);
  return h("footer", {}, h("div", { class: "wrap foot" },
    h("div", {}, h("a", { class: "logo", href: "#/" }, h("i"), "Perks"), h("p", { class: "note", style: "max-width:30ch;margin-top:10px" }, "Gift cards, vouchers and holidays from brands you already love.")),
    h("div", {}, h("b", {}, "Shop"), link("Gift cards", "shop"), link("Food and dining", "shop", "Food"), link("Fashion", "shop", "Fashion"), link("Games and tech", "shop", "Games")),
    h("div", {}, h("b", {}, "Travel"), link("Holidays and stays", "travel"), link("Rides and travel credit", "travel")),
    h("div", {}, h("b", {}, "Account"), h("a", { href: "#/", onclick: (e: Event) => { e.preventDefault(); session ? openCart() : openLogin(); } }, session ? "Your cart" : "Sign in"),
      h("a", { href: "#/", onclick: (e: Event) => { e.preventDefault(); openLearn(); } }, "Personalisation settings"))),
    h("div", { class: "wrap legal" }, h("span", {}, `© ${new Date().getFullYear()} Perks`), h("span", {}, "Prices in Indian rupees")));
}

const byId = (ids: string[]) => ids.map((id) => products.find((p) => p.id === id)).filter(Boolean) as Product[];
const grid = (list: Product[], placement: string) => h("div", { class: "grid" }, ...list.map((p) => card(p, placement)));
const section = (title: string, body: HTMLElement, sub?: string, extra?: Kid) =>
  h("section", { class: "block" }, h("div", { class: "wrap" }, h("div", { class: "head" }, h("div", {}, h("h2", {}, title), sub ? h("p", { class: "sub" }, sub) : null), extra), body));

function homePage(): Node[] {
  const nonTravel = products.filter((p) => p.category !== "Travel");
  const cats = categories.filter((c) => c !== "Travel");
  const counts = new Map<string, number>();
  for (const p of nonTravel) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const heroPicks = byId(["coffee", "swig", "myn", "dine"]);
  const popular = byId(["amz", "swig", "myn", "steam", "nflx", "zom", "flip", "dec"]);
  const deals = [...nonTravel].sort((a, b) => b.off - a.off).slice(0, 4);
  const goCat = (c: string) => { filter = c; nav("shop"); };
  return [
    h("section", { class: "hero" }, h("div", { class: "wrap" },
      h("div", {}, h("span", { class: "eyebrow" }, "Gift cards and vouchers"),
        h("h1", {}, "The right gift, in any amount"),
        h("p", { class: "lede" }, `Choose from ${nonTravel.length} brands across shopping, food, games and more. Pick an amount from ₹250 and check out in a minute.`),
        h("div", { class: "cta" }, h("button", { class: "btn accent lg", onclick: () => nav("shop") }, "Browse gift cards"),
          h("button", { class: "btn ghost lg", onclick: () => nav("travel") }, "Explore travel"))),
      h("div", { class: "hero-grid" }, ...heroPicks.map((p) => card(p, "banner"))))),
    h("section", { class: "trust" }, h("div", { class: "wrap" },
      ...[["Brands you know", `${nonTravel.length}+ top brands`], ["Every budget", "From ₹250"], ["Savings built in", "Up to 15% off"], ["Secure account", "Your cart stays yours"]]
        .map(([a, b]) => h("div", {}, h("b", {}, a), h("span", {}, b))))),
    section("Shop by category", h("div", { class: "cats" }, ...cats.map((c) => h("button", { class: "cat", onclick: () => goCat(c) }, h("b", {}, c), h("span", {}, `${counts.get(c)} brands`))))),
    section("Popular brands", grid(popular, "feed-top"), "What shoppers pick most", h("button", { class: "link", onclick: () => nav("shop") }, "View all")),
    h("section", { class: "promo" }, h("div", { class: "wrap" }, h("div", {}, h("h2", {}, "Planning a getaway?"), h("p", {}, "Beach stays, heritage tours and houseboats, all on the new Travel page.")),
      h("button", { class: "btn accent lg", onclick: () => nav("travel") }, "See travel offers"))),
    section("Biggest savings", grid(deals, "feed-middle"), "Top discounts right now"),
  ];
}

function shopPage(): Node[] {
  const cats = categories.filter((c) => c !== "Travel");
  if (filter === "Travel") filter = "All";
  const pill = (c: string) => h("button", { class: "pill", "aria-pressed": String(filter === c), onclick: () => { filter = c; render(); } }, c);
  return [
    h("section", { class: "page-head" }, h("div", { class: "wrap" }, h("h1", {}, "Gift cards"), h("p", { class: "lede" }, "Shopping, food, games and wellness, in rupee amounts."),
      h("div", { class: "pills" }, ...["All", ...cats].map(pill)))),
    h("section", { class: "block" }, h("div", { class: "wrap" },
      h("div", { class: "head" }, h("h2", {}, filter === "All" ? "All gift cards" : filter), h("span", { class: "note", id: "count" })),
      h("div", { class: "grid", id: "grid" }))),
  ];
}

function travelPage(): Node[] {
  const trips = products.filter((p) => p.category === "Travel" && p.photo);
  const credit = products.filter((p) => p.category === "Travel" && !p.photo);
  const lead = trips[0];
  return [
    h("section", { class: "travel-hero", style: lead?.photo ? `background-image:linear-gradient(90deg,rgba(15,23,42,.78),rgba(15,23,42,.25)),url(${lead.photo})` : "" },
      h("div", { class: "wrap" }, h("span", { class: "eyebrow light" }, "Travel"), h("h1", {}, "Holidays worth taking"),
        h("p", { class: "lede" }, "Stay vouchers, guided experiences and travel credit. Gift a trip or book your own, with savings up to 15%."),
        h("button", { class: "btn accent lg", onclick: () => document.getElementById("trips")?.scrollIntoView() }, "See destinations"))),
    h("section", { class: "block", id: "trips" }, h("div", { class: "wrap" }, h("div", { class: "head" }, h("div", {}, h("h2", {}, "Destinations"), h("p", { class: "sub" }, "Stays and experiences across India and beyond"))),
      h("div", { class: "grid dest" }, ...trips.map((p) => card(p, "feed-middle"))))),
    section("Travel credit", grid(credit, "feed-top"), "Flights, hotels and rides on the apps you already use"),
  ];
}

function render() {
  const pages = { home: homePage, shop: shopPage, travel: travelPage };
  const open = document.activeElement?.closest?.(".search");
  $app.replaceChildren(header(), h("main", { id: "main" }, ...pages[page]()), footer());
  paintGrid();
  if (open) $app.querySelector<HTMLInputElement>(".search input")?.focus();
}

function paintGrid() {
  const g = document.getElementById("grid");
  if (!g) return;
  const list = shown();
  g.replaceChildren(...(list.length ? list.map((p) => card(p, "feed-bottom")) : [h("p", { class: "note" }, "Nothing matches that search.")]));
  const c = document.getElementById("count");
  if (c) c.textContent = `${list.length} shown`;
}

async function start() {
  try {
    const r = await api<{ items: Product[]; categories: string[] }>("GET", "/v1/shop/products");
    products = r.items; categories = r.categories;
    if (session) cart = (await api<{ items: CartItem[] }>("GET", "/v1/shop/cart").catch(() => ({ items: [] as CartItem[] }))).items;
  } catch {
    $app.replaceChildren(h("main", { id: "main", class: "wrap", style: "padding:64px 0" }, h("h1", {}, "The store is waking up"), h("p", { class: "lede" }, "Reload in a few seconds.")));
    return;
  }
  render();
  consentBanner();
}
void start();
