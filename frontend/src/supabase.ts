// Supabase client for sign-in. The project URL and the PUBLISHABLE key are public by design (they ship in every web page that uses
// Supabase), so they live in the source. Never put the secret key (sb_secret_...) in this project.
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient("https://vtwufwokgahgogfdtcrq.supabase.co", "sb_publishable_lu9WO7QyhgtFfPSSokZhxw_cKHtX0qy");

export type Role = "admin" | "advertiser";

/** The role the backend will honour: only app_metadata counts (users cannot edit it), never user_metadata. */
export function roleOf(user: { app_metadata?: Record<string, unknown> } | null | undefined): Role | null {
  const r = user?.app_metadata?.role;
  return r === "admin" || r === "advertiser" ? r : null;
}

export async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function signOutAndGo() {
  await supabase.auth.signOut();
  location.replace("/login.html");
}
