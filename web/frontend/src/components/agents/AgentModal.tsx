"use client";

import { useRef, useState } from "react";
import { X, Play, StopCircle, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { streamAgent, type AgentType } from "@/lib/agentStream";
import type { SSEEvent, ToolCallBlock, ThinkingBlock, TextBlock, ErrorBlock } from "@/lib/types";

// ── Types ──────────────────────────────────────────────────────────────

type AgentBlock =
  | { kind: "text"; content: string }
  | { kind: "thinking"; content: string; collapsed: boolean }
  | { kind: "tool_call"; tool_use_id: string; tool_name: string; input: Record<string, unknown>; result?: string; status: "pending" | "done" | "error" }
  | { kind: "error"; content: string };

// ── Block renderers ────────────────────────────────────────────────────

function TextRenderer({ block }: { block: { kind: "text"; content: string } }) {
  return (
    <div className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">
      {block.content}
    </div>
  );
}

function ThinkingRenderer({ block }: { block: { kind: "thinking"; content: string; collapsed: boolean } }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-purple-800/40 bg-purple-950/20 overflow-hidden text-xs">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full px-3 py-2 text-purple-400 hover:text-purple-300 transition-colors"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span className="font-medium">Thinking</span>
      </button>
      {open && (
        <pre className="px-3 pb-3 text-purple-300/70 whitespace-pre-wrap max-h-48 overflow-y-auto font-mono text-[10px]">
          {block.content}
        </pre>
      )}
    </div>
  );
}

const TOOL_ICONS: Record<string, string> = {
  search_papers: "🔍",
  fetch_arxiv_paper: "📄",
  download_and_read_paper: "⬇️",
  extract_md_settings_from_paper: "🧠",
  search_rcsb_pdb: "🗄️",
  download_pdb_to_session: "💾",
  update_session_config: "⚙️",
  write_plumed_dat: "📝",
  list_simulation_files: "📁",
  read_colvar_stats: "📈",
  read_hills_stats: "⛰️",
  read_energy_stats: "⚡",
  read_log_progress: "📝",
  read_fes_summary: "🗺️",
  list_structure_files: "📁",
  read_atom_list: "🔬",
  read_residue_list: "🧬",
  generate_torsion_cv: "🔄",
  generate_distance_cv: "📏",
  generate_rmsd_cv: "📐",
  generate_metadynamics_bias: "⛰️",
};

