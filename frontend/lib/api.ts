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
  provider?: "gemini" | "groq";
  model?: string;
  user_id?: string;
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
  max_pages?: number;
  max_tokens?: number;
  max_tool_calls?: number;
  max_wall_seconds?: number;
  provider?: string;
  model?: string;
  user_id?: string;
}

export interface RunSummaryResponse {
  id: string;
  goal: string;
  status: RunStatus;
  created_at: string;
  pages_persisted: number;
  tokens_used: number;
  user_id?: string;
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
  pages_processed?: number;
  tool_calls_made?: number;
  tokens_used?: number;
  wall_clock_seconds?: number;
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
    let errorDetail = res.statusText || `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      const raw = errJson?.detail ?? errJson?.error ?? errJson?.message ?? errJson;
      if (typeof raw === "string") {
        errorDetail = raw;
      } else if (raw && typeof raw === "object") {
        errorDetail = (raw as Record<string, unknown>).message as string || JSON.stringify(raw);
      } else {
        errorDetail = JSON.stringify(errJson);
      }
    } catch {
      // not json, attempt text extraction
      try {
        const text = await res.text();
        if (text) errorDetail = text;
      } catch {
        // keep fallback
      }
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

export async function getRuns(userId?: string): Promise<RunSummaryResponse[]> {
  const qs = userId ? `?user_id=${encodeURIComponent(userId)}` : "";
  return request<RunSummaryResponse[]>(`/runs${qs}`, {
    method: "GET",
  });
}

export async function getRun(id: string): Promise<RunResponse> {
  return request<RunResponse>(`/runs/${id}`, {
    method: "GET",
  });
}

export async function redoRun(id: string): Promise<RunResponse> {
  return request<RunResponse>(`/runs/${id}/redo`, {
    method: "POST",
  });
}

export async function updateRun(id: string, goal: string): Promise<RunResponse> {
  return request<RunResponse>(`/runs/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal }),
  });
}

export async function deleteRun(id: string): Promise<void> {
  return request<void>(`/runs/${id}`, {
    method: "DELETE",
  });
}

export function getEventsStreamUrl(runId: string): string {
  return `/api/runs/${runId}/events`;
}

export async function getReviews(runId?: string, includeResolved = true): Promise<ReviewResponse[]> {
  const params = new URLSearchParams();
  if (runId) params.append("run_id", runId);
  if (includeResolved) params.append("include_resolved", "true");
  const qs = params.toString() ? `?${params.toString()}` : "";
  return request<ReviewResponse[]>(`/reviews${qs}`, {
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

export interface LatexResponse {
  run_id: string;
  latex_code: string;
  status: string;
  latex_path?: string | null;
}

export async function getRunLatex(runId: string): Promise<LatexResponse> {
  return request<LatexResponse>(`/runs/${runId}/latex`, {
    method: "GET",
  });
}

export async function updateRunLatex(runId: string, latexCode: string): Promise<LatexResponse> {
  return request<LatexResponse>(`/runs/${runId}/latex`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ latex_code: latexCode }),
  });
}

export async function compileRunPdf(runId: string, latexCode?: string): Promise<Blob> {
  const url = `/api/runs/${runId}/compile-pdf`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ latex_code: latexCode }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`PDF Compilation failed: ${errText}`);
  }
  return res.blob();
}

// ============================================================================
// CHATS & PAPER STUDIO API (WS2, WS5, WS6)
// ============================================================================

export interface ChatResponse {
  id: string;
  user_id: string;
  title: string;
  query: string;
  status: "draft" | "queued" | "pending" | "running" | "completed" | "completed_partial" | "failed" | "cancelled";
  current_stage: string;
  sources_count: number;
  created_at: string;
  updated_at: string;
}

