"use client";

import { useEffect, useRef, useState } from "react";
import { FlaskConical, Plus, LogOut, Pencil, Check, X, Settings, Trash2, Info, Eye, EyeOff } from "lucide-react";
import { useSessionStore } from "@/store/sessionStore";
import { logout, getUsername } from "@/lib/auth";
import { updateNickname, restoreSession, deleteSession, getApiKeys, setApiKey } from "@/lib/api";
import { useRouter } from "next/navigation";

interface Props {
  onNewSession: () => void;
  onSelectSession?: (id: string) => void;
  onSessionDeleted?: (id: string) => void;
}

// ── Session list item ──────────────────────────────────────────────────

function SessionItem({
  s,
  isActive,
  onSelect,
  onSaved,
  onDeleted,
}: {
  s: { session_id: string; work_dir: string; nickname: string };
  isActive: boolean;
  onSelect: () => void;
  onSaved: (nick: string) => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
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

  const startConfirm = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirming(true);
  };

  const confirmDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(true);
    try {
      await deleteSession(s.session_id);
      onDeleted();
    } catch { /* ignore */ } finally {
      setDeleting(false);
      setConfirming(false);
    }
  };

  const cancelConfirm = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirming(false);
  };

  return (
    <>
      {/* Delete confirmation modal */}
      {confirming && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={cancelConfirm}
        >
          <div
            className="bg-gray-900 border border-red-800/50 rounded-2xl shadow-2xl flex flex-col gap-4 p-6 w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-red-900/40 text-red-400 flex-shrink-0">
                <Trash2 size={16} />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white">Delete session?</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  <span className="text-gray-300 font-medium">{nick}</span>
                </p>
                <p className="text-xs text-gray-600 mt-1">Output files on disk are kept.</p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={cancelConfirm}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs transition-colors"
              >
                <X size={12} /> Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white text-xs font-medium disabled:opacity-50 transition-colors"
              >
                <Check size={12} /> {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

    <div
      className={`group relative w-full rounded-lg transition-colors cursor-pointer flex overflow-hidden ${
        isActive ? "bg-gray-800 text-white" : "text-gray-400 hover:bg-gray-800/60 hover:text-gray-200"
      }`}
    >
      {/* Main content — clickable to select */}
      <div
        className="flex-1 min-w-0 px-3 py-2.5"
        onClick={async () => {
          if (editing || confirming) return;
          await restoreSession(s.session_id, s.work_dir, s.nickname);
          onSelect();
        }}
      >
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
            <span className="text-xs font-medium truncate flex-1">{nick}</span>
          )}
        </div>
        {!editing && (
          <div className="pl-3 text-[10px] text-gray-600 font-mono truncate">{s.session_id.slice(0, 8)}…</div>
        )}
      </div>

      {/* Full-height action buttons — visible on hover */}
      {!editing && (
        <div className="opacity-0 group-hover:opacity-100 flex flex-shrink-0 transition-opacity border-l border-gray-700/40">
          <button
            onClick={startEdit}
            className="flex items-center justify-center w-7 text-gray-600 hover:text-gray-300 hover:bg-gray-700/30 transition-colors"
            title="Rename"
          >
            <Pencil size={10} />
          </button>
          <button
            onClick={startConfirm}
            className="flex items-center justify-center w-7 text-gray-600 hover:text-red-400 hover:bg-red-900/20 transition-colors border-l border-gray-700/40"
            title="Delete"
          >
            <Trash2 size={10} />
          </button>
        </div>
      )}
    </div>
    </>
  );
}

// ── Information modal ──────────────────────────────────────────────────

function InformationModal({ username, onClose }: { username: string; onClose: () => void }) {
  const [wandbKey, setWandbKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getApiKeys(username).then(({ keys }) => {
      setWandbKey(keys["wandb"] ?? "");
    });
  }, [username]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await setApiKey(username, "wandb", wandbKey);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-[380px] bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Info size={15} className="text-indigo-400" />
            <span className="text-sm font-semibold text-gray-100">Account Information</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-5">
          {/* User info */}
          <div className="flex items-center gap-3 pb-3 border-b border-gray-800">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white text-sm font-semibold shadow">
              {username[0]?.toUpperCase() ?? "?"}
            </div>
            <div>
              <div className="text-sm font-medium text-gray-100">{username}</div>
              <div className="text-[11px] text-gray-500">Signed in</div>
            </div>
          </div>

          {/* API Keys section */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">API Keys</h4>

            {/* WandB */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-medium text-gray-300">
                <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
                Weights & Biases (WandB)
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showKey ? "text" : "password"}
                    value={wandbKey}
                    onChange={(e) => setWandbKey(e.target.value)}
                    placeholder="Enter WandB API key"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 pr-8"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                </div>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-3 py-2 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white transition-colors"
                >
                  {saved ? <Check size={12} /> : saving ? "…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Profile section ────────────────────────────────────────────────────

function ProfileSection({ username, onLogout }: { username: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
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
            onClick={() => { setOpen(false); setInfoOpen(true); }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-gray-400 hover:text-gray-100 hover:bg-gray-700/60 transition-colors"
          >
            <Info size={13} />
            Information
          </button>
          <button
            onClick={() => { setOpen(false); onLogout(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-gray-400 hover:text-red-400 hover:bg-gray-700/60 transition-colors"
          >
            <LogOut size={13} />
            Sign out
          </button>
        </div>
      )}

      {infoOpen && (
        <InformationModal username={username} onClose={() => setInfoOpen(false)} />
      )}
    </div>
  );
}

// ── Main sidebar ───────────────────────────────────────────────────────

export default function SessionSidebar({ onNewSession, onSelectSession, onSessionDeleted }: Props) {
  const router = useRouter();
  const { sessions, sessionId, fetchSessions, switchSession, updateSessionNickname, removeSession } =
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
                onDeleted={() => { removeSession(s.session_id); onSessionDeleted?.(s.session_id); }}
              />
            ))}
          </div>
        )}
      </div>

      <ProfileSection username={username ?? "user"} onLogout={handleLogout} />
    </aside>
  );
}
