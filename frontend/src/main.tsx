import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./admin.css";

// On a deployment the admin endpoints need a signed-in platform account. Not signed in: go to the login page.
// Locally the server needs no sign-in and this never triggers.
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
