// Supabase client for sign-in. The project URL and the PUBLISHABLE key are public by design (they ship in every web page that uses
// Supabase). They are read at build time from VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (Vercel: Settings > Environment
// Variables; locally: frontend/.env.local, see .env.example). Never put the secret key (sb_secret_...) in this project.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL || "https://ystailcfsejrtmivhulc.supabase.co";
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!key) throw new Error("VITE_SUPABASE_PUBLISHABLE_KEY is not set: add it to the build environment (see frontend/.env.example).");

export const supabase = createClient(url, key);

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
