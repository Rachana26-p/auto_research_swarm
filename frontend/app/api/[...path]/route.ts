import { NextRequest } from "next/server";

const BACKEND_URL = process.env.BACKEND_API_URL || "http://localhost:8000";
const API_KEY = process.env.BACKEND_API_KEY || process.env.API_KEY || "test-api-key";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const targetPath = "/" + path.join("/");
  const search = request.nextUrl.search;
  const targetUrl = `${BACKEND_URL}${targetPath}${search}`;

  const headers = new Headers();
  headers.set("X-API-Key", API_KEY);
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
  const targetPath = "/" + path.join("/");
  const search = request.nextUrl.search;
  const targetUrl = `${BACKEND_URL}${targetPath}${search}`;

  const bodyText = await request.text();
  const headers = new Headers();
  headers.set("X-API-Key", API_KEY);
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
