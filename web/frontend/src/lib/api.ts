import type { ConfigOptions, SessionConfig } from "./types";

// ── Auth ──────────────────────────────────────────────────────────────

export async function loginUser(
  username: string,
  password: string
): Promise<{ success: boolean; username?: string }> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) return { success: false };
  return { success: true, ...(await res.json()) };
}

const BASE = "/api";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Sessions ──────────────────────────────────────────────────────────

export async function createSession(
  params: { workDir: string; nickname: string; username: string; preset: string; system?: string; gromacs?: string }
): Promise<{ session_id: string; work_dir: string; nickname: string; seeded_files: string[] }> {
  const res = await fetch(`${BASE}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      work_dir: params.workDir,
      nickname: params.nickname,
      username: params.username,
      preset: params.preset,
      system: params.system ?? "",
      gromacs: params.gromacs ?? "",
    }),
  });
  return json(res);
}

export async function listSessions(username: string): Promise<{
  sessions: { session_id: string; work_dir: string; nickname: string }[];
}> {
  return json(await fetch(`${BASE}/sessions?username=${encodeURIComponent(username)}`));
}

export async function updateNickname(
  sessionId: string,
  nickname: string
): Promise<{ session_id: string; nickname: string }> {
  const res = await fetch(`${BASE}/sessions/${sessionId}/nickname`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname }),
  });
  return json(res);
}

// ── Config ────────────────────────────────────────────────────────────

export async function getConfigOptions(): Promise<ConfigOptions> {
  return json(await fetch(`${BASE}/config/options`));
}

export async function getSessionConfig(sessionId: string): Promise<{ config: Record<string, unknown> }> {
  return json(await fetch(`${BASE}/sessions/${sessionId}/config`));
}

export async function updateSessionConfig(
  sessionId: string,
  updates: Record<string, unknown>
): Promise<{ updated: boolean }> {
  const res = await fetch(`${BASE}/sessions/${sessionId}/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updates }),
  });
  return json(res);
}

export async function generateSessionFiles(
  sessionId: string
): Promise<{ generated: string[]; work_dir: string }> {
  const res = await fetch(`${BASE}/sessions/${sessionId}/generate-files`, {
    method: "POST",
  });
  return json(res);
}

// ── Files ─────────────────────────────────────────────────────────────

export async function listFiles(
  sessionId: string,
  pattern = "*"
): Promise<{ files: string[]; work_dir: string }> {
  return json(await fetch(`${BASE}/sessions/${sessionId}/files?pattern=${encodeURIComponent(pattern)}`));
}

export async function uploadFile(
  sessionId: string,
  file: File
): Promise<{ saved_path: string; size_bytes: number }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/sessions/${sessionId}/files/upload`, {
    method: "POST",
    body: form,
  });
  return json(res);
}

export function downloadUrl(sessionId: string, path: string): string {
  return `${BASE}/sessions/${sessionId}/files/download?path=${encodeURIComponent(path)}`;
}

export async function getFileContent(sessionId: string, path: string): Promise<string> {
  const res = await fetch(downloadUrl(sessionId, path));
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
  return res.text();
}

// ── Analysis ──────────────────────────────────────────────────────────

export async function getColvar(
  sessionId: string,
  filename = "COLVAR"
): Promise<{ data: Record<string, number[]>; available: boolean }> {
  return json(await fetch(`${BASE}/sessions/${sessionId}/analysis/colvar?filename=${filename}`));
}

export async function getFes(
  sessionId: string,
  filename = "fes.dat"
): Promise<{ data: { x: number[]; y: number[]; z: number[][] }; available: boolean }> {
  return json(await fetch(`${BASE}/sessions/${sessionId}/analysis/fes?filename=${filename}`));
}

export async function getEnergy(
  sessionId: string,
  terms?: string[]
): Promise<{ data: Record<string, number[]>; available: boolean }> {
  const params = terms ? terms.map((t) => `terms=${encodeURIComponent(t)}`).join("&") : "";
  return json(await fetch(`${BASE}/sessions/${sessionId}/analysis/energy${params ? "?" + params : ""}`));
}

export async function getProgress(
  sessionId: string
): Promise<{ progress: { step: number; time_ps: number; ns_per_day: number } | null; available: boolean }> {
  return json(await fetch(`${BASE}/sessions/${sessionId}/analysis/progress`));
}
