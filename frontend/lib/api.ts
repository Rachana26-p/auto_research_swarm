/**
 * Typed API Client Layer mirroring backend Pydantic models.
 * Enforces zero secrets on client bundle by proxying through Next.js route handlers.
 */

export interface RunCreateRequest {
  goal: string;
  max_pages?: number;
  max_tool_calls?: number;
  max_tokens?: number;
  max_wall_seconds?: number;
}

export type RunStatus = "pending" | "running" | "completed" | "interrupted" | "failed";

export interface RunResponse {
  id: string;
  goal: string;
  status: RunStatus;
  created_at: string;
  completed_at?: string | null;
  pages_processed: number;
  pages_persisted: number;
  pages_uncertain_count: number;
  pages_failed: number;
  tool_calls_made: number;
  tokens_used: number;
  wall_clock_seconds: number;
  error_message?: string | null;
}

export interface RunSummaryResponse {
  id: string;
  goal: string;
  status: RunStatus;
  created_at: string;
  pages_persisted: number;
  tokens_used: number;
}

export interface ReviewResponse {
  id: string;
  run_id: string;
  page_id: string;
  url: string;
  status: "pending" | "approved" | "rejected";
  validator_output: {
    verdict?: string;
    confidence?: number;
    faithfulness_notes?: string;
    relevance_notes?: string;
    safety_flags?: string[];
    validation_status?: string;
    validation_reasoning?: string;
    [key: string]: unknown;
  };
  created_at: string;
}

export interface ReviewActionResponse {
  review_id: string;
  run_id: string;
  status: string;
  message: string;
}

export interface KnowledgePageSummary {
  page_id: string;
  title: string;
  filename: string;
  size_bytes: number;
}

export interface KnowledgePageDetail {
  page_id: string;
  title: string;
  filename: string;
  content: string;
  metadata: Record<string, unknown>;
}

export interface GuardrailEventResponse {
  id: string;
  run_id: string;
  agent_name: string;
  event_type: string;
  decision: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface SSEEvent {
  run_id?: string;
  event_type: string;
  timestamp?: string;
  node?: string;
  status?: string;
  duration_ms?: number;
  error_message?: string | null;
  agent_text?: string;
  summary?: Record<string, unknown>;
  reason?: string;
  review_id?: string;
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const isServer = typeof window === "undefined";
  let url: string;
  if (isServer) {
    const base = process.env.BACKEND_SERVICE_URL || process.env.BACKEND_API_URL || "http://localhost:8000";
    const normalizedBase = base.endsWith("/") ? base : `${base}/`;
    const cleanPath = path.startsWith("/") ? path.slice(1) : path;
    url = new URL(cleanPath, normalizedBase).toString();
  } else {
    url = `/api${path.startsWith("/") ? path : `/${path}`}`;
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(options?.headers as Record<string, string>),
  };

  if (isServer) {
    const serverKey = process.env.BACKEND_API_KEY || process.env.API_KEY || "test-secret-key-12345";
    headers["X-API-Key"] = serverKey;
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let errorDetail = res.statusText;
    try {
      const errJson = await res.json();
      errorDetail = errJson.detail || errJson.error || JSON.stringify(errJson);
    } catch {
      // not json
    }
    throw new Error(`API Error (${res.status}): ${errorDetail}`);
  }

  return res.json() as Promise<T>;
}

export async function createRun(data: RunCreateRequest): Promise<RunResponse> {
  return request<RunResponse>("/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function getRuns(): Promise<RunSummaryResponse[]> {
  return request<RunSummaryResponse[]>("/runs", {
    method: "GET",
  });
}

export async function getRun(id: string): Promise<RunResponse> {
  return request<RunResponse>(`/runs/${id}`, {
    method: "GET",
  });
}

export function getEventsStreamUrl(runId: string): string {
  return `/api/runs/${runId}/events`;
}

export async function getReviews(): Promise<ReviewResponse[]> {
  return request<ReviewResponse[]>("/reviews", {
    method: "GET",
  });
}

export async function approveReview(reviewId: string): Promise<ReviewActionResponse> {
  return request<ReviewActionResponse>(`/reviews/${reviewId}/approve`, {
    method: "POST",
  });
}

export async function rejectReview(reviewId: string): Promise<ReviewActionResponse> {
  return request<ReviewActionResponse>(`/reviews/${reviewId}/reject`, {
    method: "POST",
  });
}

export async function getKnowledge(): Promise<KnowledgePageSummary[]> {
  return request<KnowledgePageSummary[]>("/knowledge", {
    method: "GET",
  });
}

export async function getKnowledgePage(pageId: string): Promise<KnowledgePageDetail> {
  return request<KnowledgePageDetail>(`/knowledge/${pageId}`, {
    method: "GET",
  });
}

export async function getGuardrailEvents(runId?: string): Promise<GuardrailEventResponse[]> {
  const query = runId ? `?run_id=${encodeURIComponent(runId)}` : "";
  return request<GuardrailEventResponse[]>(`/guardrail-events${query}`, {
    method: "GET",
  });
}
