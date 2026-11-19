import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./admin.css";

// On a deployment the admin endpoints need a key (FEDAD_ADMIN_KEY on the server). Ask once per browser session and send it
// with every /api request. Locally the server needs no key and this never shows.
const KEY = "fedad.adminKey";
const realFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
  const key = sessionStorage.getItem(KEY);
  if (key && url.startsWith("/api")) init = { ...init, headers: { ...(init?.headers as Record<string, string>), "X-Admin-Key": key } };
  return realFetch(input, init);
};

async function start() {
  const probe = await fetch("/api/live").catch(() => null);
  if (probe && probe.status === 403) {
    const k = window.prompt("Admin key");
    if (k) {
      sessionStorage.setItem(KEY, k);
      location.reload();
      return;
    }
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void start();
