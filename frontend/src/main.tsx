import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { accessToken } from "./supabase";
import "./styles.css";
import "./admin.css";

// Every /api request carries the signed-in user's Supabase token. Locally the backend needs no sign-in (localhost), so with no
// session the call still goes out and only a 403 sends the user to the login page.
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
  if (url.startsWith("/api")) {
    const token = await accessToken();
    if (token) init = { ...init, headers: { ...(init?.headers as Record<string, string>), Authorization: `Bearer ${token}` } };
  }
  return realFetch(input, init);
};

async function start() {
  const probe = await fetch("/api/live").catch(() => null);
  if (probe && probe.status === 403) {
    location.replace("/login.html");
    return;
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void start();
