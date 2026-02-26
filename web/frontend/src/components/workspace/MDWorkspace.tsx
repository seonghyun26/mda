"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Settings,
  Cpu,
  Zap,
  FlaskConical,
  Play,
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
} from "lucide-react";
import SimulationStatus from "@/components/status/SimulationStatus";
import EnergyPlot from "@/components/viz/EnergyPlot";
import ColvarPlot from "@/components/viz/ColvarPlot";
import RamachandranPlot from "@/components/viz/RamachandranPlot";
import FileUpload from "@/components/files/FileUpload";
import MoleculeViewer from "@/components/viz/MoleculeViewer";
import {
  getSessionConfig,
  updateSessionConfig,
  listFiles,
  downloadUrl,
  getConfigOptions,
  createSession,
} from "@/lib/api";
import type { ConfigOptions } from "@/lib/types";
import { useSessionStore } from "@/store/sessionStore";

// ── Helpers ───────────────────────────────────────────────────────────

function formatDateTime(): string {
  const now = new Date();
  return now.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function defaultWorkDir(): string {
  const now = new Date();
  const d = now.toISOString().slice(0, 10);
  const t = now.toTimeString().slice(0, 8).replace(/:/g, "-");
  return `outputs/${d}_${t}`;
}

// ── UI primitives ─────────────────────────────────────────────────────

/** Section card with a header label and icon */
function Section({
  icon,
  title,
  children,
  accent = "blue",
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  accent?: "blue" | "indigo" | "emerald" | "amber";
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
  { value: "system", label: "System", icon: <FlaskConical size={12} /> },
  { value: "gromacs", label: "GROMACS", icon: <Cpu size={12} /> },
  { value: "method", label: "Method", icon: <Zap size={12} /> },
  { value: "plumed", label: "PLUMED", icon: <Settings size={12} /> },
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

// ── Progress tab ───────────────────────────────────────────────────────

function ProgressTab({ sessionId }: { sessionId: string }) {
  return (
    <div className="p-4 space-y-4">
      <SimulationStatus />
      <div className="space-y-4 pt-2">
        <div className="flex items-center gap-2">
          <div className="h-px flex-1 bg-gray-800" />
          <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider">Analysis</span>
          <div className="h-px flex-1 bg-gray-800" />
        </div>
        <EnergyPlot sessionId={sessionId} />
        <ColvarPlot sessionId={sessionId} />
        <RamachandranPlot sessionId={sessionId} />
      </div>
    </div>
  );
}

// ── System tab ─────────────────────────────────────────────────────────

const MOL_EXTS = new Set(["pdb", "gro", "mol2", "xyz", "sdf"]);
function isMolFile(path: string) {
  return MOL_EXTS.has(path.split(".").pop()?.toLowerCase() ?? "");
}

function SystemTab({ sessionId }: { sessionId: string }) {
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [fileRefresh, setFileRefresh] = useState(0);
  const [viewer, setViewer] = useState<{ content: string; name: string } | null>(null);
  const [viewLoading, setViewLoading] = useState<string | null>(null);

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

  const handleVisualize = async (filePath: string) => {
    const name = filePath.split("/").pop() ?? filePath;
    setViewLoading(name);
    try {
      const res = await fetch(downloadUrl(sessionId, filePath));
      const content = await res.text();
      setViewer({ content, name });
    } catch {
      /* ignore */
    } finally {
      setViewLoading(null);
    }
  };

  const molFiles = files.filter(isMolFile);
  const otherFiles = files.filter((f) => !isMolFile(f));

  return (
    <div className="p-4 space-y-4">
      {/* Molecule files */}
      <Section icon={<FlaskConical size={13} />} title="Molecule Files" accent="indigo">
        <div className="flex items-center justify-between -mt-1 mb-1">
          <span className="text-xs text-gray-500">PDB, GRO, MOL2 — visualize before running</span>
          <button
            onClick={refreshFiles}
            className="text-gray-600 hover:text-gray-400 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {molFiles.length === 0 ? (
          <p className="text-xs text-gray-600 py-1">
            No molecule files yet — upload a PDB or GRO below.
          </p>
        ) : (
          <div className="space-y-1.5">
            {molFiles.map((f) => {
              const name = f.split("/").pop() ?? f;
              const isLoading = viewLoading === name;
              return (
                <div
                  key={f}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700/50"
                >
                  <span className="text-base">🧬</span>
                  <span className="text-xs text-gray-200 truncate flex-1 font-mono" title={f}>
                    {name}
                  </span>
                  <button
                    onClick={() => handleVisualize(f)}
                    disabled={isLoading}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs bg-indigo-700/70 hover:bg-indigo-600 text-indigo-200 border border-indigo-700/50 transition-colors disabled:opacity-50 flex-shrink-0"
                  >
                    {isLoading ? <RefreshCw size={10} className="animate-spin" /> : <Eye size={10} />}
                    Visualize
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* Upload */}
      <Section icon={<Upload size={13} />} title="Upload File" accent="blue">
        <FileUpload sessionId={sessionId} onUploaded={() => setFileRefresh((n) => n + 1)} />
      </Section>

      {/* Other files */}
      {otherFiles.length > 0 && (
        <Section icon={<FileText size={13} />} title="Simulation Files" accent="emerald">
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {otherFiles.map((f) => {
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
        </Section>
      )}

      {viewer && (
        <MoleculeViewer
          fileContent={viewer.content}
          fileName={viewer.name}
          onClose={() => setViewer(null)}
        />
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

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200">GROMACS Parameters</h3>
        <SaveButton onSave={onSave} saved={saved} />
      </div>

      {/* Time integration */}
      <Section icon={<Timer size={13} />} title="Time Integration" accent="blue">
        <Field
          label="Timestep"
          type="number"
          value={String(gromacs.dt ?? "0.002")}
          onChange={(v) => onChange("gromacs.dt", Number(v))}
          unit="ps"
          hint="Leapfrog integrator step size. 2 fs is standard for most systems."
        />
      </Section>

      {/* Thermostat */}
      <Section icon={<Thermometer size={13} />} title="Thermostat" accent="amber">
        <Field
          label="Reference Temperature"
          type="number"
          value={String(gromacs.ref_t ?? "300")}
          onChange={(v) => onChange("gromacs.ref_t", Number(v))}
          unit="K"
          hint="Target temperature for Berendsen / V-rescale thermostat."
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

// ── Method tab ─────────────────────────────────────────────────────────

function MethodTab({
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
  const method = (cfg.method ?? {}) as Record<string, unknown>;
  const gromacs = (cfg.gromacs ?? {}) as Record<string, unknown>;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200">Sampling Method</h3>
        <SaveButton onSave={onSave} saved={saved} />
      </div>

      {/* Simulation length */}
      <Section icon={<Binary size={13} />} title="Simulation Length" accent="blue">
        <FieldGrid>
          <Field
            label="Steps"
            type="number"
            value={String(method.nsteps ?? "")}
            onChange={(v) => onChange("method.nsteps", Number(v))}
            hint="Total MD steps to run."
          />
          <Field
            label="Temperature"
            type="number"
            value={String(method.temperature ?? gromacs.ref_t ?? "300")}
            onChange={(v) => onChange("method.temperature", Number(v))}
            unit="K"
          />
        </FieldGrid>
      </Section>

      {/* Metadynamics bias */}
      <Section icon={<Mountain size={13} />} title="Metadynamics Bias" accent="indigo">
        <FieldGrid>
          <Field
            label="Hills height"
            type="number"
            value={String(method.hills_height ?? "")}
            onChange={(v) => onChange("method.hills_height", Number(v))}
            unit="kJ/mol"
            hint="Gaussian bias height."
          />
          <Field
            label="Hills pace"
            type="number"
            value={String(method.hills_pace ?? "")}
            onChange={(v) => onChange("method.hills_pace", Number(v))}
            unit="steps"
            hint="Deposition frequency."
          />
        </FieldGrid>
      </Section>
    </div>
  );
}

// ── PLUMED tab ─────────────────────────────────────────────────────────

function PlumedTab() {
  return (
    <div className="p-4 space-y-4">
      <h3 className="text-sm font-semibold text-gray-200">PLUMED / Collective Variables</h3>

      <Section icon={<Layers size={13} />} title="About PLUMED CVs" accent="indigo">
        <p className="text-xs text-gray-400 leading-relaxed">
          PLUMED parameters are set dynamically by the AI assistant based on your simulation
          description. The agent generates the PLUMED <code className="text-indigo-400 bg-gray-800 px-1 rounded">.dat</code> file
          from Jinja2 templates in <code className="text-indigo-400 bg-gray-800 px-1 rounded">templates/plumed/</code>.
        </p>
      </Section>

      <Section icon={<MessageSquare size={13} />} title="Example Instructions" accent="blue">
        <div className="space-y-2">
          {[
            "Set up phi/psi dihedrals for alanine dipeptide",
            "Use hills height 0.5 kJ/mol, sigma 0.3 rad",
            "Add an upper wall at phi = 2.0 rad",
            "Restart metadynamics from an existing HILLS file",
          ].map((ex) => (
            <div
              key={ex}
              className="px-3 py-2 rounded-lg bg-gray-800/60 border border-gray-700/50 text-xs text-gray-400 font-mono"
            >
              &ldquo;{ex}&rdquo;
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

// ── New session form ───────────────────────────────────────────────────

function NewSessionForm({ onCreated }: { onCreated: (id: string, workDir: string, nickname: string) => void }) {
  const [options, setOptions] = useState<ConfigOptions>({
    methods: ["metadynamics"],
    systems: ["protein"],
    gromacs: ["default"],
    plumed_cvs: ["default"],
  });
  const [form, setForm] = useState({
    method: "metadynamics",
    system: "protein",
    gromacs: "default",
    plumed_cvs: "default",
    workDir: defaultWorkDir(),
    nickname: formatDateTime(),
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getConfigOptions()
      .then((opts) => {
        setOptions(opts);
        setForm((f) => ({
          ...f,
          method: opts.methods[0] ?? f.method,
          system: opts.systems[0] ?? f.system,
          gromacs: opts.gromacs[0] ?? f.gromacs,
          plumed_cvs: opts.plumed_cvs[0] ?? f.plumed_cvs,
        }));
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { session_id, work_dir, nickname } = await createSession({
        method: form.method,
        system: form.system,
        gromacs: form.gromacs,
        plumed_cvs: form.plumed_cvs,
        workDir: form.workDir,
        nickname: form.nickname,
      });
      onCreated(session_id, work_dir, nickname);
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  };

  const Select = ({
    label,
    value,
    opts,
    onChange,
    hint,
  }: {
    label: string;
    value: string;
    opts: string[];
    onChange: (v: string) => void;
    hint?: string;
  }) => (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-700 rounded-lg px-3 py-2 bg-gray-800 text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      >
        {opts.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      {hint && <p className="mt-1 text-[11px] text-gray-600">{hint}</p>}
    </div>
  );

  return (
    <div className="flex h-full items-center justify-center p-6 overflow-y-auto">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 mb-3 shadow-lg">
            <FlaskConical size={22} className="text-white" />
          </div>
          <h2 className="text-xl font-bold text-gray-100">New Simulation</h2>
          <p className="text-sm text-gray-500 mt-1">Configure your MD session</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Session identity */}
          <div className="rounded-xl border border-gray-700/60 bg-gray-900/60 p-4 space-y-3">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Session</p>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                Name <span className="text-gray-600">(editable anytime)</span>
              </label>
              <input
                type="text"
                value={form.nickname}
                onChange={(e) => setForm({ ...form, nickname: e.target.value })}
                className="w-full border border-gray-700 rounded-lg px-3 py-2 bg-gray-800 text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Output directory</label>
              <input
                type="text"
                value={form.workDir}
                onChange={(e) => setForm({ ...form, workDir: e.target.value })}
                className="w-full border border-gray-700 rounded-lg px-3 py-2 bg-gray-800 text-gray-100 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Method + System */}
          <div className="rounded-xl border border-gray-700/60 bg-gray-900/60 p-4 space-y-3">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Simulation</p>
            <Select
              label="Sampling Method"
              value={form.method}
              opts={options.methods}
              onChange={(v) => setForm({ ...form, method: v })}
            />
            <Select
              label="System"
              value={form.system}
              opts={options.systems}
              onChange={(v) => setForm({ ...form, system: v })}
            />
          </div>

          {/* GROMACS + PLUMED presets */}
          <div className="rounded-xl border border-gray-700/60 bg-gray-900/60 p-4 space-y-3">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Presets</p>
            <Select
              label="GROMACS Preset"
              value={form.gromacs}
              opts={options.gromacs}
              onChange={(v) => setForm({ ...form, gromacs: v })}
            />
            <Select
              label="Collective Variables"
              value={form.plumed_cvs}
              opts={options.plumed_cvs}
              onChange={(v) => setForm({ ...form, plumed_cvs: v })}
            />
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
            {loading ? "Creating session…" : "Create Session"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Main MDWorkspace ───────────────────────────────────────────────────

interface Props {
  sessionId: string | null;
  onSessionCreated: (id: string, workDir: string, nickname: string) => void;
  onStartMD: () => void;
}

export default function MDWorkspace({ sessionId, onSessionCreated, onStartMD }: Props) {
  const [cfg, setCfg] = useState<Record<string, unknown>>({});
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState("progress");
  const { setSession } = useSessionStore();

  useEffect(() => {
    if (!sessionId) return;
    getSessionConfig(sessionId).then((r) => setCfg(r.config)).catch(() => {});
  }, [sessionId]);

  const handleChange = (dotKey: string, value: unknown) => {
    const [section, key] = dotKey.split(".");
    setCfg((c) => ({
      ...c,
      [section]: { ...(c[section] as object ?? {}), [key]: value },
    }));
  };

  const handleSave = async () => {
    if (!sessionId) return;
    await updateSessionConfig(sessionId, cfg).catch(() => {});
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSessionCreated = (id: string, workDir: string, nickname: string) => {
    setSession(id, { method: "", system: "", gromacs: "", plumed_cvs: "", workDir });
    onSessionCreated(id, workDir, nickname);
  };

  if (!sessionId) {
    return (
      <div className="flex-1 flex flex-col bg-gray-950 h-full">
        <NewSessionForm onCreated={handleSessionCreated} />
      </div>
    );
  }

  const tabContent: Record<string, React.ReactNode> = {
    progress: <ProgressTab sessionId={sessionId} />,
    system: <SystemTab sessionId={sessionId} />,
    gromacs: <GromacsTab cfg={cfg} onChange={handleChange} onSave={handleSave} saved={saved} />,
    method: <MethodTab cfg={cfg} onChange={handleChange} onSave={handleSave} saved={saved} />,
    plumed: <PlumedTab />,
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

