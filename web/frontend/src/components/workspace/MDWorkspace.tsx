"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Settings,
  Cpu,
  Zap,
  FlaskConical,
  Play,
  Pause,
  Square,
  Loader2,
  Plus,
  RefreshCw,
  Eye,
  Upload,
  CheckCircle2,
  FileText,
  Timer,
  Thermometer,
  Gauge,
  Mountain,
  Binary,
  Layers,
  MessageSquare,
  Bot,
  Download,
  Trash2,
  ChevronDown,
  ChevronRight,
  X,
  Archive,
  RotateCcw,
} from "lucide-react";

import AgentModal from "@/components/agents/AgentModal";
import type { AgentType } from "@/lib/agentStream";
import { getUsername } from "@/lib/auth";
import SimulationStatus from "@/components/status/SimulationStatus";
import EnergyPlot from "@/components/viz/EnergyPlot";
import ColvarPlot from "@/components/viz/ColvarPlot";
import RamachandranPlot from "@/components/viz/RamachandranPlot";
import FileUpload from "@/components/files/FileUpload";
import MoleculeViewer from "@/components/viz/MoleculeViewer";
import {
  getSessionConfig,
  updateSessionConfig,
  generateSessionFiles,
  listFiles,
  downloadUrl,
  downloadZipUrl,
  getFileContent,
  deleteFile,
  listArchiveFiles,
  restoreFile,
  createSession,
  updateSessionMolecule,
  startSimulation,
  stopSimulation,
} from "@/lib/api";
import { useSessionStore } from "@/store/sessionStore";

// ── Helpers ───────────────────────────────────────────────────────────

function defaultNickname(): string {
  const now = new Date();
  const MM = String(now.getMonth() + 1).padStart(2, "0");
  const DD = String(now.getDate()).padStart(2, "0");
  const HH = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const SS = String(now.getSeconds()).padStart(2, "0");
  return `${MM}${DD}-${HH}${mm}${SS}`;
}

// ── Presets ───────────────────────────────────────────────────────────

interface Preset { id: string; label: string; description: string; tag: string }

const PRESETS: Preset[] = [
  { id: "md",       label: "Molecular Dynamics", description: "Unbiased MD — no enhanced sampling",             tag: "MD"    },
  { id: "metad",    label: "Metadynamics",        description: "Well-tempered metadynamics with PLUMED",        tag: "MetaD" },
  { id: "umbrella", label: "Umbrella Sampling",   description: "Umbrella sampling along a reaction coordinate", tag: "US"    },
];

// ── System options ─────────────────────────────────────────────────────

interface SystemOption { id: string; label: string; description: string }

const SYSTEMS: SystemOption[] = [
  { id: "ala_dipeptide", label: "Alanine Dipeptide",  description: "Blocked alanine dipeptide · Ace-Ala-Nme" },
  { id: "chignolin",     label: "Chignolin (CLN025)", description: "10-residue β-hairpin mini-protein"        },
  { id: "blank",         label: "Blank",              description: "No system — configure manually"           },
];

// Maps system config name → human label for the molecule pane header
const SYSTEM_LABELS: Record<string, string> = {
  ala_dipeptide: "Alanine Dipeptide",
  protein:       "Protein",
  membrane:      "Membrane",
  chignolin:     "Chignolin",
};

// ── GROMACS templates ──────────────────────────────────────────────────

interface GmxTemplate { id: string; label: string; description: string }

const GMX_TEMPLATES: GmxTemplate[] = [
  { id: "ala_vacuum", label: "Vacuum", description: "Dodecahedron vacuum box · no solvent · fast" },
  { id: "auto",       label: "Auto",   description: "Maximally compatible defaults · PME · solvated" },
];

// ── UI primitives ─────────────────────────────────────────────────────

/** Section card with a header label and icon */
function Section({
  icon,
  title,
  children,
  accent = "blue",
  action,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  accent?: "blue" | "indigo" | "emerald" | "amber";
  action?: React.ReactNode;
}) {
  const border = {
    blue: "border-blue-800/40",
    indigo: "border-indigo-800/40",
    emerald: "border-emerald-800/40",
    amber: "border-amber-800/40",
  }[accent];
  const iconBg = {
    blue: "bg-blue-900/40 text-blue-400",
    indigo: "bg-indigo-900/40 text-indigo-400",
    emerald: "bg-emerald-900/40 text-emerald-400",
    amber: "bg-amber-900/40 text-amber-400",
  }[accent];

  return (
    <div className={`rounded-xl border ${border} bg-gray-900/60 overflow-hidden`}>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-800/60">
        <span className={`p-1 rounded-md ${iconBg}`}>{icon}</span>
        <span className="text-xs font-semibold text-gray-300 tracking-wide uppercase">{title}</span>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  );
}

/** Labelled number / text input with optional unit badge and hint */
function Field({
  label,
  value,
  onChange,
  onBlur,
  type = "text",
  unit,
  hint,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  onBlur?: () => void;
  type?: string;
  unit?: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium text-gray-400">{label}</label>
        {unit && (
          <span className="text-[10px] font-mono text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">
            {unit}
          </span>
        )}
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className="w-full border border-gray-700 rounded-lg px-3 py-2 text-sm bg-gray-800 text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
      />
      {hint && <p className="mt-1 text-[11px] text-gray-600">{hint}</p>}
    </div>
  );
}

/** Two-column grid for related fields */
function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

/** Labelled select dropdown */
function SelectField({
  label,
  value,
  onChange,
  onSave,
  options,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onSave?: () => void;
  options: { value: string; label: string }[];
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => { onChange(e.target.value); onSave?.(); }}
        className="w-full border border-gray-700 rounded-lg px-3 py-2 text-sm bg-gray-800 text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {hint && <p className="mt-1 text-[11px] text-gray-600">{hint}</p>}
    </div>
  );
}


// ── Pill tab bar ──────────────────────────────────────────────────────

const TABS = [
  { value: "progress", label: "Progress", icon: <Activity size={12} /> },
  { value: "molecule", label: "Molecule", icon: <FlaskConical size={12} /> },
  { value: "gromacs",  label: "GROMACS",  icon: <Cpu size={12} /> },
  { value: "method",   label: "Method",   icon: <Zap size={12} /> },
];

