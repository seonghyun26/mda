"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Settings,
  Cpu,
  Zap,
  FlaskConical,
  Play,
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
  createSession,
  updateSessionMolecule,
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
  { id: "ala_vacuum", label: "Vacuum", description: "Dodecahedron vacuum box · no solvent · fast"        },
  { id: "nvt",        label: "NVT",    description: "Canonical ensemble · constant volume · 100 ps"      },
  { id: "npt",        label: "NPT",    description: "Isobaric ensemble · Parrinello–Rahman barostat"     },
  { id: "blank",      label: "Blank",  description: "No template — configure manually"                   },
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
  type = "text",
  unit,
  hint,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
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

function SaveButton({ onSave, saved }: { onSave: () => void; saved: boolean }) {
  return (
    <button
      onClick={onSave}
      className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${
        saved
          ? "bg-emerald-700/30 text-emerald-400 border border-emerald-700/50"
          : "bg-blue-600 hover:bg-blue-700 text-white"
      }`}
    >
      {saved && <CheckCircle2 size={11} />}
      {saved ? "Saved" : "Save changes"}
    </button>
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

// ── Progress tab ───────────────────────────────────────────────────────

function ProgressTab({ sessionId }: { sessionId: string }) {
  const [agentOpen, setAgentOpen] = useState(false);
  const [simFiles, setSimFiles] = useState<string[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);

  const refreshFiles = useCallback(() => {
    setFilesLoading(true);
    listFiles(sessionId)
      .then(({ files }) => setSimFiles(files.filter((f) => !isMolFile(f))))
      .catch(() => {})
      .finally(() => setFilesLoading(false));
  }, [sessionId]);

  useEffect(() => {
    refreshFiles();
  }, [refreshFiles]);

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
              onClick={refreshFiles}
              className="text-gray-600 hover:text-gray-400 transition-colors"
              title="Refresh"
            >
              <RefreshCw size={11} className={filesLoading ? "animate-spin" : ""} />
            </button>
            <a
              href={downloadZipUrl(sessionId)}
              download
              className="flex items-center gap-1 text-gray-600 hover:text-gray-400 transition-colors"
              title="Download ZIP"
            >
              <Download size={11} />
            </a>
          </div>
        }
      >
        {simFiles.length === 0 ? (
          <p className="text-xs text-gray-600 py-1">No simulation files yet.</p>
        ) : (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {simFiles.map((f) => {
              const name = f.split("/").pop() ?? f;
              return (
                <a
                  key={f}
                  href={downloadUrl(sessionId, f)}
                  download={name}
                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-800 transition-colors group"
                >
                  <span className="text-gray-600 text-xs group-hover:text-gray-400 font-mono">{name}</span>
                </a>
              );
            })}
          </div>
        )}
      </Section>

      {agentOpen && (
        <AgentModal sessionId={sessionId} agentType="analysis" onClose={() => setAgentOpen(false)} />
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
          Extract from Paper
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
            className="text-gray-600 hover:text-gray-400 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
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
  saved,
}: {
  cfg: Record<string, unknown>;
  onChange: (k: string, v: unknown) => void;
  onSave: () => void;
  saved: boolean;
}) {
  const gromacs = (cfg.gromacs ?? {}) as Record<string, unknown>;
  const method  = (cfg.method  ?? {}) as Record<string, unknown>;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200">GROMACS Parameters</h3>
        <SaveButton onSave={onSave} saved={saved} />
      </div>

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
                hint="Total MD steps to run."
              />
              <Field
                label="Timestep"
                type="number"
                value={String(Number(gromacs.dt ?? 0.002) * 1000)}
                onChange={(v) => onChange("gromacs.dt", Number(v) / 1000)}
                unit="fs"
                hint="2 fs is standard."
              />
            </FieldGrid>
          </Section>
        );
      })()}

      {/* Thermostat */}
      <Section icon={<Thermometer size={13} />} title="Temperature" accent="amber">
        <Field
          label="Reference Temperature"
          type="number"
          value={String(gromacs.ref_t ?? gromacs.temperature ?? "300")}
          onChange={(v) => onChange("gromacs.ref_t", Number(v))}
          unit="K"
          hint="Target temperature for V-rescale thermostat."
        />
      </Section>

      {/* Non-bonded cutoffs */}
      <Section icon={<Gauge size={13} />} title="Non-bonded Cutoffs" accent="indigo">
        <FieldGrid>
          <Field
            label="Coulomb cutoff"
            type="number"
            value={String(gromacs.rcoulomb ?? "1.0")}
            onChange={(v) => onChange("gromacs.rcoulomb", Number(v))}
            unit="nm"
          />
          <Field
            label="VdW cutoff"
            type="number"
            value={String(gromacs.rvdw ?? "1.0")}
            onChange={(v) => onChange("gromacs.rvdw", Number(v))}
            unit="nm"
          />
        </FieldGrid>
        <p className="text-[11px] text-gray-600">Typically match Coulomb and VdW cutoffs.</p>
      </Section>
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
  saved,
}: {
  sessionId: string;
  cfg: Record<string, unknown>;
  onChange: (k: string, v: unknown) => void;
  onSave: () => void;
  saved: boolean;
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
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200">Simulation Method</h3>
        <SaveButton onSave={onSave} saved={saved} />
      </div>

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
              unit="kJ/mol"
              hint="Gaussian bias height."
            />
            <Field
              label="Hills pace"
              type="number"
              value={String(hills.pace ?? "")}
              onChange={(v) => onChange("method.hills.pace", Number(v))}
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
              hint="Gaussian width (CV units)."
            />
            <Field
              label="Bias factor γ"
              type="number"
              value={String(hills.biasfactor ?? "")}
              onChange={(v) => onChange("method.hills.biasfactor", Number(v))}
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
  onStartMD: () => void;
  onNewSession: () => void;
}

export default function MDWorkspace({ sessionId, showNewForm, onSessionCreated, onStartMD, onNewSession }: Props) {
  const [cfg, setCfg] = useState<Record<string, unknown>>({});
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState("progress");
  const [selectedMolecule, setSelectedMolecule] = useState<{ content: string; name: string } | null>(null);
  const { setSession, sessions, setSessionMolecule } = useSessionStore();
  // Stable ref — lets the restore effect read latest sessions without re-running
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

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
      return { ...c, [section]: setDeep((c[section] as Record<string, unknown>) ?? {}, rest) };
    });
  };

  const handleSave = async () => {
    if (!sessionId) return;
    await updateSessionConfig(sessionId, cfg).catch(() => {});
    await generateSessionFiles(sessionId).catch(() => {});
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
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
    gromacs:  <GromacsTab cfg={cfg} onChange={handleChange} onSave={handleSave} saved={saved} />,
    method:   <MethodTab sessionId={sessionId} cfg={cfg} onChange={handleChange} onSave={handleSave} saved={saved} />,
  };

  return (
    <div className="flex-1 flex flex-col bg-gray-950 h-full min-w-0">
      <PillTabs active={activeTab} onChange={setActiveTab} />

      <div className="flex-1 overflow-y-auto">
        {tabContent[activeTab]}
      </div>

      {/* Start MD button */}
      <div className="flex-shrink-0 p-4 border-t border-gray-800 bg-gray-900/50">
        <button
          onClick={onStartMD}
          className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold rounded-xl transition-all shadow-lg shadow-blue-900/30 text-sm"
        >
          <Play size={16} fill="currentColor" />
          Start MD Simulation
        </button>
      </div>
    </div>
  );
}