export interface ChatCreateRequest {
  title?: string;
  query: string;
  params?: {
    max_pages?: number;
    max_tokens?: number;
    max_tool_calls?: number;
    max_wall_seconds?: number;
    max_sources?: number;
    min_pages?: number;
    provider?: string;
    model?: string;
  };
}

export interface ChatSourceRecord {
  id: string;
  chat_id: string;
  user_id: string;
  canonical_id: string;
  title: string;
  authors: string[];
  venue?: string;
  year?: number;
  url?: string;
  doi?: string;
  arxiv_id?: string;
  source_type?: string;
  evidence_level?: string;
  verdict?: "pass" | "fail" | "uncertain";
  confidence?: number;
  relevance_score?: number;
  safety_flags?: string[];
  markdown?: string;
  bib_key?: string;
  created_at: string;
}

export interface PaperRecord {
  id: string;
  chat_id: string;
  user_id: string;
  title: string;
  status: "draft" | "compiled" | "compile_failed" | "short_of_target";
  current_version: number;
  created_at: string;
  updated_at: string;
}

export interface PaperCompileError {
  file?: string;
  line?: number;
  error_type?: string;
  message: string;
  snippet?: string;
}

export interface PaperVersionRecord {
  id: string;
  paper_id: string;
  chat_id: string;
  user_id: string;
  version: number;
  tex_source: string;
  bib_source: string;
  created_by: "agent" | "user";
  compile_status: "pending" | "success" | "failed";
  page_count: number;
  storage_path?: string | null;
  compile_errors: PaperCompileError[];
  note?: string;
  created_at: string;
}

export interface PaperComposerOutput {
  paper_id: string;
  chat_id: string;
  version: number;
  title: string;
  tex_source: string;
  bib_source: string;
  cited_keys: string[];
  grounding_score: number;
  sections: string[];
  word_count: number;
  estimated_pages: number;
  validation_passed: boolean;
  warnings: string[];
}

export async function listChats(search?: string): Promise<ChatResponse[]> {
  const q = search ? `?search=${encodeURIComponent(search)}` : "";
  return request<ChatResponse[]>(`/chats${q}`, {
    method: "GET",
  });
}

export async function createChat(data: ChatCreateRequest): Promise<ChatResponse> {
  return request<ChatResponse>("/chats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function getChat(chatId: string): Promise<ChatResponse> {
  return request<ChatResponse>(`/chats/${chatId}`, {
    method: "GET",
  });
}

export async function deleteChat(chatId: string): Promise<void> {
  return request<void>(`/chats/${chatId}`, {
    method: "DELETE",
  });
}

export async function getChatSources(chatId: string): Promise<ChatSourceRecord[]> {
  return request<ChatSourceRecord[]>(`/chats/${chatId}/sources`, {
    method: "GET",
  });
}

export async function getChatPaper(chatId: string): Promise<PaperRecord> {
  return request<PaperRecord>(`/chats/${chatId}/paper`, {
    method: "GET",
  });
}

export async function getChatPaperVersions(chatId: string): Promise<PaperVersionRecord[]> {
  return request<PaperVersionRecord[]>(`/chats/${chatId}/paper/versions`, {
    method: "GET",
  });
}

export async function generateChatPaper(
  chatId: string,
  targetPages = 5,
  style = "IEEEtran"
): Promise<PaperComposerOutput> {
  return request<PaperComposerOutput>(`/chats/${chatId}/paper/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_pages: targetPages, style }),
  });
}

export async function updateChatPaperSource(
  chatId: string,
  texSource: string,
  bibSource = "",
  expectedVersion?: number,
  note = "",
  compileNow = false
): Promise<PaperVersionRecord> {
  return request<PaperVersionRecord>(`/chats/${chatId}/paper/source`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tex_source: texSource,
      bib_source: bibSource,
      expected_version: expectedVersion,
      note,
      compile_now: compileNow,
    }),
  });
}

export function getChatEventsStreamUrl(chatId: string): string {
  return `/api/chats/${chatId}/events`;
}