function PillTabs({
  active,
  onChange,
}: {
  active: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1 p-1.5 bg-gray-900 border-b border-gray-800">
      {TABS.map(({ value, label, icon }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            active === value
              ? "bg-gray-700 text-white shadow-sm"
              : "text-gray-500 hover:text-gray-300 hover:bg-gray-800/70"
          }`}
        >
          {icon}
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Mol file helper ────────────────────────────────────────────────────

const MOL_EXTS = new Set(["pdb", "gro", "mol2", "xyz", "sdf"]);
function isMolFile(path: string) {
  return MOL_EXTS.has(path.split(".").pop()?.toLowerCase() ?? "");
}

// ── File preview helpers ────────────────────────────────────────────────

const _BINARY_EXTS = new Set([".xtc", ".trr", ".edr", ".tpr", ".cpt", ".xdr", ".dms", ".gsd"]);
const _VIEWER_EXTS = new Set([".pdb", ".gro"]);

function canPreview(name: string): "viewer" | "text" | "binary" {
  const ext = "." + (name.split(".").pop() ?? "").toLowerCase();
  if (_BINARY_EXTS.has(ext)) return "binary";
  if (_VIEWER_EXTS.has(ext)) return "viewer";
  return "text";  // all other extensions treated as plain text
}

// ── File preview modal ─────────────────────────────────────────────────

function FilePreviewModal({
  sessionId,
  path,
  onClose,
}: {
  sessionId: string;
  path: string;
  onClose: () => void;
}) {
  const name = path.split("/").pop() ?? path;
  const kind = canPreview(name);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(kind !== "binary");

  useEffect(() => {
    if (kind === "binary") return;
    setLoading(true);
    getFileContent(sessionId, path)
      .then((text) => setContent(text.length > 200_000 ? text.slice(0, 200_000) + "\n…[truncated]" : text))
      .catch((e) => setContent(`Error loading file: ${e}`))
      .finally(() => setLoading(false));
  }, [sessionId, path, kind]);

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-gray-900 rounded-2xl flex flex-col shadow-2xl border border-gray-700 overflow-hidden"
        style={{ width: "min(900px, 92vw)", height: "80vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700 flex-shrink-0">
          <span className="text-sm font-mono text-gray-200 truncate">{name}</span>
          <div className="flex items-center gap-2 flex-shrink-0">
            <a
              href={downloadUrl(sessionId, path)}
              download={name}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors"
            >
              <Download size={12} />
              Download
            </a>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden">
          {kind === "binary" ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-gray-500">
              <FileText size={32} className="opacity-30" />
              <p className="text-sm">Binary file — cannot preview.</p>
              <a
                href={downloadUrl(sessionId, path)}
                download={name}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white text-sm transition-colors"
              >
                <Download size={13} /> Download
              </a>
            </div>
          ) : loading ? (
            <div className="h-full flex items-center justify-center text-gray-500">
              <Loader2 size={20} className="animate-spin mr-2" />
              <span className="text-sm">Loading…</span>
            </div>
          ) : kind === "viewer" ? (
            <div className="h-full p-3">
              <MoleculeViewer fileContent={content!} fileName={name} inline />
            </div>
          ) : (
            <pre className="h-full overflow-auto p-4 text-[11px] font-mono text-gray-300 leading-relaxed whitespace-pre-wrap break-all bg-gray-950">
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Delete confirmation popup ──────────────────────────────────────────

function DeleteConfirmPopup({
  name,
  onConfirm,
  onCancel,
}: {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onCancel}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-5 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-gray-100 mb-1">Move to archive?</h3>
        <p className="text-xs text-gray-400 mb-4">
          <span className="font-mono text-gray-300">{name}</span> will be moved to the session&apos;s
          archive folder. You can recover it manually.
        </p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-200 border border-gray-700 hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-900/60 hover:bg-red-800/70 border border-red-700/60 text-red-300 hover:text-red-100 transition-colors"
          >
            Move to archive
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Progress tab ───────────────────────────────────────────────────────

function ProgressTab({ sessionId }: { sessionId: string }) {
  const [agentOpen, setAgentOpen] = useState(false);
  const [simFiles, setSimFiles] = useState<string[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);

  // Archive panel
  const [showArchive, setShowArchive] = useState(false);
  const [archiveFiles, setArchiveFiles] = useState<string[]>([]);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [restoringPath, setRestoringPath] = useState<string | null>(null);

  const refreshFiles = useCallback(() => {
    setFilesLoading(true);
    listFiles(sessionId)
      .then(({ files }) => setSimFiles(files.filter((f) => !isMolFile(f))))
      .catch(() => {})
      .finally(() => setFilesLoading(false));
  }, [sessionId]);

  const refreshArchive = useCallback(() => {
    setArchiveLoading(true);
    listArchiveFiles(sessionId)
      .then(({ files }) => setArchiveFiles(files))
      .catch(() => {})
      .finally(() => setArchiveLoading(false));
  }, [sessionId]);

  useEffect(() => {
    refreshFiles();
  }, [refreshFiles]);

  // Load archive list whenever the panel is opened
  useEffect(() => {
    if (showArchive) refreshArchive();
  }, [showArchive, refreshArchive]);

  const handleDelete = async (path: string) => {
    setDeleteTarget(null);
    setDeletingPath(path);
    try {
      await deleteFile(sessionId, path);
      setSimFiles((prev) => prev.filter((f) => f !== path));
      // Keep archive list in sync if the panel is open
      if (showArchive) refreshArchive();
    } catch {
      // silently ignore — file listing will be stale but not broken
    } finally {
      setDeletingPath(null);
    }
  };

  const handleRestore = async (path: string) => {
    setRestoringPath(path);
    try {
      await restoreFile(sessionId, path);
      setArchiveFiles((prev) => prev.filter((f) => f !== path));
      refreshFiles();
    } catch {
      // silently ignore
    } finally {
      setRestoringPath(null);
    }
  };

  return (
    <div className="p-4 space-y-4">
      {/* Status + agent button */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-400">Simulation Status</span>
        <button
          onClick={() => setAgentOpen(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-emerald-900/30 border border-emerald-800/50 text-emerald-400 hover:bg-emerald-800/40 transition-colors font-medium"
        >
          <Bot size={11} />
          Analyse Results
        </button>
      </div>

      <SimulationStatus />

      <div className="space-y-4 pt-2">
        <div className="flex items-center gap-2">
          <div className="h-px flex-1 bg-gray-800" />
          <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider">Results</span>
          <div className="h-px flex-1 bg-gray-800" />
        </div>
        <EnergyPlot sessionId={sessionId} />
        <ColvarPlot sessionId={sessionId} />
        <RamachandranPlot sessionId={sessionId} />
      </div>

      {/* Files section */}
      <Section
        icon={<FileText size={13} />}
        title={`Files${simFiles.length > 0 ? ` (${simFiles.length})` : ""}`}
        accent="emerald"
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowArchive((v) => !v)}
              className={`p-1 transition-colors ${showArchive ? "text-amber-400 hover:text-amber-300" : "text-gray-500 hover:text-gray-300"}`}
              title="Show archived files"
            >
              <Archive size={15} />
            </button>
            <button
              onClick={refreshFiles}
              className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
              title="Refresh"
            >
              <RefreshCw size={15} className={filesLoading ? "animate-spin" : ""} />
            </button>
            <a
              href={downloadZipUrl(sessionId)}
              download
              className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
              title="Download all as ZIP"
            >
              <Download size={15} />
            </a>
          </div>
        }
      >
        {simFiles.length === 0 ? (
          <p className="text-xs text-gray-600 py-1">No simulation files yet.</p>
        ) : (
          <div className="space-y-0.5 max-h-56 overflow-y-auto">
            {simFiles.map((f) => {
              const name = f.split("/").pop() ?? f;
              const isDeleting = deletingPath === f;
              return (
                <div
                  key={f}
                  className="flex items-center gap-1 px-2 py-1.5 rounded hover:bg-gray-800/60 group"
                >
                  {/* Filename — click to preview */}
                  <button
                    onClick={() => setPreviewPath(f)}
                    className="flex-1 text-left text-xs font-mono text-gray-400 hover:text-gray-200 truncate transition-colors"
                    title={name}
                  >
                    {name}
                  </button>

                  {/* Action buttons — visible on hover */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                      onClick={() => setPreviewPath(f)}
                      title="Preview"
                      className="p-1 rounded text-gray-500 hover:text-gray-200 hover:bg-gray-700 transition-colors"
                    >
                      <Eye size={12} />
                    </button>
                    <a
                      href={downloadUrl(sessionId, f)}
                      download={name}
                      title="Download"
                      className="p-1 rounded text-gray-500 hover:text-gray-200 hover:bg-gray-700 transition-colors"
                    >
                      <Download size={12} />
                    </a>
                    <button
                      onClick={() => setDeleteTarget(f)}
                      disabled={isDeleting}
                      title="Move to archive"
                      className="p-1 rounded text-gray-500 hover:text-red-400 hover:bg-gray-700 transition-colors disabled:opacity-40"
                    >
                      {isDeleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Archive panel */}
        {showArchive && (
          <div className="mt-2 pt-3 border-t border-gray-700/40">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Archive size={11} className="text-amber-500" />
                <span className="text-[10px] font-semibold text-amber-500/80 uppercase tracking-wider">
                  Archive{archiveFiles.length > 0 ? ` (${archiveFiles.length})` : ""}
                </span>
              </div>
              <button
                onClick={refreshArchive}
                className="p-0.5 text-gray-600 hover:text-gray-400 transition-colors"
                title="Refresh archive"
              >
                <RefreshCw size={11} className={archiveLoading ? "animate-spin" : ""} />
              </button>
            </div>

            {archiveLoading ? (
              <div className="flex justify-center py-2">
                <Loader2 size={14} className="animate-spin text-gray-600" />
              </div>
            ) : archiveFiles.length === 0 ? (
              <p className="text-xs text-gray-600 py-1">Archive is empty.</p>
            ) : (
              <div className="space-y-0.5 max-h-40 overflow-y-auto">
                {archiveFiles.map((f) => {
                  const name = f.split("/").pop() ?? f;
                  const isRestoring = restoringPath === f;
                  return (
                    <div
                      key={f}
                      className="flex items-center gap-1 px-2 py-1.5 rounded hover:bg-gray-800/60 group"
                    >
                      <span
                        className="flex-1 text-xs font-mono text-gray-500 truncate"
                        title={name}
                      >
                        {name}
                      </span>
                      <button
                        onClick={() => handleRestore(f)}
                        disabled={isRestoring}
                        title="Restore to working directory"
                        className="p-1 rounded text-gray-600 hover:text-emerald-400 hover:bg-gray-700 transition-colors disabled:opacity-40 opacity-0 group-hover:opacity-100"
                      >
                        {isRestoring ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <RotateCcw size={12} />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </Section>

      {agentOpen && (
        <AgentModal sessionId={sessionId} agentType="analysis" onClose={() => setAgentOpen(false)} />
      )}

      {previewPath && (
        <FilePreviewModal
          sessionId={sessionId}
          path={previewPath}
          onClose={() => setPreviewPath(null)}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmPopup
          name={deleteTarget.split("/").pop() ?? deleteTarget}
          onConfirm={() => handleDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

// ── Molecule tab ────────────────────────────────────────────────────────

function MoleculeTab({
  sessionId,
  cfg,
  selectedMolecule,
  onSelectMolecule,
  onMoleculeDeleted,
}: {
  sessionId: string;
  cfg: Record<string, unknown>;
  selectedMolecule: { content: string; name: string } | null;
  onSelectMolecule: (m: { content: string; name: string }) => void;
  onMoleculeDeleted: (name: string) => void;
}) {
  const system = (cfg.system ?? {}) as Record<string, unknown>;
  const systemLabel = SYSTEM_LABELS[system.name as string] ?? (system.name as string) ?? "";
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [fileRefresh, setFileRefresh] = useState(0);
  const [viewLoading, setViewLoading] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);

  const refreshFiles = useCallback(() => {
    setLoading(true);
    listFiles(sessionId)
      .then(({ files }) => setFiles(files))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => {
    refreshFiles();
  }, [refreshFiles, fileRefresh]);

  const handleDelete = async (filePath: string) => {
    const name = filePath.split("/").pop() ?? filePath;
    setDeleteLoading(name);
    try {
      await deleteFile(sessionId, filePath);
      onMoleculeDeleted(name);
      setFileRefresh((n) => n + 1);
    } catch {
      /* ignore */
    } finally {
      setDeleteLoading(null);
    }
  };

  const handleSelect = async (filePath: string) => {
    const name = filePath.split("/").pop() ?? filePath;
    setViewLoading(name);
    try {
      const content = await getFileContent(sessionId, filePath);
      onSelectMolecule({ content, name });
    } catch {
      /* ignore */
    } finally {
      setViewLoading(null);
    }
  };

  const molFiles = files.filter(isMolFile);

  return (
    <div className="p-4 space-y-4">
      {/* Header: {molecule} - {filename} + agent button */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-gray-200 truncate">
          {selectedMolecule ? (
            <>
              {systemLabel && (
                <span className="text-gray-400 font-normal">{systemLabel} — </span>
              )}
              {selectedMolecule.name}
            </>
          ) : (
            <span className="text-gray-500 font-normal text-xs">No molecule selected</span>
          )}
        </span>
        <button
          onClick={() => setAgentOpen(true)}
          className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-blue-900/30 border border-blue-800/50 text-blue-400 hover:bg-blue-800/40 transition-colors font-medium"
        >
          <Bot size={11} />
          Search with agent
        </button>
      </div>

      {/* Inline 3D viewer */}
      {selectedMolecule && (
        <MoleculeViewer
          fileContent={selectedMolecule.content}
          fileName={selectedMolecule.name}
          inline={true}
        />
      )}

      {/* Molecule files + integrated upload */}
      <Section
        icon={<FlaskConical size={13} />}
        title="Molecule Files"
        accent="indigo"
        action={
          <button
            onClick={refreshFiles}
            className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
        }
      >

        {molFiles.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {molFiles.map((f) => {
              const name = f.split("/").pop() ?? f;
              const isLoading = viewLoading === name;
              const isDeleting = deleteLoading === name;
              const isSelected = selectedMolecule?.name === name;
              return (
                <div
                  key={f}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border ${
                    isSelected
                      ? "bg-indigo-950/40 border-indigo-700/60"
                      : "bg-gray-800/50 border-gray-700/50"
                  }`}
                >
                  <span className="text-base">🧬</span>
                  <span className="text-xs text-gray-200 truncate flex-1 font-mono" title={f}>
                    {name}
                  </span>
                  <button
                    onClick={() => handleSelect(f)}
                    disabled={isLoading || isDeleting}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs border transition-colors disabled:opacity-50 flex-shrink-0 ${
                      isSelected
                        ? "bg-indigo-600/80 hover:bg-indigo-500 text-white border-indigo-500/50"
                        : "bg-indigo-700/70 hover:bg-indigo-600 text-indigo-200 border-indigo-700/50"
                    }`}
                  >
                    {isLoading
                      ? <RefreshCw size={10} className="animate-spin" />
                      : isSelected
                      ? <CheckCircle2 size={10} />
                      : null}
                    {isSelected ? "Selected" : "Select"}
                  </button>
                  <a
                    href={downloadUrl(sessionId, f)}
                    download={name}
                    className="flex items-center justify-center p-1.5 rounded-md text-gray-400 hover:text-blue-400 hover:bg-blue-900/20 border border-gray-700/50 hover:border-blue-800/40 transition-colors flex-shrink-0"
                    title="Download file"
                  >
                    <Download size={11} />
                  </a>
                  <button
                    onClick={() => handleDelete(f)}
                    disabled={isDeleting || isLoading}
                    className="flex items-center justify-center p-1.5 rounded-md text-gray-400 hover:text-red-400 hover:bg-red-900/20 border border-gray-700/50 hover:border-red-800/40 transition-colors disabled:opacity-40 flex-shrink-0"
                    title="Delete file"
                  >
                    {isDeleting
                      ? <RefreshCw size={11} className="animate-spin" />
                      : <Trash2 size={11} />}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Upload dropzone integrated here */}
        <FileUpload sessionId={sessionId} onUploaded={() => setFileRefresh((n) => n + 1)} />
      </Section>

      {agentOpen && (
        <AgentModal sessionId={sessionId} agentType="paper" onClose={() => setAgentOpen(false)} />
      )}
    </div>
  );
}

// ── GROMACS tab ────────────────────────────────────────────────────────

function GromacsTab({
  cfg,
  onChange,
  onSave,
}: {
  cfg: Record<string, unknown>;
  onChange: (k: string, v: unknown) => void;
  onSave: () => void;
}) {
  const gromacs = (cfg.gromacs ?? {}) as Record<string, unknown>;
  const method  = (cfg.method  ?? {}) as Record<string, unknown>;
  const system  = (cfg.system  ?? {}) as Record<string, unknown>;

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-sm font-semibold text-gray-200">GROMACS Parameters</h3>

      {/* System */}
      <Section icon={<FlaskConical size={13} />} title="System" accent="emerald">
        <FieldGrid>
          <SelectField
            label="Force Field"
            value={String(system.forcefield ?? "amber99sb-ildn")}
            onChange={(v) => onChange("system.forcefield", v)}
            onSave={onSave}
            options={[
              { value: "amber99sb-ildn", label: "AMBER99SB-ILDN" },
              { value: "charmm27",       label: "CHARMM27"       },
              { value: "charmm36m",      label: "CHARMM36m"      },
            ]}
          />
          <SelectField
            label="Solvent"
            value={String(system.water_model ?? "tip3p")}
            onChange={(v) => onChange("system.water_model", v)}
            onSave={onSave}
            options={[
              { value: "none",  label: "Vacuum"      },
              { value: "tip3p", label: "TIP3P Water" },
            ]}
          />
          <Field
            label="Box clearance"
            type="number"
            value={String(gromacs.box_clearance ?? "1.5")}
            onChange={(v) => onChange("gromacs.box_clearance", Number(v))}
            onBlur={onSave}
            unit="nm"
          />
        </FieldGrid>
        <p className="text-[11px] text-gray-600">
          Minimum distance from the molecule to the box edge (editconf <code className="font-mono">-d</code>).
          Must satisfy: clearance × √3/2 &gt; max cutoff ({String((gromacs.rcoulomb as number | undefined) ?? 1.2)} nm).
        </p>
      </Section>

      {/* Simulation length */}
      {(() => {
        const nsteps = Number(method.nsteps ?? 0);
        const dt = Number(gromacs.dt ?? 0.002);
        const totalPs = nsteps * dt;
        const totalLabel = nsteps > 0
          ? totalPs < 1
            ? `${(totalPs * 1000).toFixed(0)} fs`
            : totalPs < 1000
              ? `${totalPs % 1 === 0 ? totalPs.toFixed(0) : totalPs.toFixed(2)} ps`
              : `${(totalPs / 1000).toFixed(3).replace(/\.?0+$/, "")} ns`
          : null;
        return (
          <Section
            icon={<Binary size={13} />}
            title="Simulation Length"
            accent="blue"
            action={totalLabel && (
              <span className="text-xs font-mono text-blue-400">{totalLabel}</span>
            )}
          >
            <FieldGrid>
              <Field
                label="Steps"
                type="number"
                value={String(method.nsteps ?? "")}
                onChange={(v) => onChange("method.nsteps", Number(v))}
                onBlur={onSave}
                hint="Total MD steps to run."
              />
              <Field
                label="Timestep"
                type="number"
                value={String(Number(gromacs.dt ?? 0.002) * 1000)}
                onChange={(v) => onChange("gromacs.dt", Number(v) / 1000)}
                onBlur={onSave}
                unit="fs"
                hint="2 fs is standard."
              />
            </FieldGrid>
          </Section>
        );
      })()}

      {/* Thermostat */}
      <Section icon={<Thermometer size={13} />} title="Temperature" accent="amber">
        <FieldGrid>
          <Field
            label="Reference Temperature"
            type="number"
            value={String(Array.isArray(gromacs.ref_t) ? (gromacs.ref_t as number[])[0] : gromacs.ref_t ?? gromacs.temperature ?? "300")}
            onChange={(v) => onChange("gromacs.ref_t", [Number(v)])}
            onBlur={onSave}
            unit="K"
            hint="Target temperature (V-rescale)."
          />
          <Field
            label="Thermostat time constant"
            type="number"
            value={String(Array.isArray(gromacs.tau_t) ? (gromacs.tau_t as number[])[0] : gromacs.tau_t ?? "0.1")}
            onChange={(v) => onChange("gromacs.tau_t", [Number(v)])}
            onBlur={onSave}
            unit="ps"
            hint="τ for V-rescale coupling."
          />
        </FieldGrid>
      </Section>

      {/* Advanced / details — folded by default */}
      <AdvancedSection cfg={cfg} onChange={onChange} onSave={onSave} />
    </div>
  );
}

function AdvancedSection({
  cfg,
  onChange,
  onSave,
}: {
  cfg: Record<string, unknown>;
  onChange: (k: string, v: unknown) => void;
  onSave: () => void;
}) {
  const [open, setOpen] = useState(false);
  const gromacs = (cfg.gromacs ?? {}) as Record<string, unknown>;

  return (
    <div className="rounded-xl border border-gray-700/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-900/60 hover:bg-gray-800/60 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={12} className="text-gray-500" /> : <ChevronRight size={12} className="text-gray-500" />}
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Advanced Parameters</span>
        </div>
        <span className="text-[10px] text-gray-600">Cutoffs, electrostatics, constraints, output…</span>
      </button>

      {open && (
        <div className="p-3 space-y-3 border-t border-gray-700/40 bg-gray-900/20">
          {/* Non-bonded cutoffs */}
          <div>
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Non-bonded Cutoffs</p>
            <FieldGrid>
              <Field
                label="Coulomb cutoff"
                type="number"
                value={String(gromacs.rcoulomb ?? "1.2")}
                onChange={(v) => onChange("gromacs.rcoulomb", Number(v))}
                onBlur={onSave}
                unit="nm"
              />
              <Field
                label="VdW cutoff"
                type="number"
                value={String(gromacs.rvdw ?? "1.2")}
                onChange={(v) => onChange("gromacs.rvdw", Number(v))}
                onBlur={onSave}
                unit="nm"
              />
            </FieldGrid>
          </div>

          {/* Electrostatics */}
          <div>
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Electrostatics</p>
            <FieldGrid>
              <SelectField
                label="Coulomb type"
                value={String(gromacs.coulombtype ?? "PME")}
                onChange={(v) => onChange("gromacs.coulombtype", v)}
                onSave={onSave}
                options={[
                  { value: "PME",     label: "PME"     },
                  { value: "cutoff",  label: "Cutoff"  },
                  { value: "Ewald",   label: "Ewald"   },
                ]}
              />
              <Field
                label="PME order"
                type="number"
                value={String(gromacs.pme_order ?? "4")}
                onChange={(v) => onChange("gromacs.pme_order", Number(v))}
                onBlur={onSave}
              />
              <Field
                label="Fourier spacing"
                type="number"
                value={String(gromacs.fourierspacing ?? "0.16")}
                onChange={(v) => onChange("gromacs.fourierspacing", Number(v))}
                onBlur={onSave}
                unit="nm"
              />
            </FieldGrid>
          </div>

          {/* Neighbor list */}
          <div>
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Neighbor List</p>
            <FieldGrid>
              <SelectField
                label="Cutoff scheme"
                value={String(gromacs.cutoff_scheme ?? "Verlet")}
                onChange={(v) => onChange("gromacs.cutoff_scheme", v)}
                onSave={onSave}
                options={[
                  { value: "Verlet", label: "Verlet" },
                  { value: "group",  label: "Group"  },
                ]}
              />
              <Field
                label="nstlist"
                type="number"
                value={String(gromacs.nstlist ?? "10")}
                onChange={(v) => onChange("gromacs.nstlist", Number(v))}
                onBlur={onSave}
                hint="Steps between neighbor list updates."
              />
            </FieldGrid>
          </div>

          {/* Constraints */}
          <div>
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Constraints</p>
            <FieldGrid>
              <SelectField
                label="Constraints"
                value={String(gromacs.constraints ?? "h-bonds")}
                onChange={(v) => onChange("gromacs.constraints", v)}
                onSave={onSave}
                options={[
                  { value: "h-bonds",  label: "H-bonds"  },
                  { value: "all-bonds", label: "All bonds" },
                  { value: "none",     label: "None"     },
                ]}
              />
              <SelectField
                label="Algorithm"
                value={String(gromacs.constraint_algorithm ?? "LINCS")}
                onChange={(v) => onChange("gromacs.constraint_algorithm", v)}
                onSave={onSave}
                options={[
                  { value: "LINCS",  label: "LINCS"  },
                  { value: "SHAKE",  label: "SHAKE"  },
                ]}
              />
            </FieldGrid>
          </div>

          {/* Output frequencies */}
          <div>
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Output Frequencies (steps)</p>
            <FieldGrid>
              <Field
                label="nstxout"
                type="number"
                value={String(gromacs.nstxout ?? "5000")}
                onChange={(v) => onChange("gromacs.nstxout", Number(v))}
                onBlur={onSave}
                hint="Coordinates to .trr"
              />
              <Field
                label="nstvout"
                type="number"
                value={String(gromacs.nstvout ?? "5000")}
                onChange={(v) => onChange("gromacs.nstvout", Number(v))}
                onBlur={onSave}
                hint="Velocities to .trr"
              />
              <Field
                label="nstfout"
                type="number"
                value={String(gromacs.nstfout ?? "0")}
                onChange={(v) => onChange("gromacs.nstfout", Number(v))}
                onBlur={onSave}
                hint="Forces to .trr (0 = off)"
              />
              <Field
                label="nstlog"
                type="number"
                value={String(gromacs.nstlog ?? "1000")}
                onChange={(v) => onChange("gromacs.nstlog", Number(v))}
                onBlur={onSave}
                hint="Energy to .log"
              />
              <Field
                label="nstxout-compressed"
                type="number"
                value={String(gromacs.nstxout_compressed ?? "5000")}
                onChange={(v) => onChange("gromacs.nstxout_compressed", Number(v))}
                onBlur={onSave}
                hint="Coordinates to .xtc"
              />
              <Field
                label="nstenergy"
                type="number"
                value={String(gromacs.nstenergy ?? "1000")}
                onChange={(v) => onChange("gromacs.nstenergy", Number(v))}
                onBlur={onSave}
                hint="Energy to .edr"
              />
            </FieldGrid>
          </div>

          {/* Pressure */}
          <div>
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Pressure Coupling</p>
            <FieldGrid>
              <SelectField
                label="Barostat"
                value={String(gromacs.pcoupl ?? "no")}
                onChange={(v) => onChange("gromacs.pcoupl", v)}
                onSave={onSave}
                options={[
                  { value: "no",                label: "None"               },
                  { value: "Parrinello-Rahman",  label: "Parrinello-Rahman"  },
                  { value: "Berendsen",          label: "Berendsen"          },
                  { value: "C-rescale",          label: "C-rescale"          },
                ]}
              />
              <Field
                label="Reference pressure"
                type="number"
                value={String(gromacs.ref_p ?? gromacs.pressure ?? "1.0")}
                onChange={(v) => onChange("gromacs.ref_p", Number(v))}
                onBlur={onSave}
                unit="bar"
              />
              <Field
                label="τ pressure"
                type="number"
                value={String(gromacs.tau_p ?? "2.0")}
                onChange={(v) => onChange("gromacs.tau_p", Number(v))}
                onBlur={onSave}
                unit="ps"
              />
            </FieldGrid>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Method tab (includes PLUMED) ────────────────────────────────────────

const METHOD_OPTIONS = [
  { id: "md",       label: "Molecular Dynamics", tag: "MD" },
  { id: "metad",    label: "Metadynamics",        tag: "MetaD" },
  { id: "umbrella", label: "Umbrella Sampling",   tag: "US" },
];

function MethodTab({
  sessionId,
  cfg,
  onChange,
  onSave,
}: {
  sessionId: string;
  cfg: Record<string, unknown>;
  onChange: (k: string, v: unknown) => void;
  onSave: () => void;
}) {
  const method = (cfg.method ?? {}) as Record<string, unknown>;
  const hills = (method.hills ?? {}) as Record<string, unknown>;
  const [agentOpen, setAgentOpen] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);

  const currentMethodId = (method._target_name as string) ?? "md";
  const currentMethod = METHOD_OPTIONS.find((m) => m.id === currentMethodId) ?? METHOD_OPTIONS[0];
  const isMetaD = currentMethodId === "metad" || currentMethodId === "metadynamics";

  const handleMethodChange = (id: string) => {
    onChange("method._target_name", id);
    setMethodOpen(false);
    onSave();
  };

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-sm font-semibold text-gray-200">Simulation Method</h3>

      {/* Current method + toggle */}
      <div className="rounded-xl border border-gray-700/60 bg-gray-900/60 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-indigo-400" />
            <span className="text-sm font-medium text-gray-100">{currentMethod.label}</span>
            {currentMethod.tag && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-800/50 text-indigo-300">
                {currentMethod.tag}
              </span>
            )}
          </div>
          <button
            onClick={() => setMethodOpen((o) => !o)}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            {methodOpen ? "Cancel" : "Change"}
          </button>
        </div>

        {methodOpen && (
          <div className="border-t border-gray-800 p-3 space-y-1.5 bg-gray-950/40">
            {METHOD_OPTIONS.map((m) => (
              <button
                key={m.id}
                onClick={() => handleMethodChange(m.id)}
                className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-all ${
                  m.id === currentMethodId
                    ? "border-indigo-600 bg-indigo-950/40 text-white"
                    : "border-gray-700/60 bg-gray-800/40 text-gray-400 hover:border-gray-600 hover:text-gray-200"
                }`}
              >
                <span className="font-medium">{m.label}</span>
                {m.tag && (
                  <span className={`ml-2 text-[10px] font-mono px-1 py-0.5 rounded ${
                    m.id === currentMethodId ? "bg-indigo-700/60 text-indigo-200" : "bg-gray-700 text-gray-500"
                  }`}>{m.tag}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Metadynamics / PLUMED bias — only shown when method is metad */}
      {isMetaD && (
        <Section icon={<Mountain size={13} />} title="PLUMED / Metadynamics Bias" accent="indigo">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] text-gray-500">Well-tempered metadynamics parameters</p>
            <button
              onClick={() => setAgentOpen(true)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] bg-indigo-900/30 border border-indigo-800/50 text-indigo-400 hover:bg-indigo-800/40 transition-colors"
            >
              <Bot size={10} />
              Suggest CVs
            </button>
          </div>
          <FieldGrid>
            <Field
              label="Hills height"
              type="number"
              value={String(hills.height ?? "")}
              onChange={(v) => onChange("method.hills.height", Number(v))}
              onBlur={onSave}
              unit="kJ/mol"
              hint="Gaussian bias height."
            />
            <Field
              label="Hills pace"
              type="number"
              value={String(hills.pace ?? "")}
              onChange={(v) => onChange("method.hills.pace", Number(v))}
              onBlur={onSave}
              unit="steps"
              hint="Deposition frequency."
            />
          </FieldGrid>
          <FieldGrid>
            <Field
              label="Sigma"
              type="number"
              value={String(Array.isArray(hills.sigma) ? hills.sigma[0] : hills.sigma ?? "")}
              onChange={(v) => onChange("method.hills.sigma", [Number(v)])}
              onBlur={onSave}
              hint="Gaussian width (CV units)."
            />
            <Field
              label="Bias factor γ"
              type="number"
              value={String(hills.biasfactor ?? "")}
              onChange={(v) => onChange("method.hills.biasfactor", Number(v))}
              onBlur={onSave}
              hint="Well-tempered factor (5–15)."
            />
          </FieldGrid>
          <Section icon={<MessageSquare size={11} />} title="Example CV instructions" accent="blue">
            <div className="space-y-1.5">
              {[
                "Set up phi/psi dihedrals for alanine dipeptide",
                "Use sigma 0.3 rad, height 0.5 kJ/mol",
                "Add an upper wall at phi = 2.0 rad",
              ].map((ex) => (
                <div key={ex} className="px-2.5 py-1.5 rounded-lg bg-gray-800/60 border border-gray-700/50 text-[10px] text-gray-400 font-mono">
                  &ldquo;{ex}&rdquo;
                </div>
              ))}
            </div>
          </Section>
        </Section>
      )}

      {/* Placeholder for non-metaD methods */}
      {!isMetaD && (
        <div className="rounded-xl border border-gray-700/40 bg-gray-900/30 p-4 text-center">
          <p className="text-xs text-gray-600">
            No additional parameters for <span className="text-gray-400">{currentMethod.label}</span>.
          </p>
        </div>
      )}

      {agentOpen && (
        <AgentModal sessionId={sessionId} agentType="cv" onClose={() => setAgentOpen(false)} />
      )}
    </div>
  );
}

