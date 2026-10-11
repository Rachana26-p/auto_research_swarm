import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  // Enforce HTTPS in production environments
  const proto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("host") || "";

  if (
    process.env.NODE_ENV === "production" &&
    proto === "http" &&
    !host.includes("localhost") &&
    !host.includes("127.0.0.1")
  ) {
    return NextResponse.redirect(`https://${host}${request.nextUrl.pathname}${request.nextUrl.search}`, 301);
  }

  const response = NextResponse.next();

  // Basic security headers
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg).*)",
  ],
};
