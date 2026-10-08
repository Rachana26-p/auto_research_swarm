import { NextRequest } from "next/server";

function getBackendBaseUrl(): string {
  return process.env.BACKEND_SERVICE_URL || process.env.BACKEND_API_URL || "http://localhost:8000";
}

function getApiKey(): string {
  return process.env.BACKEND_API_KEY || process.env.API_KEY || "test-api-key";
}

function buildBackendUrl(path: string[], search: string): string {
  const base = getBackendBaseUrl();
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const relativePath = path.join("/").replace(/^\//, "");
  return new URL(`${relativePath}${search}`, normalizedBase).toString();
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const search = request.nextUrl.search;
  const targetUrl = buildBackendUrl(path, search);

  const headers = new Headers();
  headers.set("X-API-Key", getApiKey());
  headers.set("Accept", request.headers.get("Accept") || "application/json");

  try {
    const backendResp = await fetch(targetUrl, {
      method: "GET",
      headers,
    });

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
  const { path } = await params;
  const search = request.nextUrl.search;
  const targetUrl = buildBackendUrl(path, search);

  const bodyText = await request.text();
  const headers = new Headers();
  headers.set("X-API-Key", getApiKey());
  headers.set("Content-Type", "application/json");

  try {
    const backendResp = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: bodyText,
    });

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
