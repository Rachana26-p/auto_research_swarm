import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

function getBackendBaseUrl(): string {
  return process.env.BACKEND_SERVICE_URL || process.env.BACKEND_API_URL || "http://localhost:8000";
}

function getApiKey(): string {
  return process.env.BACKEND_API_KEY || process.env.API_KEY || "test-api-key";
}

function buildBackendUrl(path: string[] | undefined, search: string): string {
  let base = getBackendBaseUrl().trim();
  if (!base.startsWith("http://") && !base.startsWith("https://")) {
    base = `https://${base}`;
  }
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const relativePath = Array.isArray(path) ? path.join("/").replace(/^\//, "") : "";
  return new URL(`${relativePath}${search || ""}`, normalizedBase).toString();
}

async function getAuthHeaders(request: NextRequest, path: string[] | undefined): Promise<{ headers: Headers; unauthorized: boolean }> {
  const headers = new Headers();
  const pathStr = Array.isArray(path) ? path.join("/") : "";

  // Public unauthenticated routes
  const isPublicRoute =
    pathStr.startsWith("health") ||
    pathStr.startsWith("auth/precheck");

  // 1. Check incoming request Authorization header
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    headers.set("Authorization", authHeader);
    return { headers, unauthorized: false };
  }

  // 2. Check incoming request X-API-Key header
  const apiKeyHeader = request.headers.get("x-api-key");
  if (apiKeyHeader) {
    headers.set("X-API-Key", apiKeyHeader);
    return { headers, unauthorized: false };
  }

  // 3. Check Supabase browser cookies session
  try {
    const cookieStore = await cookies();
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
          return cookieStore.getAll();
        },
        setAll() {},
      },
    });

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session?.access_token) {
      headers.set("Authorization", `Bearer ${session.access_token}`);
      return { headers, unauthorized: false };
    }
  } catch {
    // Cookie reading fallback
  }

  // 4. Server-to-server fallback with configured backend API key
  const serverApiKey = getApiKey();
  if (serverApiKey) {
    headers.set("X-API-Key", serverApiKey);
    return { headers, unauthorized: false };
  }

  if (isPublicRoute) {
    return { headers, unauthorized: false };
  }

  return { headers, unauthorized: true };
}

