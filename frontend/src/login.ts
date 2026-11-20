import { roleOf, supabase } from "./supabase";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const NEXT = { admin: "/", advertiser: "/advertiser.html" } as const;

// Already signed in with a role: go straight to that console.
void supabase.auth.getSession().then(({ data }) => {
  const role = roleOf(data.session?.user);
  if (role) location.replace(NEXT[role]);
});

$<HTMLFormElement>("f").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const btn = $<HTMLButtonElement>("b");
  btn.disabled = true;
  $("err").textContent = "";
  const { data, error } = await supabase.auth.signInWithPassword({ email: $<HTMLInputElement>("u").value.trim(), password: $<HTMLInputElement>("p").value });
  if (error || !data.user) {
    $("err").textContent = error?.message ?? "Sign in failed";
    btn.disabled = false;
    return;
  }
  const role = roleOf(data.user);
  if (!role) {
    await supabase.auth.signOut();
    $("err").textContent = "This account has no access to a console. Ask the project owner to give it a role.";
    btn.disabled = false;
    return;
  }
  location.replace(NEXT[role]);
});
