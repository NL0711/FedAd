// Perks: demo gift-card and voucher store. Talks to the shop API (backend/src/fedad/web/shop.py). Nothing real is sold.
// Every product card carries data-fedad-cat and data-fedad-placement: that is all the FedAd browser extension reads.
import "./store.css";

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
  return h("button", {
    class: "card", "data-fedad-cat": p.category, "data-fedad-placement": placement, onclick: () => openProduct(p),
  }, pic, h("div", { class: "meta" }, h("div", { class: "nm" }, p.title), h("div", { class: "kd" }, `${p.kind} · ${p.category}`),
    h("div", { class: "pr" }, `From ${inr(sale(lo, p.off))}`)));
}

function shown(): Product[] {
  const q = query.trim().toLowerCase();
  return products.filter((p) => (filter === "All" || p.category === filter) && (!q || `${p.title} ${p.category} ${p.kind}`.toLowerCase().includes(q)));
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
    if (!session) { close(); openLogin(() => openProduct(p)); return; }
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

function openLogin(after?: () => void) {
  const email = h("input", { class: "field", type: "email", autocomplete: "email", placeholder: "you@example.com", id: "em" });
  const pw = h("input", { class: "field", type: "password", autocomplete: "current-password", id: "pw" });
  const err = h("div", { class: "err", role: "alert" });
  const go = h("button", { class: "btn accent block", onclick: async () => {
    try {
      const r = await api<Session>("POST", "/v1/shop/login", { email: email.value, password: pw.value });
      session = { token: r.token, email: r.email };
      localStorage.setItem(KEY, JSON.stringify(session));
      cart = (await api<{ items: CartItem[] }>("GET", "/v1/shop/cart")).items;
      close(); render(); after?.();
    } catch (e) { err.textContent = (e as Error).message; }
  } }, "Continue");
  const close = overlay(h("div", {}, h("h3", { style: "margin:0 0 6px;font-size:24px" }, "Sign in or create an account"),
    h("p", { class: "note" }, "New email addresses become accounts. Demo store: use a throwaway email and password."),
    h("label", { for: "em" }, "Email"), email, h("label", { for: "pw" }, "Password (4+ characters)"), pw, go, err), true);
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
            h("p", {}, `Order ${o.id}, ${inr(o.total)}.`), h("p", { class: "note" }, "Demo: no payment was taken and no voucher was issued."),
            h("button", { class: "btn block", onclick: close }, "Keep browsing"));
        } catch (e) { err.textContent = (e as Error).message; }
      } }, "Place order (demo, no payment)") : null, err);
  };
  paint();
  scrim.append(panel);
  document.body.append(scrim);
}

// ---- page ----------------------------------------------------------------------------------------------------------------
function render() {
  const counts = new Map<string, number>();
  for (const p of products) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const cartCount = cart.reduce((n, i) => n + i.qty, 0);
  const search = h("input", { type: "search", placeholder: "Search brands and vouchers", "aria-label": "Search", value: query });
  search.addEventListener("input", () => { query = search.value; paintGrid(); });
  const go = (c: string) => { filter = c; render(); document.getElementById("all")?.scrollIntoView(); };
  const pill = (c: string) => h("button", { class: "pill", "aria-pressed": String(filter === c), onclick: () => go(c) }, c);

  const heroPicks = products.filter((p) => p.photo).slice(0, 4);
  const popular = ["amz", "swig", "goa", "myn", "steam", "mmt", "nflx", "dec"].map((id) => products.find((p) => p.id === id)).filter(Boolean) as Product[];
  const deals = [...products].sort((a, b) => b.off - a.off).slice(0, 4);

  $app.replaceChildren(
    h("header", { class: "top" }, h("div", { class: "wrap" },
      h("a", { class: "logo", href: "/store.html" }, h("i"), "Perks"), h("div", { class: "search" }, search),
      h("nav", { class: "actions", "aria-label": "Account" },
        session ? h("button", { class: "btn ghost", onclick: async () => { await api("POST", "/v1/shop/logout").catch(() => {}); session = null; cart = []; localStorage.removeItem(KEY); render(); } }, `Sign out (${session.email.split("@")[0].slice(0, 10)})`)
                : h("button", { class: "btn ghost", onclick: () => openLogin() }, "Sign in"),
        h("button", { class: "btn", onclick: () => (session ? openCart() : openLogin(openCart)) }, "Cart", cartCount ? h("span", { class: "badge" }, String(cartCount)) : null)))),
    h("main", { id: "main" },
      h("section", { class: "hero" }, h("div", { class: "wrap" },
        h("div", {}, h("h1", {}, `Gift cards and vouchers from ${products.length} brands`),
          h("p", { class: "lede" }, "Shopping, food, travel and games, in rupee amounts from ₹250. Pick a brand, choose an amount, check out."),
          h("div", { class: "pills" }, ...["All", ...categories].map(pill))),
        h("div", { class: "hero-grid" }, ...heroPicks.map((p) => card(p, "banner"))))),
      h("section", { class: "block" }, h("div", { class: "wrap" }, h("h2", {}, "Shop by category"),
        h("div", { class: "cats" }, ...categories.map((c) => h("button", { class: "cat", onclick: () => go(c) }, h("b", {}, c), h("span", {}, `${counts.get(c)} vouchers`)))))),
      h("section", { class: "block" }, h("div", { class: "wrap" }, h("h2", {}, "Popular brands"), h("div", { class: "grid" }, ...popular.map((p) => card(p, "feed-top"))))),
      h("section", { class: "block" }, h("div", { class: "wrap" }, h("h2", {}, "Biggest discounts"), h("div", { class: "grid" }, ...deals.map((p) => card(p, "feed-middle"))))),
      h("section", { class: "block", id: "all" }, h("div", { class: "wrap" },
        h("div", { class: "head" }, h("h2", {}, filter === "All" ? "All vouchers" : filter), h("span", { class: "note", id: "count" })),
        h("div", { class: "grid", id: "grid" })))),
    h("footer", {}, h("div", { class: "wrap" }, h("span", {}, "Perks is a demo store for the FedAd project. Nothing here is real: no payments, no vouchers."), h("span", {}, "© FedAd demo"))),
  );
  paintGrid();
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
}
void start();
