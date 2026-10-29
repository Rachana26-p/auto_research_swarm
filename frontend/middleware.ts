import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "https://kavuwirlqyrtupemcqnu.supabase.co";

  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    "sb_publishable_-bpWcKrwMhRhRcgPa9CqTg_rYK5f27q";

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // Refresh user session securely
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Public auth paths that bypass authentication
  const isAuthRoute =
    pathname === "/sign-in" ||
    pathname === "/sign-up" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname.startsWith("/auth/callback");

  const isPublicStatic =
    pathname === "/" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/health") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.svg" ||
    pathname === "/privacy" ||
    pathname === "/terms";

  if (isPublicStatic) {
    return response;
  }

  // 1. Unauthenticated users trying to access protected routes
  if (!user && !isAuthRoute) {
    // For API routes, return 401 JSON directly without HTML redirect
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Unauthorized: Active authentication session required" },
        { status: 401 }
      );
    }

    // Validate next as safe same-origin relative path (no open redirect)
    let safeNext = "/";
    if (pathname && pathname.startsWith("/") && !pathname.startsWith("//") && !pathname.includes("://") && !pathname.startsWith("/\\")) {
      safeNext = pathname;
    }

    const redirectUrl = new URL("/sign-in", request.url);
    if (safeNext !== "/") {
      redirectUrl.searchParams.set("next", safeNext);
    }
    return NextResponse.redirect(redirectUrl);
  }

  // 2. Authenticated users visiting sign-in / sign-up should redirect to dashboard
  if (user && isAuthRoute && !pathname.startsWith("/auth/callback")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
