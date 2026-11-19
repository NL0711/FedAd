import { useEffect, useState } from "react";
import { Notice } from "../components";

interface Seen {
  n: number; t: number; method: string; path: string; ip: string | null; ua: string | null; lang: string | null;
  has_token: boolean; user: string | null; body: Record<string, unknown> | null;
}
interface Group { requests: number; fields: string[]; ips: string[] }
interface Payload { items: Seen[]; summary: { guest: Group; login: Group; account: Group }; accounts: number }

const KINDS = [
  { id: "guest", label: "Guest", color: "#1f8a4c" },
  { id: "login", label: "Login", color: "#b7791f" },
  { id: "account", label: "Signed in", color: "#c0392b" },
] as const;

const kindOf = (r: Seen) => (r.path === "/v1/shop/login" ? "login" : r.has_token ? "account" : "guest");

function device(ua: string | null): string {
  if (!ua) return "none";
  const m = ua.match(/\(([^)]+)\)/);
  const browser = /Brave|Edg|Chrome|Firefox|Safari/.exec(ua)?.[0] ?? "";
  return `${m ? m[1].split(";").slice(0, 2).join(";") : ua.slice(0, 30)} · ${browser}`;
}

export default function ServerView() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const tick = () =>
    fetch("/api/shop/seen")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then((d: Payload) => { setData(d); setErr(null); })
      .catch((e: Error) => setErr(e.message));
  useEffect(() => {
    tick();
    const t = window.setInterval(tick, 1200);
    return () => clearInterval(t);
  }, []);

  if (err && !data) return <Notice kind="error" title="Cannot reach the backend">{err}</Notice>;
  if (!data) return <p className="loading">Loading…</p>;
  const reset = () => fetch("/api/shop/reset", { method: "POST" }).then(tick);

  return (
    <>
      <div className="sv-head">
        <h2>Server view</h2>
        <button className="btn secondary" onClick={reset}>Clear</button>
      </div>
      <div className="sv-cols">
        {KINDS.map((k) => {
          const g = data.summary[k.id];
          return (
            <section className="card sv-col" key={k.id} style={{ borderTop: `8px solid ${k.color}` }}>
              <h3>{k.label}</h3>
              <div className="sv-n">{g.requests}</div>
              <div className="sv-chips">
                {g.fields.length ? g.fields.map((f) => (
                  <span key={f} className={"sv-chip" + (["email", "password", "session token", "cart and orders", "behaviour", "interest"].includes(f) ? " hot" : "")}>{f}</span>
                )) : <span className="sv-none">nothing yet</span>}
              </div>
            </section>
          );
        })}
      </div>
      <section className="card">
        <table className="sv-table">
          <thead><tr><th>Time</th><th>Who</th><th>Request</th><th>IP</th><th>Device</th><th>Body</th></tr></thead>
          <tbody>
            {data.items.slice(0, 40).map((r) => {
              const k = kindOf(r);
              const col = KINDS.find((x) => x.id === k)!.color;
              return (
                <tr key={r.n} style={{ boxShadow: `inset 6px 0 0 ${col}` }}>
                  <td className="num">{new Date(r.t * 1000).toLocaleTimeString()}</td>
                  <td>{r.user ?? (k === "login" ? "sending credentials" : "anonymous")}</td>
                  <td><b>{r.method}</b> {r.path.replace("/v1/shop", "")}</td>
                  <td>{r.ip}</td>
                  <td className="sv-ua">{device(r.ua)}</td>
                  <td className="sv-body">{r.body ? JSON.stringify(r.body) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