// ── New session form ───────────────────────────────────────────────────

function NewSessionForm({
  onCreated,
}: {
  onCreated: (id: string, workDir: string, nickname: string, seededFiles: string[]) => void;
}) {
  const [nickname, setNickname] = useState(defaultNickname);
  const [preset, setPreset] = useState("md");
  const [system, setSystem] = useState("ala_dipeptide");
  const [gromacs, setGromacs] = useState("ala_vacuum");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const nick = nickname.trim() || defaultNickname();
    const user = getUsername() || "default";
    const folderName = defaultNickname();
    const workDir = `outputs/${user}/${folderName}/data`;
    try {
      const { session_id, work_dir, nickname: savedNick, seeded_files } = await createSession({
        workDir,
        nickname: nick,
        username: user,
        preset,
        system,
        gromacs,
      });
      onCreated(session_id, work_dir, savedNick, seeded_files ?? []);
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full items-start justify-center p-6 overflow-y-auto">
      <div className="w-full max-w-4xl">
        <div className="mb-6 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 mb-3 shadow-lg">
            <FlaskConical size={22} className="text-white" />
          </div>
          <h2 className="text-xl font-bold text-gray-100">New Session</h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Nickname */}
          <div className="rounded-xl border border-gray-700/60 bg-gray-900/60 p-4">
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Session name <span className="text-gray-600">(editable anytime)</span>
            </label>
            <input
              autoFocus
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={defaultNickname()}
              className="w-full border border-gray-700 rounded-lg px-3 py-2 bg-gray-800 text-gray-100 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Three selectors side by side */}
          <div className="grid grid-cols-3 gap-3">

            {/* Molecule system */}
            <div className="rounded-xl border border-gray-700/60 bg-gray-900/60 p-3 flex flex-col gap-1.5">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Molecule System</p>
              {SYSTEMS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSystem(s.id)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg border transition-all ${
                    system === s.id
                      ? "border-indigo-600 bg-indigo-950/40 text-white"
                      : "border-gray-700/60 bg-gray-800/40 text-gray-400 hover:border-gray-600 hover:text-gray-200"
                  }`}
                >
                  <span className="text-xs font-medium">{s.label}</span>
                  <p className="text-[10px] text-gray-600 mt-0.5 leading-snug">{s.description}</p>
                </button>
              ))}
            </div>

            {/* Simulation method */}
            <div className="rounded-xl border border-gray-700/60 bg-gray-900/60 p-3 flex flex-col gap-1.5">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Simulation Method</p>
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPreset(p.id)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg border transition-all ${
                    preset === p.id
                      ? "border-blue-600 bg-blue-950/40 text-white"
                      : "border-gray-700/60 bg-gray-800/40 text-gray-400 hover:border-gray-600 hover:text-gray-200"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-medium leading-snug">{p.label}</span>
                    {p.tag && (
                      <span className={`text-[9px] font-mono px-1 py-0.5 rounded flex-shrink-0 ${
                        preset === p.id ? "bg-blue-700/60 text-blue-200" : "bg-gray-700 text-gray-500"
                      }`}>{p.tag}</span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-600 mt-0.5 leading-snug">{p.description}</p>
                </button>
              ))}
            </div>

            {/* GROMACS template */}
            <div className="rounded-xl border border-gray-700/60 bg-gray-900/60 p-3 flex flex-col gap-1.5">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">GROMACS Template</p>
              {GMX_TEMPLATES.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGromacs(g.id)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg border transition-all ${
                    gromacs === g.id
                      ? "border-emerald-600 bg-emerald-950/40 text-white"
                      : "border-gray-700/60 bg-gray-800/40 text-gray-400 hover:border-gray-600 hover:text-gray-200"
                  }`}
                >
                  <span className="text-xs font-medium">{g.label}</span>
                  <p className="text-[10px] text-gray-600 mt-0.5 leading-snug">{g.description}</p>
                </button>
              ))}
            </div>

          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-950/40 rounded-lg px-3 py-2 border border-red-800">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl transition-all text-sm shadow-lg shadow-blue-900/30"
          >
            {loading ? "Creating…" : "Create Session"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Main MDWorkspace ───────────────────────────────────────────────────

interface Props {
  sessionId: string | null;
  showNewForm: boolean;
  onSessionCreated: (id: string, workDir: string, nickname: string) => void;
  onNewSession: () => void;
}

type SimState = "idle" | "setting_up" | "running";

export default function MDWorkspace({ sessionId, showNewForm, onSessionCreated, onNewSession }: Props) {
  const [cfg, setCfg] = useState<Record<string, unknown>>({});
  const cfgRef = useRef<Record<string, unknown>>({});
  const [activeTab, setActiveTab] = useState("progress");
  const [selectedMolecule, setSelectedMolecule] = useState<{ content: string; name: string } | null>(null);
  const [simState, setSimState] = useState<SimState>("idle");
  const [pauseConfirmOpen, setPauseConfirmOpen] = useState(false);
  const { setSession, sessions, setSessionMolecule, appendSSEEvent } = useSessionStore();
  // Stable ref — lets the restore effect read latest sessions without re-running
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  // Reset simulation state when switching sessions
  useEffect(() => {
    setSimState("idle");
    setPauseConfirmOpen(false);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    setSelectedMolecule(null);

    getSessionConfig(sessionId)
      .then((r) => {
        setCfg(r.config);

        // Derive work_dir and molecule file from the config (authoritative)
        const run = (r.config.run ?? {}) as Record<string, unknown>;
        const sys = (r.config.system ?? {}) as Record<string, unknown>;
        const workDir = (run.work_dir as string) ?? "";
        // Prefer session.json's selected_molecule; fall back to system.coordinates
        const session = sessionsRef.current.find((s) => s.session_id === sessionId);
        const molFile = session?.selected_molecule || (sys.coordinates as string) || "";

        if (molFile && workDir) {
          getFileContent(sessionId, `${workDir}/${molFile}`)
            .then((content) =>
              setSelectedMolecule({ content, name: molFile.split("/").pop() ?? molFile })
            )
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, [sessionId]);

  const handleChange = (dotKey: string, value: unknown) => {
    const [section, ...rest] = dotKey.split(".");
    setCfg((c) => {
      const setDeep = (obj: Record<string, unknown>, parts: string[]): Record<string, unknown> => {
        const [head, ...tail] = parts;
        return tail.length === 0
          ? { ...obj, [head]: value }
          : { ...obj, [head]: setDeep((obj[head] as Record<string, unknown>) ?? {}, tail) };
      };
      const next = { ...c, [section]: setDeep((c[section] as Record<string, unknown>) ?? {}, rest) };
      cfgRef.current = next;
      return next;
    });
  };

  const handleSave = useCallback(async () => {
    if (!sessionId) return;
    await updateSessionConfig(sessionId, cfgRef.current).catch(() => {});
    await generateSessionFiles(sessionId).catch(() => {});
  }, [sessionId]);

  const handleStartMD = async () => {
    if (!sessionId || simState !== "idle") return;
    setSimState("setting_up");
    try {
      const result = await startSimulation(sessionId);
      appendSSEEvent({ type: "text_delta", text: `Simulation started (PID ${result.pid}). Output files: ${Object.values(result.expected_files).join(", ")}` });
      appendSSEEvent({ type: "agent_done", final_text: "" });
      setSimState("running");
    } catch (err) {
      appendSSEEvent({ type: "error", message: `Failed to start simulation: ${err}` });
      setSimState("idle");
    }
  };

  const handleConfirmPause = async () => {
    setPauseConfirmOpen(false);
    if (!sessionId) return;
    try {
      await stopSimulation(sessionId);
    } catch { /* ignore */ }
    setSimState("idle");
  };

  const handleSelectMolecule = async (m: { content: string; name: string }) => {
    setSelectedMolecule(m);
    if (!sessionId) return;
    // Update store immediately so switching sessions restores correctly
    setSessionMolecule(sessionId, m.name);
    // Persist to session.json
    await updateSessionMolecule(sessionId, m.name).catch(() => {});
    // Update system.coordinates in the Hydra config + regenerate YAML
    const updatedCfg = {
      ...cfg,
      system: { ...((cfg.system as Record<string, unknown>) ?? {}), coordinates: m.name },
    };
    setCfg(updatedCfg);
    await updateSessionConfig(sessionId, updatedCfg).catch(() => {});
    await generateSessionFiles(sessionId).catch(() => {});
  };

  const handleSessionCreated = async (
    id: string,
    workDir: string,
    nickname: string,
    seededFiles: string[],
  ) => {
    setSession(id, { method: "", system: "", gromacs: "", plumed_cvs: "", workDir });
    onSessionCreated(id, workDir, nickname);

    // Auto-select the first seeded structure file and persist to session.json
    const structExts = new Set(["pdb", "gro", "mol2", "xyz"]);
    const structFile = seededFiles.find((f) => structExts.has(f.split(".").pop()?.toLowerCase() ?? ""));
    if (structFile) {
      setActiveTab("molecule");
      try {
        const content = await getFileContent(id, `${workDir}/${structFile}`);
        setSelectedMolecule({ content, name: structFile });
        setSessionMolecule(id, structFile);
        await updateSessionMolecule(id, structFile).catch(() => {});
      } catch { /* ignore */ }
    }
  };

  if (!sessionId) {
    if (showNewForm) {
      return (
        <div className="flex-1 flex flex-col bg-gray-950 h-full">
          <NewSessionForm onCreated={handleSessionCreated} />
        </div>
      );
    }
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-gray-950 h-full gap-6 px-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gray-900 border border-gray-800 flex items-center justify-center">
            <FlaskConical size={28} className="text-gray-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-300">No session selected</p>
            <p className="text-xs text-gray-600 mt-1">Select a session from the sidebar or create a new one to get started.</p>
          </div>
        </div>
        <button
          onClick={onNewSession}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors shadow-lg shadow-blue-900/30"
        >
          <Plus size={14} />
          New Session
        </button>
      </div>
    );
  }

  const tabContent: Record<string, React.ReactNode> = {
    progress: <ProgressTab sessionId={sessionId} />,
    molecule: (
      <MoleculeTab
        sessionId={sessionId}
        cfg={cfg}
        selectedMolecule={selectedMolecule}
        onSelectMolecule={handleSelectMolecule}
        onMoleculeDeleted={(name) => {
          if (selectedMolecule?.name === name) setSelectedMolecule(null);
        }}
      />
    ),
    gromacs:  <GromacsTab cfg={cfg} onChange={handleChange} onSave={handleSave} />,
    method:   <MethodTab sessionId={sessionId} cfg={cfg} onChange={handleChange} onSave={handleSave} />,
  };

  return (
    <div className="flex-1 flex flex-col bg-gray-950 h-full min-w-0">
      <PillTabs active={activeTab} onChange={setActiveTab} />

      <div className="flex-1 overflow-y-auto">
        {tabContent[activeTab]}
      </div>

      {/* Simulation action button */}
      <div className="flex-shrink-0 p-4 border-t border-gray-800 bg-gray-900/50">
        {simState === "idle" && (
          <button
            onClick={handleStartMD}
            className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold rounded-xl transition-all shadow-lg shadow-blue-900/30 text-sm"
          >
            <Play size={16} fill="currentColor" />
            Start MD Simulation
          </button>
        )}
        {simState === "setting_up" && (
          <button
            disabled
            className="w-full flex items-center justify-center gap-2 py-3 bg-gray-700 text-gray-300 font-semibold rounded-xl text-sm cursor-not-allowed"
          >
            <Loader2 size={16} className="animate-spin" />
            Setting up…
          </button>
        )}
        {simState === "running" && (
          <button
            onClick={() => setPauseConfirmOpen(true)}
            className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-semibold rounded-xl transition-all shadow-lg shadow-amber-900/30 text-sm"
          >
            <Square size={14} fill="currentColor" />
            Pause MD Simulation
          </button>
        )}
      </div>

      {/* Pause confirmation dialog */}
      {pauseConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 shadow-2xl max-w-sm w-full mx-4">
            <h3 className="text-sm font-semibold text-gray-100 mb-2">Stop Simulation?</h3>
            <p className="text-xs text-gray-400 mb-5 leading-relaxed">
              This will terminate the running mdrun process. Output files written so far will be preserved.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setPauseConfirmOpen(false)}
                className="px-4 py-2 text-xs text-gray-400 hover:text-gray-200 transition-colors rounded-lg hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmPause}
                className="px-4 py-2 text-xs bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors font-medium"
              >
                Stop Simulation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
