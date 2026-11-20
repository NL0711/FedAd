import type { State } from "./background.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const send = <T = any>(m: object) => chrome.runtime.sendMessage(m) as Promise<T>;
const say = (t: string) => { $("msg").textContent = t; };

function render(s: State) {
  $("consent").hidden = s.consent;
  $("main").hidden = !s.consent;
  ($("agree") as HTMLInputElement).checked = s.consent;
  if (!s.consent) return;
  $("status").textContent = s.joined
    ? `Connected. ${s.views} links seen, ${s.taps} clicked. ${s.uploads} update${s.uploads === 1 ? "" : "s"} sent.`
    : "Connecting...";
  $("retry").hidden = s.joined;
  say(s.message);
}

$("agree").addEventListener("change", async (ev) => render(await send({ type: "consent", value: (ev.target as HTMLInputElement).checked })));
$("retry").addEventListener("click", async () => { say("Connecting..."); render(await send({ type: "retry" })); });
$("wipe").addEventListener("click", async () => {
  if (!confirm("Delete everything this extension stored on this device?")) return;
  render(await send({ type: "delete" }));
  say("Deleted.");
});

send<State>({ type: "state" }).then(render);
setInterval(() => send<State>({ type: "state" }).then(render).catch(() => {}), 2000);   // live counts while the popup is open
