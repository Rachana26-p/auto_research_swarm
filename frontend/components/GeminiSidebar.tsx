"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase, UserProject } from "@/lib/supabase";
import { deleteRun, getRuns, RunSummaryResponse, updateRun } from "@/lib/api";
import { ConfirmationModal } from "./ConfirmationModal";
import { FolderIcon, PencilIcon, SettingsIcon, TrashIcon } from "./Icons";

export function GeminiSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const [isOpen, setIsOpen] = useState(true);
  const [user, setUser] = useState<{ email?: string; id?: string; name?: string } | null>(null);
  const [runs, setRuns] = useState<RunSummaryResponse[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  // Projects state
  const [projects, setProjects] = useState<UserProject[]>([]);
  const [newProjectName, setNewProjectName] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // Modal confirmation state
  const [deleteTargetRunId, setDeleteTargetRunId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Load auth state
  useEffect(() => {
    const extractName = (usr: any) => {
      const meta = usr?.user_metadata;
      if (meta?.full_name) return meta.full_name;
      if (meta?.first_name) return `${meta.first_name} ${meta.last_name || ""}`.trim();
      const stored = typeof window !== "undefined" ? localStorage.getItem("swarm_user_name") : null;
      return stored || usr?.email || "Researcher";
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser({
          email: session.user.email,
          id: session.user.id,
          name: extractName(session.user),
        });
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser({
          email: session.user.email,
          id: session.user.id,
          name: extractName(session.user),
        });
      } else {
        setUser(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Load runs & projects
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const rList = await getRuns(user?.id);
        if (active) setRuns(rList);
      } catch {
        // non-fatal
      }
    })();

    // Load projects from local storage or supabase
    try {
      const storedProjects = localStorage.getItem("swarm_user_projects");
      if (storedProjects) {
        setProjects(JSON.parse(storedProjects));
      }
    } catch {
      // ignore
    }

    return () => {
      active = false;
    };
  }, [user]);

  const handleCreateProject = () => {
    const trimmed = newProjectName.trim();
    if (!trimmed) return;
    const newProj: UserProject = {
      id: Math.random().toString(36).substring(2, 9),
      name: trimmed,
      description: "Research project grouping",
      created_at: new Date().toISOString(),
    };
    const updated = [...projects, newProj];
    setProjects(updated);
    try {
      localStorage.setItem("swarm_user_projects", JSON.stringify(updated));
    } catch {}
    setNewProjectName("");
    setIsCreatingProject(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    router.push("/auth/login");
    router.refresh();
  };

  // Inline rename & delete state
  const [editingRunId, setEditingRunId] = useState<string | null>(null);
  const [editingGoal, setEditingGoal] = useState("");

  const handleStartRename = (r: RunSummaryResponse, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingRunId(r.id);
    setEditingGoal(r.goal);
  };

  const handleSaveRename = async (runId: string, e?: React.FormEvent | React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const trimmed = editingGoal.trim();
    if (!trimmed) {
      setEditingRunId(null);
      return;
    }
    try {
      await updateRun(runId, trimmed);
      setRuns((prev) =>
        prev.map((item) => (item.id === runId ? { ...item, goal: trimmed } : item))
      );
    } catch (err) {
      alert(`Rename failed: ${err instanceof Error ? err.message : "Error"}`);
    } finally {
      setEditingRunId(null);
    }
  };

  const handleDeleteRun = (runId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleteTargetRunId(runId);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTargetRunId) return;
    setIsDeleting(true);
    try {
      await deleteRun(deleteTargetRunId);
      setRuns((prev) => prev.filter((item) => item.id !== deleteTargetRunId));
      if (pathname === `/runs/${deleteTargetRunId}`) {
        router.push("/dashboard");
      }
    } catch (err) {
      alert(`Delete failed: ${err instanceof Error ? err.message : "Error"}`);
    } finally {
      setIsDeleting(false);
      setDeleteTargetRunId(null);
    }
  };

  // Group runs by date in useEffect to prevent Next.js prerendering unstable Date evaluation
  const [grouped, setGrouped] = useState<{ [key: string]: RunSummaryResponse[] }>({
    Today: [],
    Yesterday: [],
    "Previous 7 Days": [],
    Older: [],
  });

  useEffect(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const groups: { [key: string]: RunSummaryResponse[] } = {
      Today: [],
      Yesterday: [],
      "Previous 7 Days": [],
      Older: [],
    };

    const q = searchQuery.toLowerCase().trim();
    const filtered = q ? runs.filter((r) => r.goal.toLowerCase().includes(q)) : runs;

    filtered.forEach((r) => {
      const d = new Date(r.created_at);
      if (d >= today) {
        groups.Today.push(r);
      } else if (d >= yesterday) {
        groups.Yesterday.push(r);
      } else if (d >= sevenDaysAgo) {
        groups["Previous 7 Days"].push(r);
      } else {
        groups.Older.push(r);
      }
    });

    setGrouped(groups);
  }, [runs, searchQuery]);

  // Hide sidebar on public marketing landing page, legal, and auth pages
  if (pathname === "/" || pathname === "/privacy" || pathname === "/terms" || pathname?.startsWith("/auth")) {
    return null;
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 left-4 z-40 bg-[#0A0A0A] dark:bg-[#EDEEF2] text-[#FAFAFA] dark:text-[#0A0A0A] p-2.5 border-2 border-[#0A0A0A] dark:border-[#EDEEF2] font-mono text-xs shadow-[3px_3px_0px_0px_#FAFAFA] hover:bg-[#E63946] dark:hover:bg-[#FF5C6C] hover:text-[#FAFAFA] transition-colors cursor-pointer"
        title="Open Workspace Sidebar"
      >
        &#9776; Workspace
      </button>
    );
  }

  return (
    <>
      <aside className="w-72 shrink-0 border-r-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] h-[calc(100vh-65px)] sticky top-[65px] flex flex-col justify-between overflow-hidden z-30">
        {/* Top Header & Actions */}
        <div className="p-3.5 border-b-2 border-[#0A0A0A] dark:border-[#2C3142] space-y-3 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-[#E63946] inline-block" />
              <span className="font-['Space_Grotesk'] font-bold text-xs uppercase tracking-wider text-[#0A0A0A] dark:text-[#EDEEF2]">
                Workspace // Hub
              </span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-xs font-mono font-bold text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 hover:text-[#0A0A0A] dark:hover:text-[#EDEEF2] p-1 cursor-pointer"
              title="Collapse Sidebar"
            >
              &laquo;
            </button>
          </div>

          {/* New Chat / Run Button */}
          <Link
            href="/dashboard"
            className="flex items-center justify-center gap-2 w-full py-2.5 px-3 bg-[#0A0A0A] dark:bg-[#EDEEF2] text-[#FAFAFA] dark:text-[#0A0A0A] font-['Space_Grotesk'] font-bold text-xs uppercase tracking-wider hover:bg-[#E63946] dark:hover:bg-[#FF5C6C] hover:text-[#FAFAFA] transition-colors border-2 border-[#0A0A0A] dark:border-[#EDEEF2]"
          >
            <span>+</span>
            <span>New Research Chat</span>
          </Link>

          {/* Search Chats Input */}
          <div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search chats & runs..."
              className="w-full border-2 border-[#0A0A0A] dark:border-[#2C3142] p-2 text-xs font-mono bg-[#FFFFFF] dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2] placeholder-[#0A0A0A]/40 dark:placeholder-[#EDEEF2]/40 outline-none focus:border-[#E63946]"
            />
          </div>
        </div>

        {/* Scrollable Center: Projects & History */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-5 text-xs font-mono">
          {/* Projects Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] font-bold text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70 uppercase pb-1 border-b border-[#0A0A0A]/15 dark:border-[#2C3142]">
              <span>Projects</span>
              <button
                onClick={() => setIsCreatingProject(!isCreatingProject)}
                className="text-[#E63946] dark:text-[#FF5C6C] hover:underline font-bold cursor-pointer"
              >
                {isCreatingProject ? "Cancel" : "+ New"}
              </button>
            </div>

            {isCreatingProject && (
              <div className="p-2 border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FFFFFF] dark:bg-[#0C0D12] space-y-2">
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="Project name..."
                  className="w-full border border-[#0A0A0A] dark:border-[#2C3142] p-1.5 text-xs outline-none bg-transparent"
                />
                <button
                  onClick={handleCreateProject}
                  className="w-full py-1 bg-[#0A0A0A] text-[#FAFAFA] dark:bg-[#EDEEF2] dark:text-[#0A0A0A] font-bold text-[11px] uppercase hover:bg-[#E63946] dark:hover:bg-[#FF5C6C] hover:text-[#FAFAFA]"
                >
                  Create
                </button>
              </div>
            )}

            <div className="space-y-1">
              <button
                onClick={() => setSelectedProjectId(null)}
                className={`w-full text-left px-2 py-1.5 border text-[11px] transition-colors truncate cursor-pointer ${
                  selectedProjectId === null
                    ? "bg-[#0A0A0A] text-[#FAFAFA] dark:bg-[#EDEEF2] dark:text-[#0A0A0A] border-[#0A0A0A] dark:border-[#EDEEF2]"
                    : "bg-transparent text-[#0A0A0A] dark:text-[#EDEEF2] border-transparent hover:border-[#0A0A0A]/30"
                }`}
              >
                &bull; All Workspaces
              </button>
              {projects.map((proj) => (
                <button
                  key={proj.id}
                  onClick={() => setSelectedProjectId(proj.id)}
                  className={`w-full text-left px-2 py-1.5 border text-[11px] transition-colors truncate cursor-pointer flex items-center gap-1.5 ${
                    selectedProjectId === proj.id
                      ? "bg-[#0A0A0A] text-[#FAFAFA] dark:bg-[#EDEEF2] dark:text-[#0A0A0A] border-[#0A0A0A] dark:border-[#EDEEF2]"
                      : "bg-transparent text-[#0A0A0A] dark:text-[#EDEEF2] border-transparent hover:border-[#0A0A0A]/30"
                  }`}
                >
                  <FolderIcon size={12} className="shrink-0" />
                  <span className="truncate">{proj.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Recent Chats / Runs List */}
          <div className="space-y-3">
            <div className="text-[11px] font-bold text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70 uppercase pb-1 border-b border-[#0A0A0A]/15 dark:border-[#2C3142]">
              Recent Research Runs
            </div>

            {Object.entries(grouped).map(([timeLabel, groupRuns]) => {
              if (groupRuns.length === 0) return null;
              return (
                <div key={timeLabel} className="space-y-1">
                  <span className="text-[10px] text-[#0A0A0A]/50 dark:text-[#EDEEF2]/50 uppercase font-bold block px-1">
                    {timeLabel}
                  </span>
                  {groupRuns.slice(0, 10).map((r) => {
                    const isActive = pathname === `/runs/${r.id}`;
                    const isEditing = editingRunId === r.id;

                    if (isEditing) {
                      return (
                        <div
                          key={r.id}
                          className="p-1 border border-[#E63946] bg-[#FFFFFF] dark:bg-[#0C0D12] space-y-1.5"
                        >
                          <input
                            type="text"
                            value={editingGoal}
                            onChange={(e) => setEditingGoal(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveRename(r.id, e);
                              if (e.key === "Escape") setEditingRunId(null);
                            }}
                            autoFocus
                            className="w-full border border-[#0A0A0A] dark:border-[#2C3142] p-1 text-[11px] outline-none bg-transparent"
                          />
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={(e) => handleSaveRename(r.id, e)}
                              className="px-2 py-0.5 bg-[#0A0A0A] text-[#FAFAFA] dark:bg-[#EDEEF2] dark:text-[#0A0A0A] text-[10px] font-bold hover:bg-[#2A9D8F]"
                              title="Save title"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingRunId(null)}
                              className="px-2 py-0.5 border border-[#0A0A0A] text-[10px] hover:bg-[#E63946] hover:text-[#FAFAFA]"
                              title="Cancel"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={r.id}
                        className={`group relative flex items-center border text-[11px] transition-colors ${
                          isActive
                            ? "bg-[#E63946] text-[#FAFAFA] border-[#0A0A0A] font-bold"
                            : "bg-[#FFFFFF] dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2] border-[#0A0A0A]/20 dark:border-[#2C3142] hover:border-[#0A0A0A] hover:bg-[#FAFAFA] dark:hover:bg-[#14161E]"
                        }`}
                      >
                        <Link
                          href={`/runs/${r.id}`}
                          className="flex-1 px-2.5 py-1.5 truncate"
                          title={r.goal}
                        >
                          {r.goal}
                        </Link>

                        {/* Action buttons (Rename & Delete) */}
                        <div className="hidden group-hover:flex items-center gap-1 pr-1.5 shrink-0">
                          <button
                            onClick={(e) => handleStartRename(r, e)}
                            className="p-1 text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 hover:text-[#0A0A0A] dark:hover:text-[#EDEEF2] hover:bg-[#0A0A0A]/10 dark:hover:bg-[#EDEEF2]/10 transition-colors cursor-pointer"
                            title="Rename research chat"
                            aria-label="Rename research chat"
                          >
                            <PencilIcon size={12} />
                          </button>
                          <button
                            onClick={(e) => handleDeleteRun(r.id, e)}
                            className="p-1 text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 hover:text-[#E63946] dark:hover:text-[#FF5C6C] hover:bg-[#E63946]/10 transition-colors cursor-pointer"
                            title="Delete research chat"
                            aria-label="Delete research chat"
                          >
                            <TrashIcon size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {Object.values(grouped).every((list) => list.length === 0) && (
              <div className="text-[11px] text-[#0A0A0A]/50 dark:text-[#EDEEF2]/50 italic px-1">
                No previous research runs found.
              </div>
            )}
          </div>
        </div>

        {/* User Identity & Settings Footer */}
        <div className="p-3 border-t-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] shrink-0 font-mono text-xs space-y-2">
          <div className="flex items-center justify-between pb-1 border-b border-[#0A0A0A]/10 dark:border-[#2C3142]">
            <Link
              href="/settings"
              className="flex items-center gap-1.5 text-[11px] font-bold text-[#0A0A0A] dark:text-[#EDEEF2] hover:text-[#E63946] dark:hover:text-[#FF5C6C] transition-colors"
            >
              <SettingsIcon size={13} />
              <span>Settings</span>
            </Link>
            <span className="text-[10px] text-[#0A0A0A]/50 dark:text-[#EDEEF2]/50 font-mono">v1.2 // Swarm</span>
          </div>

          {user ? (
            <div className="flex items-center justify-between pt-0.5">
              <div className="truncate mr-2">
                <span className="block text-[9px] uppercase tracking-wider text-[#0A0A0A]/50 dark:text-[#EDEEF2]/50 font-bold">Researcher</span>
                <span className="font-bold text-[11px] text-[#0A0A0A] dark:text-[#EDEEF2] truncate block" title={user.email}>
                  {user.name || user.email}
                </span>
              </div>
              <button
                onClick={handleSignOut}
                className="px-2 py-1 border border-[#0A0A0A] dark:border-[#2C3142] text-[10px] font-bold bg-[#FFFFFF] dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2] hover:bg-[#E63946] dark:hover:bg-[#FF5C6C] hover:text-[#FAFAFA] transition-colors cursor-pointer uppercase"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between pt-0.5">
              <span className="text-[11px] text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70">Guest Identity</span>
              <Link
                href="/auth/login"
                className="px-2.5 py-1 bg-[#0A0A0A] dark:bg-[#EDEEF2] text-[#FAFAFA] dark:text-[#0A0A0A] text-[10px] font-bold uppercase hover:bg-[#E63946] dark:hover:bg-[#FF5C6C] hover:text-[#FAFAFA] transition-colors"
              >
                Sign In
              </Link>
            </div>
          )}
        </div>
      </aside>

      {/* Confirmation Modal for Run Deletion */}
      <ConfirmationModal
        isOpen={Boolean(deleteTargetRunId)}
        title="Delete Research Chat?"
        description="Are you sure you want to permanently delete this research chat? All isolated logs, generated synthesis artifacts, and validation records will be purged."
        confirmText="Delete Chat"
        cancelText="Cancel"
        variant="danger"
        loading={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTargetRunId(null)}
      />
    </>
  );
}