function ToolCallRenderer({
  block,
}: {
  block: { kind: "tool_call"; tool_use_id: string; tool_name: string; input: Record<string, unknown>; result?: string; status: "pending" | "done" | "error" };
}) {
  const [open, setOpen] = useState(false);
  const icon = TOOL_ICONS[block.tool_name] ?? "🔧";
  const statusIcon =
    block.status === "pending" ? <Loader2 size={11} className="animate-spin text-blue-400" /> :
    block.status === "done"    ? <span className="text-emerald-400 text-[10px]">✓</span> :
                                  <span className="text-red-400 text-[10px]">✗</span>;

  return (
    <div className="rounded-lg border border-gray-700/60 bg-gray-800/40 overflow-hidden text-xs">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full px-3 py-2 hover:bg-gray-800/60 transition-colors text-left"
      >
        {open ? <ChevronDown size={11} className="text-gray-500" /> : <ChevronRight size={11} className="text-gray-500" />}
        <span>{icon}</span>
        <span className="font-mono text-gray-300 flex-1">{block.tool_name}</span>
        {statusIcon}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          <div>
            <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Input</p>
            <pre className="text-[10px] text-gray-400 whitespace-pre-wrap bg-gray-900/60 rounded p-2 max-h-32 overflow-y-auto">
              {JSON.stringify(block.input, null, 2)}
            </pre>
          </div>
          {block.result && (
            <div>
              <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Output</p>
              <pre className="text-[10px] text-gray-300 whitespace-pre-wrap bg-gray-900/60 rounded p-2 max-h-48 overflow-y-auto">
                {block.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Agent config ───────────────────────────────────────────────────────

interface AgentConfig {
  title: string;
  description: string;
  inputLabel: string;
  inputPlaceholder: string;
  defaultInput?: string;
  accent: string;
}

const AGENT_CONFIGS: Record<AgentType, AgentConfig> = {
  paper: {
    title: "Molecule Search Agent",
    description: "Finds PDB structures from RCSB and downloads them, or extracts GROMACS + PLUMED settings from a paper.",
    inputLabel: "PDB search, arXiv ID, or paper query",
    inputPlaceholder: "e.g. 'ubiquitin human'  or  2301.12345  or  'chignolin folding metadynamics'",
    accent: "blue",
  },
  analysis: {
    title: "Results Analyser",
    description: "Reads COLVAR, HILLS, energy files, and md.log — assesses convergence and gives recommendations.",
    inputLabel: "Analysis focus (optional)",
    inputPlaceholder: "e.g. 'Focus on convergence of phi/psi' or leave blank for full analysis",
    defaultInput: "Analyse the simulation results and assess convergence.",
    accent: "emerald",
  },
  cv: {
    title: "CV Suggester",
    description: "Reads your structure file and suggests appropriate collective variables for metadynamics.",
    inputLabel: "Simulation goal",
    inputPlaceholder: "e.g. 'Phi/psi for alanine dipeptide' or 'Folding of a beta hairpin'",
    accent: "indigo",
  },
};

// ── Main modal ─────────────────────────────────────────────────────────

interface Props {
  sessionId: string;
  agentType: AgentType;
  onClose: () => void;
}

export default function AgentModal({ sessionId, agentType, onClose }: Props) {
  const config = AGENT_CONFIGS[agentType];
  const [input, setInput] = useState(config.defaultInput ?? "");
  const [blocks, setBlocks] = useState<AgentBlock[]>([]);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const accentBorder = {
    blue: "border-blue-800/40",
    emerald: "border-emerald-800/40",
    indigo: "border-indigo-800/40",
  }[config.accent];

  const accentIcon = {
    blue: "bg-blue-900/40 text-blue-400",
    emerald: "bg-emerald-900/40 text-emerald-400",
    indigo: "bg-indigo-900/40 text-indigo-400",
  }[config.accent];

  const handleRun = async () => {
    if (running) return;
    setBlocks([]);
    setRunning(true);

    abortRef.current = new AbortController();

    try {
      for await (const event of streamAgent(
        sessionId,
        agentType,
        input || config.defaultInput || "",
        abortRef.current.signal
      )) {
        setBlocks((prev) => applyEvent(prev, event));
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

        if (event.type === "agent_done" || event.type === "error") {
          setRunning(false);
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setBlocks((prev) => [...prev, { kind: "error", content: String(err) }]);
      }
      setRunning(false);
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div
        className={`bg-gray-900 border ${accentBorder} rounded-2xl flex flex-col shadow-2xl`}
        style={{ width: "min(860px, 92vw)", height: "80vh" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-800 flex-shrink-0">
          <div className={`p-2 rounded-lg ${accentIcon} flex-shrink-0`}>
            <AgentIcon type={agentType} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-white">{config.title}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{config.description}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-gray-800 transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Input row */}
        <div className="flex gap-2 items-end px-5 py-3 border-b border-gray-800 flex-shrink-0">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">{config.inputLabel}</label>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !running) handleRun(); }}
              placeholder={config.inputPlaceholder}
              className="w-full border border-gray-700 rounded-lg px-3 py-2 bg-gray-800 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {running ? (
            <button
              onClick={handleStop}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-900/50 text-red-400 border border-red-800/50 hover:bg-red-800/50 transition-colors text-sm flex-shrink-0"
            >
              <StopCircle size={14} />
              Stop
            </button>
          ) : (
            <button
              onClick={handleRun}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors text-sm flex-shrink-0 font-medium"
            >
              <Play size={14} fill="currentColor" />
              Run
            </button>
          )}
        </div>

        {/* Output */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {blocks.length === 0 && !running && (
            <div className="h-full flex items-center justify-center text-gray-600 text-sm">
              Configure the input above and click Run to start the agent.
            </div>
          )}
          {running && blocks.length === 0 && (
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <Loader2 size={14} className="animate-spin" />
              Starting agent…
            </div>
          )}
          {blocks.map((block, i) => (
            <div key={i}>
              {block.kind === "text" && <TextRenderer block={block} />}
              {block.kind === "thinking" && <ThinkingRenderer block={block} />}
              {block.kind === "tool_call" && <ToolCallRenderer block={block} />}
              {block.kind === "error" && (
                <div className="text-xs text-red-400 bg-red-950/30 border border-red-900 rounded-lg px-3 py-2">
                  Error: {block.content}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}

// ── SSE event → block reducer ──────────────────────────────────────────

function applyEvent(prev: AgentBlock[], event: SSEEvent): AgentBlock[] {
  const blocks = [...prev];

  switch (event.type) {
    case "text_delta": {
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "text") {
        blocks[blocks.length - 1] = { kind: "text", content: last.content + event.text };
      } else {
        blocks.push({ kind: "text", content: event.text });
      }
      return blocks;
    }
    case "thinking":
      blocks.push({ kind: "thinking", content: event.thinking, collapsed: true });
      return blocks;

    case "tool_start":
      blocks.push({
        kind: "tool_call",
        tool_use_id: event.tool_use_id,
        tool_name: event.tool_name,
        input: event.tool_input,
        status: "pending",
      });
      return blocks;

    case "tool_result": {
      return blocks.map((b) =>
        b.kind === "tool_call" && b.tool_use_id === event.tool_use_id
          ? { ...b, status: "done" as const, result: (event.result as { output?: string })?.output ?? JSON.stringify(event.result) }
          : b
      );
    }
    case "agent_done":
      return blocks;

    case "error":
      blocks.push({ kind: "error", content: event.message });
      return blocks;

    default:
      return blocks;
  }
}

// ── Agent icon ─────────────────────────────────────────────────────────

function AgentIcon({ type }: { type: AgentType }) {
  if (type === "paper") return <span className="text-sm">📄</span>;
  if (type === "analysis") return <span className="text-sm">🔬</span>;
  return <span className="text-sm">💡</span>;
}
