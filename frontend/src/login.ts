const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

$<HTMLFormElement>("f").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const btn = $<HTMLButtonElement>("b");
  btn.disabled = true;
  $("err").textContent = "";
  try {
    const r = await fetch("/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ username: $<HTMLInputElement>("u").value, password: $<HTMLInputElement>("p").value }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.detail ?? "Sign in failed");
    location.replace(body.next);
  } catch (e) {
    $("err").textContent = (e as Error).message;
    btn.disabled = false;
  }
});
