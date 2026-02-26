"use client";

import { useEffect, useRef, useState } from "react";
import { FlaskConical, Plus, LogOut, Pencil, Check, X } from "lucide-react";
import { useSessionStore } from "@/store/sessionStore";
import { logout, getUsername } from "@/lib/auth";
import { updateNickname } from "@/lib/api";
import { useRouter } from "next/navigation";

interface Props {
  onNewSession: () => void;
  onSelectSession?: (id: string) => void;
}

// ── Inline nickname editor ─────────────────────────────────────────────

function NicknameEditor({
  sessionId,
  nickname,
  onSaved,
}: {
  sessionId: string;
  nickname: string;
  onSaved: (nick: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(nickname);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(nickname);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const save = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const trimmed = draft.trim() || nickname;
    try {
      await updateNickname(sessionId, trimmed);
      onSaved(trimmed);
    } catch {
      // ignore
    }
    setEditing(false);
  };

  const cancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditing(false);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") save();
    if (e.key === "Escape") { setEditing(false); }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1 w-full" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKey}
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
    );
  }

  return (
    <span className="flex items-center gap-1 min-w-0 group/name">
      <span className="text-xs font-medium truncate">{nickname || "Unnamed"}</span>
      <button
        onClick={startEdit}
        className="opacity-0 group-hover/name:opacity-100 text-gray-600 hover:text-gray-400 transition-opacity flex-shrink-0"
        title="Rename"
      >
        <Pencil size={9} />
      </button>
    </span>
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
          <div className="text-sm font-semibold text-white leading-tight">MDA</div>
          {username && (
            <div className="text-[10px] text-gray-500 truncate">{username}</div>
          )}
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
            {sessions.map((s) => {
              const isActive = s.session_id === sessionId;
              return (
                <button
                  key={s.session_id}
                  onClick={() => {
                    switchSession(s.session_id, s.work_dir);
                    onSelectSession?.(s.session_id);
                  }}
                  className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors group ${
                    isActive
                      ? "bg-gray-800 text-white"
                      : "text-gray-400 hover:bg-gray-800/60 hover:text-gray-200"
                  }`}
                >
                  {/* Active indicator */}
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        isActive ? "bg-blue-500" : "bg-transparent"
                      }`}
                    />
                    <NicknameEditor
                      sessionId={s.session_id}
                      nickname={s.nickname || s.work_dir.split("/").pop() || s.session_id.slice(0, 8)}
                      onSaved={(nick) => updateSessionNickname(s.session_id, nick)}
                    />
                  </div>
                  <div className="pl-3 text-[10px] text-gray-600 font-mono truncate">
                    {s.session_id.slice(0, 8)}…
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Logout */}
      <div className="px-3 py-3 border-t border-gray-800 flex-shrink-0">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-gray-500 hover:text-red-400 hover:bg-gray-800 transition-colors"
        >
          <LogOut size={13} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
