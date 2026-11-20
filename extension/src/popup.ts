import type { State } from "./background.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const send = <T = any>(m: object) => chrome.runtime.sendMessage(m) as Promise<T>;
const say = (t: string) => { $("msg").textContent = t; };

function render(s: State) {
  $("consent").hidden = s.consent;
  $("join").hidden = !s.consent || s.joined;
  $("main").hidden = !(s.consent && s.joined);
  if (!s.joined) return;
  $("status").textContent = `Joined (device #${s.deviceId}). Seen on the shop: ${s.views} views, ${s.taps} taps. Uploads so far: ${s.uploads}.${s.paused ? " Paused." : ""}`;
  $("pause").textContent = s.paused ? "Resume" : "Pause";
  ($("go") as HTMLButtonElement).disabled = s.paused;
  ($("ceiling") as HTMLInputElement).value = String(s.ceiling);
  const ul = $("log");
  ul.replaceChildren(...s.log.map((e) => {
    const li = document.createElement("li");
    if (e.kind === "profile") { li.textContent = `${new Date(e.t).toLocaleString()}: noised profile (${e.bytes} B) sent with email ${e.email}`; return li; }
    const cats = Object.entries(e.categories).map(([k, v]) => `${k} ${v}`).join(", ");
    li.textContent = `${new Date(e.t).toLocaleString()}: ${e.bytes} B update, ${e.n} visits (${cats}), eps ${e.eps.toFixed(0)}, checksum ${e.checksum.toString(16)}`;
    return li;
  }));
  if (!s.log.length) ul.textContent = "Nothing sent yet.";
  const sl = $("sites");
  sl.replaceChildren(...s.sites.map((o) => {
    const li = document.createElement("li");
    const st = s.siteStats[new URL(o).hostname] ?? { views: 0, taps: 0 };
    li.append(`${new URL(o).hostname}: ${st.views} views, ${st.taps} taps `);
    const b = document.createElement("button");
    b.className = "ghost"; b.textContent = "Remove";
    b.addEventListener("click", async () => {
      const r = await send({ type: "forgetSite", origin: o });
      await chrome.permissions.remove({ origins: [o + "/*"] }).catch(() => {});
      r.error ? say(r.error) : render(r);
    });
    li.append(b);
    return li;
  }));
  if (!s.sites.length) sl.textContent = "No extra sites allowed yet.";
}

// Prefill the address box with the site in the current tab (the activeTab permission lets us read it while the popup is open).
chrome.tabs?.query({ active: true, currentWindow: true }).then((t) => {
  try { const u = new URL(t[0]?.url ?? ""); if (/^https?:$/.test(u.protocol)) ($("site") as HTMLInputElement).value = u.origin; } catch { /* not a web page */ }
}).catch(() => {});

$("allow").addEventListener("click", async () => {
  let origin: string;
  try { const u = new URL(($("site") as HTMLInputElement).value.trim()); if (!/^https?:$/.test(u.protocol)) throw 0; origin = u.origin; }
  catch { return say("Enter a site address such as https://example.com"); }
  // The browser asks the user to grant access to exactly this one site (user gesture required).
  const granted = await chrome.permissions.request({ origins: [origin + "/*"] });
  if (!granted) return say("Access to that site was not granted, so nothing is watched there.");
  const r = await send({ type: "allowSite", origin });
  if (r.error) return say(r.error);
  say(`Now learning on ${new URL(origin).hostname}. Reload its tabs to start.`);
  render(r);
});

$("agree").addEventListener("change", async (ev) => render(await send({ type: "consent", value: (ev.target as HTMLInputElement).checked })));

$("joinBtn").addEventListener("click", async () => {
  const base = ($("base") as HTMLInputElement).value.trim().replace(/\/+$/, "");
  const code = ($("code") as HTMLInputElement).value.trim();
  if (!/^https?:\/\//.test(base)) return say("Enter the server address starting with http:// or https://");
  // Ask the browser for access to exactly this server, nothing else (user gesture required).
  const granted = await chrome.permissions.request({ origins: [new URL(base).origin + "/*"] });
  if (!granted) return say("Permission to contact that server was not granted.");
  const r = await send({ type: "join", base, code });
  if (r.error) return say(r.error);
  render(r);
});

$("go").addEventListener("click", async () => {
  say("Training and sending...");
  ($("go") as HTMLButtonElement).disabled = true;
  const r = await send({ type: "contribute" });
  say(r.error ?? r.message);
  render(await send({ type: "state" }));
});

$("agree2").addEventListener("change", (ev) => { ($("share") as HTMLButtonElement).disabled = !(ev.target as HTMLInputElement).checked; });
$("share").addEventListener("click", async () => {
  say("Building profile, adding noise, sending...");
  const r = await send({ type: "profile", email: ($("email") as HTMLInputElement).value });
  say(r.error ?? r.message);
  render(await send({ type: "state" }));
});

$("pause").addEventListener("click", async () => {
  const s: State = await send({ type: "state" });
  render(await send({ type: "pause", value: !s.paused }));
});
$("ceiling").addEventListener("change", async (ev) => render(await send({ type: "ceiling", value: (ev.target as HTMLInputElement).value })));
$("wipe").addEventListener("click", async () => {
  if (!confirm("Delete the stored token, settings and log, and leave the campaign?")) return;
  const before: State = await send({ type: "state" });
  render(await send({ type: "delete" }));
  await chrome.permissions.remove({ origins: [...before.sites, before.base].filter(Boolean).map((o) => new URL(o).origin + "/*") }).catch(() => {});
  ($("agree") as HTMLInputElement).checked = false;
  say("Deleted.");
});

send<State>({ type: "state" }).then(render);
