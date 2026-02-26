"use client";

import { useEffect, useRef, useState } from "react";
import { FlaskConical, Plus, LogOut, Pencil, Check, X, Settings } from "lucide-react";
import { useSessionStore } from "@/store/sessionStore";
import { logout, getUsername } from "@/lib/auth";
import { updateNickname } from "@/lib/api";
import { useRouter } from "next/navigation";

interface Props {
  onNewSession: () => void;
  onSelectSession?: (id: string) => void;
}

// ── Session list item ──────────────────────────────────────────────────

function SessionItem({
  s,
  isActive,
  onSelect,
  onSaved,
}: {
  s: { session_id: string; work_dir: string; nickname: string };
  isActive: boolean;
  onSelect: () => void;
  onSaved: (nick: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const nick = s.nickname || s.work_dir.split("/").pop() || s.session_id.slice(0, 8);
  const [draft, setDraft] = useState(nick);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(nick);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const save = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const trimmed = draft.trim() || nick;
    try {
      await updateNickname(s.session_id, trimmed);
      onSaved(trimmed);
    } catch { /* ignore */ }
    setEditing(false);
  };

  const cancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditing(false);
  };

  return (
    <div
      onClick={() => !editing && onSelect()}
      className={`group relative w-full rounded-lg transition-colors cursor-pointer ${
        isActive ? "bg-gray-800 text-white" : "text-gray-400 hover:bg-gray-800/60 hover:text-gray-200"
      }`}
    >
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isActive ? "bg-blue-500" : "bg-transparent"}`} />
          {editing ? (
            <div className="flex items-center gap-1 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") save();
                  if (e.key === "Escape") setEditing(false);
                }}
                autoFocus
                className="flex-1 min-w-0 text-xs bg-gray-700 border border-gray-600 rounded px-1.5 py-0.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button onClick={save} className="text-emerald-400 hover:text-emerald-300 flex-shrink-0">
                <Check size={11} />
              </button>
              <button onClick={cancel} className="text-gray-500 hover:text-gray-400 flex-shrink-0">
                <X size={11} />
              </button>
            </div>
          ) : (
            <>
              <span className="text-xs font-medium truncate flex-1">{nick}</span>
              <button
                onClick={startEdit}
                className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-gray-300 transition-opacity flex-shrink-0"
                title="Rename"
              >
                <Pencil size={10} />
              </button>
            </>
          )}
        </div>
        {!editing && (
          <div className="pl-3 text-[10px] text-gray-600 font-mono truncate">{s.session_id.slice(0, 8)}…</div>
        )}
      </div>
    </div>
  );
}

// ── Profile section ────────────────────────────────────────────────────

function ProfileSection({ username, onLogout }: { username: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const initial = username ? username[0].toUpperCase() : "?";

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative px-3 py-3 border-t border-gray-800 flex-shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-gray-800 transition-colors group"
      >
        {/* Avatar */}
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center flex-shrink-0 text-white text-xs font-semibold shadow">
          {initial}
        </div>
        {/* Name */}
        <span className="flex-1 text-left text-xs font-medium text-gray-300 truncate group-hover:text-white transition-colors">
          {username}
        </span>
        {/* Dots */}
        <Settings size={12} className="text-gray-600 group-hover:text-gray-400 flex-shrink-0 transition-colors" />
      </button>

      {/* Popover menu */}
      {open && (
        <div className="absolute bottom-full left-3 right-3 mb-1 bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden z-50">
          {/* User info header */}
          <div className="flex items-center gap-2.5 px-3 py-3 border-b border-gray-700">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center flex-shrink-0 text-white text-sm font-semibold shadow">
              {initial}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-white truncate">{username}</div>
              <div className="text-[10px] text-gray-500">Signed in</div>
            </div>
          </div>
          {/* Actions */}
          <button
            onClick={() => { setOpen(false); onLogout(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-gray-400 hover:text-red-400 hover:bg-gray-700/60 transition-colors"
          >
            <LogOut size={13} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main sidebar ───────────────────────────────────────────────────────

export default function SessionSidebar({ onNewSession, onSelectSession }: Props) {
  const router = useRouter();
  const { sessions, sessionId, fetchSessions, switchSession, updateSessionNickname } =
    useSessionStore();
  const username = getUsername();

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  return (
    <aside className="w-56 flex-shrink-0 bg-gray-950 border-r border-gray-800 flex flex-col h-full">
      {/* Brand */}
      <div className="px-4 py-4 border-b border-gray-800 flex items-center gap-2.5 flex-shrink-0">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow">
          <FlaskConical size={14} className="text-white" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white leading-tight">AMD</div>
          <div className="text-[10px] text-gray-500">Ahn MD</div>
        </div>
      </div>

      {/* New session button */}
      <div className="px-3 py-2.5 flex-shrink-0">
        <button
          onClick={onNewSession}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-gray-800 hover:text-white transition-colors border border-gray-800 hover:border-gray-700"
        >
          <Plus size={13} />
          <span className="text-xs font-medium">New Session</span>
        </button>
      </div>

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {sessions.length === 0 ? (
          <p className="text-[11px] text-gray-600 px-3 py-2">No sessions yet</p>
        ) : (
          <div className="space-y-0.5">
            {sessions.map((s) => (
              <SessionItem
                key={s.session_id}
                s={s}
                isActive={s.session_id === sessionId}
                onSelect={() => { switchSession(s.session_id, s.work_dir); onSelectSession?.(s.session_id); }}
                onSaved={(nick) => updateSessionNickname(s.session_id, nick)}
              />
            ))}
          </div>
        )}
      </div>

      <ProfileSection username={username ?? "user"} onLogout={handleLogout} />
    </aside>
  );
}
