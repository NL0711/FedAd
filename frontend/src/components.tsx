import { useEffect, useState, type ReactNode } from "react";

export function Card({ title, children, note }: { title?: string; children: ReactNode; note?: string }) {
  return (
    <section className="card">
      {title && <h3>{title}</h3>}
      {children}
      {note && <p className="note">{note}</p>}
    </section>
  );
}

export function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}

export function Notice({ kind = "info", title, children }: { kind?: "info" | "error" | "warn"; title?: string; children: ReactNode }) {
  return (
    <div className={`notice notice-${kind}`} role={kind === "error" ? "alert" : undefined}>
      {title && <strong>{title}</strong>}
      <div>{children}</div>
    </div>
  );
}

export interface Loaded<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
}

/** Loads once on mount. */
export function useLoad<T>(fn: () => Promise<T>): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ data: null, error: null, loading: true });
  useEffect(() => {
    let live = true;
    fn()
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((error) => live && setState({ data: null, error, loading: false }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return state;
}

export function Loading({ what }: { what: string }) {
  return <p className="loading">Loading {what}…</p>;
}
