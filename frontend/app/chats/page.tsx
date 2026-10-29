"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button, StatusDot, SplitPaneLatexStudio, ConfirmationModal, AlertBanner } from "@/components";
import {
  ChatResponse,
  ChatSourceRecord,
  createChat,
  deleteChat,
  getChat,
  getChatSources,
  listChats,
} from "@/lib/api";
import { supabase } from "@/lib/supabase";

function ChatsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialChatId = searchParams.get("id");

  // Auth & Tenant state
  const [userId, setUserId] = useState<string | null>(null);

  // Chats list state
  const [chats, setChats] = useState<ChatResponse[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(initialChatId);
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingChats, setLoadingChats] = useState(true);

  // New Chat Form modal/drawer state
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatTitle, setNewChatTitle] = useState("");
  const [newChatQuery, setNewChatQuery] = useState("");
  const [creatingChat, setCreatingChat] = useState(false);

  // Active Chat Data state
  const [activeChat, setActiveChat] = useState<ChatResponse | null>(null);
  const [sources, setSources] = useState<ChatSourceRecord[]>([]);
  const [loadingActiveChat, setLoadingActiveChat] = useState(false);
  const [showLatexStudio, setShowLatexStudio] = useState(true);

  // Delete modal state
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Monitor user session
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id || null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id || null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Fetch list of chats
  const fetchChats = async () => {
    try {
      setLoadingChats(true);
      const data = await listChats(searchQuery || undefined);
      setChats(data);
      if (!activeChatId && data.length > 0) {
        setActiveChatId(data[0].id);
      }
    } catch (err) {
      console.error("Failed to load chats:", err);
    } finally {
      setLoadingChats(false);
    }
  };

  useEffect(() => {
    fetchChats();
  }, [searchQuery]);

  // Load details when activeChatId changes
  useEffect(() => {
    if (!activeChatId) {
      setActiveChat(null);
      setSources([]);
      return;
    }

    let active = true;
    (async () => {
      try {
        setLoadingActiveChat(true);
        const [c, s] = await Promise.all([
          getChat(activeChatId).catch(() => null),
          getChatSources(activeChatId).catch(() => []),
        ]);
        if (active) {
          setActiveChat(c);
          setSources(s);
        }
      } catch (err) {
        console.error("Failed to load active chat:", err);
      } finally {
        if (active) setLoadingActiveChat(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [activeChatId]);

  // Handle creating a new chat
  const handleCreateChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChatQuery.trim()) return;

    setCreatingChat(true);
    setErrorBanner(null);
    try {
      const created = await createChat({
        title: newChatTitle.trim() || undefined,
        query: newChatQuery.trim(),
        params: {
          max_pages: 5,
          max_sources: 5,
          min_pages: 1,
        },
      });
      setShowNewChatModal(false);
      setNewChatTitle("");
      setNewChatQuery("");
      await fetchChats();
      setActiveChatId(created.id);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "Failed to create chat");
    } finally {
      setCreatingChat(false);
    }
  };

  // Handle deleting a chat
  const handleDeleteChat = async () => {
    if (!deleteTargetId) return;
    setDeleting(true);
    try {
      await deleteChat(deleteTargetId);
      setDeleteTargetId(null);
      if (activeChatId === deleteTargetId) {
        setActiveChatId(null);
      }
      await fetchChats();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "Failed to delete chat");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b-2 border-[#0A0A0A] dark:border-[#2C3142] pb-4">
        <div>
          <div className="flex items-center gap-2 font-mono text-xs text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 uppercase tracking-widest">
            <span className="w-2.5 h-2.5 bg-[#E63946] inline-block" />
            <span>Isolated Research Workspaces</span>
          </div>
          <h1 className="font-['Archivo_Black'] text-3xl sm:text-4xl uppercase tracking-tight text-[#0A0A0A] dark:text-[#EDEEF2] mt-1">
            Research Chats &amp; LaTeX Studio
          </h1>
        </div>

        <Button
          size="md"
          variant="primary"
          onClick={() => setShowNewChatModal(true)}
        >
          + New Research Chat
        </Button>
      </div>

      {errorBanner && (
        <AlertBanner
          message={errorBanner}
          variant="error"
          onClose={() => setErrorBanner(null)}
        />
      )}

      {/* Main Workspace Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
        {/* SIDEBAR: Chats Navigation */}
        <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FFFFFF] dark:bg-[#101217] shadow-[3px_3px_0px_0px_#0A0A0A] dark:shadow-none flex flex-col h-[750px]">
          {/* Search Box */}
          <div className="p-3 border-b-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E]">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search research chats..."
              className="w-full px-3 py-1.5 border border-[#0A0A0A] dark:border-[#2C3142] bg-[#FFFFFF] dark:bg-[#0C0D12] font-mono text-xs text-[#0A0A0A] dark:text-[#EDEEF2] focus:outline-none focus:ring-1 focus:ring-[#E63946]"
            />
          </div>

          {/* Chats List */}
          <div className="flex-1 overflow-y-auto divide-y divide-[#0A0A0A]/10 dark:divide-[#2C3142]">
            {loadingChats ? (
              <div className="p-4 text-center font-mono text-xs text-[#0A0A0A]/50">
                Loading research chats...
              </div>
            ) : chats.length === 0 ? (
              <div className="p-6 text-center font-mono text-xs text-[#0A0A0A]/60 space-y-2">
                <p>No research chats found.</p>
                <Button size="sm" variant="outline" onClick={() => setShowNewChatModal(true)}>
                  Create First Chat
                </Button>
              </div>
            ) : (
              chats.map((c) => {
                const isSelected = c.id === activeChatId;
                return (
                  <div
                    key={c.id}
                    onClick={() => setActiveChatId(c.id)}
                    className={`p-3 cursor-pointer transition-all ${
                      isSelected
                        ? "bg-[#1D3557]/10 dark:bg-[#1D3557]/30 border-l-4 border-l-[#1D3557] dark:border-l-[#70B4FF]"
                        : "hover:bg-[#0A0A0A]/5 dark:hover:bg-[#FFFFFF]/5"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="truncate font-['Space_Grotesk'] font-bold text-xs uppercase text-[#0A0A0A] dark:text-[#EDEEF2]">
                        {c.title}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTargetId(c.id);
                        }}
                        className="text-[#0A0A0A]/40 dark:text-[#EDEEF2]/40 hover:text-[#E63946] text-xs font-mono"
                        title="Delete chat"
                      >
                        ✕
                      </button>
                    </div>

                    <p className="font-['Inter'] text-[11px] text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70 truncate mt-1">
                      {c.query}
                    </p>

                    <div className="flex items-center gap-2 mt-2 font-mono text-[10px] text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60">
                      <span className="capitalize">{c.status}</span>
                      <span>&bull;</span>
                      <span>{c.sources_count} sources</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* MAIN PANEL: Active Chat Studio & Split-Pane Editor */}
        <div className="lg:col-span-3 space-y-4">
          {activeChat ? (
            <>
              {/* Chat Overview Card */}
              <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FFFFFF] dark:bg-[#101217] p-5 shadow-[4px_4px_0px_0px_#0A0A0A] dark:shadow-none space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#0A0A0A]/10 dark:border-[#2C3142]">
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <StatusDot
                      status={
                        activeChat.status === "completed"
                          ? "completed"
                          : activeChat.status === "running"
                          ? "running"
                          : "pending"
                      }
                      size="sm"
                    />
                    <span className="font-bold uppercase text-[#0A0A0A] dark:text-[#EDEEF2]">
                      Stage: {activeChat.current_stage || "idle"}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setShowLatexStudio(!showLatexStudio)}
                      className="px-3 py-1 font-mono text-xs font-bold border border-[#0A0A0A] dark:border-[#2C3142] uppercase hover:bg-[#0A0A0A] hover:text-white transition-colors"
                    >
                      {showLatexStudio ? "Hide LaTeX Studio" : "Open LaTeX Studio"}
                    </button>
                  </div>
                </div>

                <div>
                  <h2 className="font-['Space_Grotesk'] font-bold text-xl uppercase text-[#0A0A0A] dark:text-[#EDEEF2]">
                    {activeChat.title}
                  </h2>
                  <p className="font-['Inter'] text-sm text-[#0A0A0A]/80 dark:text-[#EDEEF2]/80 mt-1">
                    {activeChat.query}
                  </p>
                </div>

                {/* Academic Sources Strip */}
                {sources.length > 0 && (
                  <div className="pt-2 border-t border-[#0A0A0A]/10 dark:border-[#2C3142]">
                    <div className="font-mono text-xs font-bold text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70 uppercase mb-2">
                      Academic Sources ({sources.length})
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {sources.slice(0, 4).map((s) => (
                        <div
                          key={s.id}
                          className="p-2 border border-[#0A0A0A]/20 dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] text-xs font-mono"
                        >
                          <div className="font-bold truncate text-[#1D3557] dark:text-[#70B4FF]">
                            {s.title}
                          </div>
                          <div className="text-[10px] text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 mt-0.5">
                            {s.authors[0] || "Et al."} &bull; {s.venue || "Academic Venue"} ({s.year || 2026})
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Split-Pane LaTeX Studio */}
              {showLatexStudio && (
                <SplitPaneLatexStudio
                  chatId={activeChat.id}
                  sources={sources}
                  onClose={() => setShowLatexStudio(false)}
                />
              )}
            </>
          ) : (
            <div className="border-2 border-dashed border-[#0A0A0A]/30 dark:border-[#2C3142] p-12 text-center font-mono text-xs text-[#0A0A0A]/60 space-y-3">
              <div className="text-3xl">🔭</div>
              <div className="font-bold uppercase text-sm text-[#0A0A0A] dark:text-[#EDEEF2]">
                No Research Chat Selected
              </div>
              <p>Select a chat from the left sidebar or launch a new autonomous research swarm inquiry.</p>
              <div className="pt-2">
                <Button size="sm" variant="primary" onClick={() => setShowNewChatModal(true)}>
                  + Launch New Research
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* New Chat Modal */}
      {showNewChatModal && (
        <div className="fixed inset-0 z-50 bg-[#0A0A0A]/60 flex items-center justify-center p-4">
          <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] w-full max-w-lg p-6 shadow-[8px_8px_0px_0px_#0A0A0A] dark:shadow-none space-y-4 font-mono">
            <div className="flex items-center justify-between border-b-2 border-[#0A0A0A] dark:border-[#2C3142] pb-3">
              <h3 className="font-['Archivo_Black'] text-lg uppercase text-[#0A0A0A] dark:text-[#EDEEF2]">
                New Research Chat
              </h3>
              <button
                onClick={() => setShowNewChatModal(false)}
                className="font-bold text-sm text-[#0A0A0A] dark:text-[#EDEEF2] hover:text-[#E63946]"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateChat} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase mb-1">
                  Chat Title (Optional)
                </label>
                <input
                  type="text"
                  value={newChatTitle}
                  onChange={(e) => setNewChatTitle(e.target.value)}
                  placeholder="e.g., Quantum Error Mitigation Survey"
                  className="w-full px-3 py-2 border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FFFFFF] dark:bg-[#0C0D12] text-xs text-[#0A0A0A] dark:text-[#EDEEF2] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase mb-1">
                  Research Query / Objective *
                </label>
                <textarea
                  rows={4}
                  required
                  value={newChatQuery}
                  onChange={(e) => setNewChatQuery(e.target.value)}
                  placeholder="Describe your research goal in detail (e.g. Conduct a comprehensive literature survey on scalable multi-agent reasoning frameworks with empirical evaluation)..."
                  className="w-full px-3 py-2 border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FFFFFF] dark:bg-[#0C0D12] text-xs text-[#0A0A0A] dark:text-[#EDEEF2] focus:outline-none resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#0A0A0A]/20">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowNewChatModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={creatingChat || !newChatQuery.trim()}
                >
                  {creatingChat ? "Starting Swarm..." : "Launch Research"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmationModal
        isOpen={Boolean(deleteTargetId)}
        title="Delete Research Chat"
        message="Are you sure you want to delete this research chat? All associated academic sources, paper drafts, and LaTeX versions will be cascade deleted."
        confirmLabel="Delete Permanently"
        variant="danger"
        isLoading={deleting}
        onConfirm={handleDeleteChat}
        onCancel={() => setDeleteTargetId(null)}
      />
    </div>
  );
}

export default function ChatsPage() {
  return (
    <Suspense fallback={<div className="p-8 font-mono text-xs">Loading Research Chats...</div>}>
      <ChatsContent />
    </Suspense>
  );
}
