// A spy on window.fetch: every request the page makes is recorded as it is sent (method, path, JSON body, whether a token
// was attached), so the app can show exactly what left the phone. It records the real request, not a description of it.

export type Kind = "guest" | "login" | "account" | "learn";

export interface Entry {
  n: number;
  t: number;
  method: string;
  path: string;
  token: boolean;
  body: Record<string, unknown> | null;
  status: number | null;
  kind: Kind;
}

const log: Entry[] = [];
const listeners = new Set<() => void>();
let seq = 0;
const notify = () => listeners.forEach((f) => f());

export const entries = () => log;
export const onLog = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};
export const clearLog = () => {
  log.length = 0;
  notify();
};

function kindOf(path: string, token: boolean): Kind {
  if (path.startsWith("/v1/shop/login")) return "login";
  if (/^\/v1\/(updates|register|model|schema|status)/.test(path)) return "learn";
  return token ? "account" : "guest";
}

let installed = false;
export function installSpy(): void {
  if (installed) return;
  installed = true;
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const token = !!(headers.Authorization || headers.authorization);
    let body: Record<string, unknown> | null = null;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
        if (body && typeof body.blob === "string") body = { ...body, blob: `<${Math.round((body.blob.length * 3) / 4)} bytes, noised model update>` };
      } catch {
        body = null;
      }
    }
    const path = u.pathname + u.search;
    if (u.origin !== location.origin || !path.startsWith("/v1/")) return real(input, init);    // pictures and the page itself are not logged
    const e: Entry = { n: ++seq, t: Date.now(), method: (init?.method ?? "GET").toUpperCase(), path, token, body, status: null, kind: kindOf(path, token) };
    log.unshift(e);
    if (log.length > 300) log.pop();
    notify();
    try {
      const r = await real(input, init);
      e.status = r.status;
      notify();
      return r;
    } catch (err) {
      e.status = 0;
      notify();
      throw err;
    }
  };
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  const data = text ? JSON.parse(text) : {};
  if (!r.ok) throw new HttpError(r.status, data.detail ?? `HTTP ${r.status}`);
  return data as T;
}

/** Short names for what a request carried. */
export function chips(e: Entry): string[] {
  const c: string[] = [];
  const b = e.body ?? {};
  if (e.kind === "learn") {
    if (e.path.startsWith("/v1/updates")) c.push("noised update", "device id");
    if (e.path.startsWith("/v1/register")) c.push("device id");
    return c;
  }
  if (e.token) c.push("token");
  if ("email" in b) c.push("email");
  if ("password" in b) c.push("password");
  if (/\/products\/[^/?]+/.test(e.path) || "product_id" in b) c.push("product");
  if (/category=/.test(e.path) || "category" in b) c.push("interest");
  if ("type" in b) c.push("behaviour");
  if (/cart|checkout|orders/.test(e.path)) c.push("cart");
  return [...new Set(c)];
}

export const shortPath = (p: string) => p.replace("/v1/shop", "").replace(/^\/v1/, "") || "/";
