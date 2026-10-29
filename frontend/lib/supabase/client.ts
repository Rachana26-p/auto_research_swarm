import { createBrowserClient } from "@supabase/ssr";

const FALLBACK_URL = "https://kavuwirlqyrtupemcqnu.supabase.co";
const FALLBACK_KEY = "sb_publishable_-bpWcKrwMhRhRcgPa9CqTg_rYK5f27q";

export function createClient() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    FALLBACK_URL;

  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    FALLBACK_KEY;

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
