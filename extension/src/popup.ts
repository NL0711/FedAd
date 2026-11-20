import type { State } from "./background.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const send = <T = any>(m: object) => chrome.runtime.sendMessage(m) as Promise<T>;
const say = (t: string) => { $("msg").textContent = t; };
let last: State | null = null;

function render(s: State) {
  last = s;
  $("consent").hidden = s.consent;
  $("main").hidden = !s.consent;
  ($("agree") as HTMLInputElement).checked = s.consent;
  if (!s.consent) return;
  $("status").textContent = s.joined
    ? `Connected. ${s.views} views, ${s.taps} taps on your sites. ${s.uploads} update${s.uploads === 1 ? "" : "s"} sent.`
    : "Connecting...";
  $("retry").hidden = s.joined;
  if (s.message) say(s.message);
  const sl = $("sites");
  sl.replaceChildren(...s.sites.map((o) => {
    const host = new URL(o).hostname, st = s.siteStats[host] ?? { views: 0, taps: 0 };
    const li = document.createElement("li");
    li.append(`${host}: ${st.views} views, ${st.taps} taps `);
    const b = document.createElement("button");
    b.className = "ghost"; b.textContent = "Remove";
    // Removing the browser's permission makes the background worker stop watching the site and delete what it recorded there.
    b.addEventListener("click", async () => { await chrome.permissions.remove({ origins: [o + "/*"] }); render(await send({ type: "state" })); });
    li.append(b);
    return li;
  }));
  if (!s.sites.length) sl.textContent = "No sites allowed yet.";
}

// Prefill the address box with the site in the current tab (the activeTab permission lets us read it while the popup is open).
chrome.tabs?.query({ active: true, currentWindow: true }).then((t) => {
  try { const u = new URL(t[0]?.url ?? ""); if (/^https?:$/.test(u.protocol)) ($("site") as HTMLInputElement).value = u.origin; } catch { /* not a web page */ }
}).catch(() => {});

$("agree").addEventListener("change", async (ev) => render(await send({ type: "consent", value: (ev.target as HTMLInputElement).checked })));
$("retry").addEventListener("click", async () => { say("Connecting..."); render(await send({ type: "retry" })); });

$("allow").addEventListener("click", async () => {
  let origin: string;
  try { const u = new URL(($("site") as HTMLInputElement).value.trim()); if (!/^https?:$/.test(u.protocol)) throw 0; origin = u.origin; }
  catch { return say("Enter a site address such as https://example.com"); }
  // The browser asks the user to grant access to exactly this site. This popup closes while the prompt is open, so the work after the
  // answer happens in the background worker (permissions.onAdded); the call below only makes the result show if the popup is still here.
  const granted = await chrome.permissions.request({ origins: [origin + "/*"] });
  if (!granted) return say("Access was not granted, so nothing is watched on that site.");
  render(await send({ type: "allowSite", origin }));
  say(`Now learning on ${new URL(origin).hostname}.`);
});

$("wipe").addEventListener("click", async () => {
  if (!confirm("Delete everything this extension stored and stop watching all sites?")) return;
  const before = last ?? await send<State>({ type: "state" });
  render(await send({ type: "delete" }));
  await chrome.permissions.remove({ origins: before.sites.map((o) => o + "/*") }).catch(() => {});
  say("Deleted.");
});

send<State>({ type: "state" }).then(render);
setInterval(() => send<State>({ type: "state" }).then(render).catch(() => {}), 2000);   // live counts while the popup is open
