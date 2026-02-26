"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { restoreSession } from "@/lib/api";
import { useSessionStore } from "@/store/sessionStore";
import SessionSidebar from "@/components/sidebar/SessionSidebar";
import MDWorkspace from "@/components/workspace/MDWorkspace";
import ChatWindow from "@/components/chat/ChatWindow";
import ChatInput from "@/components/chat/ChatInput";

const STORAGE_KEY = "amd-session";

export default function App() {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [autoSend, setAutoSend] = useState("");
  const [showNewSession, setShowNewSession] = useState(false);

  const { setSession, addSession, fetchSessions } = useSessionStore();

  // Auth check — redirect to /login if not authenticated
  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login");
      return;
    }
    setHydrated(true);

    // Fetch session list from disk, then restore the last active session
    const savedId = localStorage.getItem(STORAGE_KEY);
    fetchSessions().then(() => {
      if (!savedId) return;
      const found = useSessionStore.getState().sessions.find((s) => s.session_id === savedId);
      if (!found) { localStorage.removeItem(STORAGE_KEY); return; }
      restoreSession(found.session_id, found.work_dir, found.nickname)
        .finally(() => {
          setSessionId(found.session_id);
          setSession(found.session_id, { method: "", system: "", gromacs: "", plumed_cvs: "", workDir: found.work_dir });
        });
    });
  }, [router, setSession, fetchSessions]);

  if (!hydrated) return null;

  const handleSessionCreated = (id: string, workDir: string, nickname: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    setSessionId(id);
    addSession({ session_id: id, work_dir: workDir, nickname });
    setShowNewSession(false);
    fetchSessions();
  };

  const handleNewSession = () => {
    setShowNewSession(true);
    setSessionId(null);
  };

  const handleStartMD = () => {
    if (!sessionId) return;
    setAutoSend("Please start the MD simulation with the current configuration.");
  };

  const activeSessionId = showNewSession ? null : sessionId;

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950 text-gray-100">
      {/* Left: Session sidebar */}
      <SessionSidebar
        onNewSession={handleNewSession}
        onSelectSession={(id) => {
          localStorage.setItem(STORAGE_KEY, id);
          setSessionId(id);
          setShowNewSession(false);
        }}
        onSessionDeleted={(id) => {
          if (sessionId === id) {
            localStorage.removeItem(STORAGE_KEY);
            setSessionId(null);
          }
        }}
      />

      {/* Middle: MD Workspace */}
      <MDWorkspace
        sessionId={activeSessionId}
        showNewForm={showNewSession}
        onSessionCreated={handleSessionCreated}
        onStartMD={handleStartMD}
        onNewSession={handleNewSession}
      />

      {/* Right: Chat panel */}
      <aside className="w-80 flex-shrink-0 border-l border-gray-800 flex flex-col bg-gray-900 min-w-0">
        <div className="px-4 py-3 border-b border-gray-800 flex-shrink-0">
          <h2 className="text-sm font-semibold text-gray-200">AI Assistant</h2>
          <p className="text-xs text-gray-500 mt-0.5">Claude Opus 4.6</p>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          <ChatWindow />
          {activeSessionId ? (
            <ChatInput
              sessionId={activeSessionId}
              autoSend={autoSend}
              onAutoSendComplete={() => setAutoSend("")}
            />
          ) : (
            <div className="p-3 border-t border-gray-800 text-xs text-gray-500 text-center">
              Create a session to start chatting
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
