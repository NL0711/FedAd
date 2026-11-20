import type { State } from "./background.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const send = <T = any>(m: object) => chrome.runtime.sendMessage(m) as Promise<T>;
const say = (t: string) => { $("msg").textContent = t; };

function render(s: State) {
  $("consent").hidden = s.consent;
  $("join").hidden = !s.consent || s.joined;
  $("main").hidden = !(s.consent && s.joined);
  if (!s.joined) return;
  $("status").textContent = `Joined (device #${s.deviceId}). Uploads so far: ${s.uploads}.${s.paused ? " Paused." : ""}`;
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
}

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
  say("Reading history, training, sending...");
  ($("go") as HTMLButtonElement).disabled = true;
  const r = await send({ type: "contribute", screenWidth: screen.width });
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
  render(await send({ type: "delete" }));
  ($("agree") as HTMLInputElement).checked = false;
  say("Deleted.");
});

// Some browsers (Firefox for Android at the time of writing) expose no history API to extensions. Say so instead of failing later.
const hasHistory = typeof chrome.history?.search === "function";
$("nohistory").hidden = hasHistory;
if (!hasHistory) { $("consent").hidden = true; $("join").hidden = true; $("main").hidden = true; }
else send<State>({ type: "state" }).then(render);