async function checkDirectSupabaseHealth(): Promise<Response> {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "https://kavuwirlqyrtupemcqnu.supabase.co";

  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    "sb_publishable_-bpWcKrwMhRhRcgPa9CqTg_rYK5f27q";

  if (!supabaseAnonKey || supabaseUrl.includes("placeholder")) {
    return new Response(
      JSON.stringify({ status: "ok", db: "reachable", auth: "reachable", note: "fallback" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const headers: Record<string, string> = { apikey: supabaseAnonKey };
    const [dbRes, authRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/`, { headers, method: "GET" }).catch(() => null),
      fetch(`${supabaseUrl}/auth/v1/health`, { headers, method: "GET" }).catch(() => null),
    ]);

    const dbReachable = dbRes && [200, 401, 404].includes(dbRes.status);
    const authReachable = authRes && [200, 401, 404].includes(authRes.status);

    if (dbReachable && authReachable) {
      return new Response(
        JSON.stringify({ status: "ok", db: "reachable", auth: "reachable" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        status: "degraded",
        db: dbReachable ? "reachable" : "unreachable",
        auth: authReachable ? "reachable" : "unreachable",
      }),
      { status: 503, headers: { "Content-Type": "application/json", "Retry-After": "15" } }
    );
  } catch {
    return new Response(
      JSON.stringify({ status: "degraded", db: "unreachable", auth: "unreachable" }),
      { status: 503, headers: { "Content-Type": "application/json", "Retry-After": "15" } }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    const pathStr = Array.isArray(path) ? path.join("/") : "";
    const { headers, unauthorized } = await getAuthHeaders(request, path);

    if (unauthorized) {
      return new Response(JSON.stringify({ error: "Unauthorized: Active session required" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const search = request.nextUrl.search;
    const targetUrl = buildBackendUrl(path, search);
    headers.set("Accept", request.headers.get("Accept") || "application/json");

    let backendResp: Response;
    try {
      backendResp = await fetch(targetUrl, {
        method: "GET",
        headers,
      });
    } catch (fetchErr) {
      if (pathStr === "health/deep" || pathStr === "health") {
        return await checkDirectSupabaseHealth();
      }
      throw fetchErr;
    }

    if (pathStr === "health/deep" && backendResp.status === 503) {
      const directHealth = await checkDirectSupabaseHealth();
      if (directHealth.status === 200) {
        return directHealth;
      }
    }

    if (backendResp.headers.get("content-type")?.includes("text/event-stream")) {
      return new Response(backendResp.body, {
        status: backendResp.status,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    const data = await backendResp.text();
    return new Response(data, {
      status: backendResp.status,
      headers: {
        "Content-Type": backendResp.headers.get("content-type") || "application/json",
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: `Backend unavailable: ${error instanceof Error ? error.message : "Unknown error"}` }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    const { headers, unauthorized } = await getAuthHeaders(request, path);

    if (unauthorized) {
      return new Response(JSON.stringify({ error: "Unauthorized: Active session required" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const search = request.nextUrl.search;
    const targetUrl = buildBackendUrl(path, search);

    const bodyText = await request.text();
    headers.set("Content-Type", "application/json");

    const backendResp = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: bodyText,
    });

    const contentType = backendResp.headers.get("content-type") || "application/json";
    if (contentType.includes("application/pdf") || contentType.includes("octet-stream")) {
      const buffer = await backendResp.arrayBuffer();
      return new Response(buffer, {
        status: backendResp.status,
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": backendResp.headers.get("content-disposition") || "inline",
        },
      });
    }

    const data = await backendResp.text();
    return new Response(data, {
      status: backendResp.status,
      headers: {
        "Content-Type": contentType,
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: `Backend unavailable: ${error instanceof Error ? error.message : "Unknown error"}` }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    const { headers, unauthorized } = await getAuthHeaders(request, path);

    if (unauthorized) {
      return new Response(JSON.stringify({ error: "Unauthorized: Active session required" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const search = request.nextUrl.search;
    const targetUrl = buildBackendUrl(path, search);

    const bodyText = await request.text();
    headers.set("Content-Type", "application/json");

    const backendResp = await fetch(targetUrl, {
      method: "PATCH",
      headers,
      body: bodyText,
    });

    const contentType = backendResp.headers.get("content-type") || "application/json";
    const data = await backendResp.text();
    return new Response(data, {
      status: backendResp.status,
      headers: { "Content-Type": contentType },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: `Backend unavailable: ${error instanceof Error ? error.message : "Unknown error"}` }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    const { headers, unauthorized } = await getAuthHeaders(request, path);

    if (unauthorized) {
      return new Response(JSON.stringify({ error: "Unauthorized: Active session required" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const search = request.nextUrl.search;
    const targetUrl = buildBackendUrl(path, search);

    const bodyText = await request.text();
    headers.set("Content-Type", "application/json");

    const backendResp = await fetch(targetUrl, {
      method: "PUT",
      headers,
      body: bodyText,
    });

    const contentType = backendResp.headers.get("content-type") || "application/json";
    const data = await backendResp.text();
    return new Response(data, {
      status: backendResp.status,
      headers: { "Content-Type": contentType },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: `Backend unavailable: ${error instanceof Error ? error.message : "Unknown error"}` }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    const { headers, unauthorized } = await getAuthHeaders(request, path);

    if (unauthorized) {
      return new Response(JSON.stringify({ error: "Unauthorized: Active session required" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const search = request.nextUrl.search;
    const targetUrl = buildBackendUrl(path, search);

    const backendResp = await fetch(targetUrl, {
      method: "DELETE",
      headers,
    });

    const contentType = backendResp.headers.get("content-type") || "application/json";
    const data = await backendResp.text();
    return new Response(data, {
      status: backendResp.status,
      headers: { "Content-Type": contentType },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: `Backend unavailable: ${error instanceof Error ? error.message : "Unknown error"}` }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}
