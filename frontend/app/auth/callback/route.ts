import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/";

  // Validate next as safe same-origin relative path
  let safeNext = "/";
  if (next && next.startsWith("/") && !next.startsWith("//") && !next.includes("://") && !next.startsWith("/\\")) {
    safeNext = next;
  }

  if (code) {
    const cookieStore = await cookies();
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      "https://placeholder.supabase.co";

    const supabaseAnonKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      "placeholder-anon-key";

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Handled in middleware
          }
        },
      },
    });

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  // If code exchange failed or no code provided, redirect to sign-in with error
  return NextResponse.redirect(`${origin}/sign-in?error=auth_callback_failed`);
}
