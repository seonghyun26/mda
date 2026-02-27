"use client";

import { useEffect, useRef, useState } from "react";
import { X, Loader2, AlertCircle, Crosshair, Camera } from "lucide-react";

interface Props {
  fileContent: string;
  fileName: string;
  onClose?: () => void;
  inline?: boolean;
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    NGL: any;
  }
}

interface RepState {
  ball: boolean;
  stick: boolean;
  ribbon: boolean;
  surface: boolean;
}

const REP_LABELS: { key: keyof RepState; label: string }[] = [
  { key: "ball",   label: "Ball"    },
  { key: "stick",  label: "Stick"   },
  { key: "ribbon", label: "Cartoon" },
  { key: "surface", label: "Surface" },
];

// ── Representation rendering (NGL) ────────────────────────────────────
// ball    → NGL "spacefill"  (element colour scheme)
// stick   → NGL "licorice"   (sticks only, no spheres)
// ribbon  → NGL "cartoon"    (protein cartoon, residue-index colours)
// surface → NGL "surface"    (molecular surface, white, opacity 0.1)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyRepresentations(component: any, reps: RepState) {
  component.removeAllRepresentations();
  if (reps.ball) {
    component.addRepresentation("spacefill", { colorScheme: "element", radiusScale: 0.2 });
  }
  if (reps.stick) {
    component.addRepresentation("licorice", { colorScheme: "element" });
  }
  if (reps.ribbon) {
    component.addRepresentation("cartoon", { sele: "protein", colorScheme: "residueindex" });
  }
  if (reps.surface) {
    component.addRepresentation("surface", { color: "white", opacity: 0.1 });
  }
}

export default function MoleculeViewer({ fileContent, fileName, onClose, inline = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stageRef     = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const componentRef = useRef<any>(null);
  const repsRef      = useRef<RepState>({ ball: true, stick: true, ribbon: false, surface: false });

  const [ready, setReady]   = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [reps, setReps]     = useState<RepState>({ ball: true, stick: true, ribbon: false, surface: false });

  // Keep repsRef in sync for use inside async callbacks
  useEffect(() => { repsRef.current = reps; }, [reps]);

  // Re-apply representations when toggles change without reloading the file
  useEffect(() => {
    if (!componentRef.current) return;
    applyRepresentations(componentRef.current, reps);
  }, [reps]);

  // Load / reload structure when file content or name changes
  useEffect(() => {
    setReady(false);
    setError(null);
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "pdb";
    let ro: ResizeObserver | null = null;

    const initViewer = () => {
      if (!containerRef.current || !window.NGL) return;

      if (stageRef.current) {
        stageRef.current.dispose();
        stageRef.current = null;
      }
      componentRef.current = null;
      containerRef.current.innerHTML = "";

      const stage = new window.NGL.Stage(containerRef.current, { backgroundColor: "#111827" });
      stageRef.current = stage;

      ro = new ResizeObserver(() => stage.handleResize());
      ro.observe(containerRef.current);

      const blob = new Blob([fileContent], { type: "text/plain" });
      stage
        .loadFile(blob, { ext })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then((component: any) => {
          componentRef.current = component;
          applyRepresentations(component, repsRef.current);
          component.autoView(400);   // center + fit on load
          setReady(true);
        })
        .catch((err: unknown) => {
          setError(String(err));
        });
    };

    if (window.NGL) {
      initViewer();
    } else {
      const existing = document.getElementById("ngl-script");
      if (existing) {
        existing.addEventListener("load", initViewer);
      } else {
        const script = document.createElement("script");
        script.id = "ngl-script";
        script.src = "https://cdn.jsdelivr.net/npm/ngl/dist/ngl.js";
        script.async = true;
        script.onload = initViewer;
        document.head.appendChild(script);
      }
    }

    return () => {
      ro?.disconnect();
      if (stageRef.current) {
        stageRef.current.dispose();
        stageRef.current = null;
      }
      componentRef.current = null;
    };
  }, [fileContent, fileName]);

  const handleResetView = () => {
    componentRef.current?.autoView(400);
  };

  const handleScreenshot = () => {
    if (!stageRef.current) return;
    stageRef.current
      .makeImage({ factor: 6, antialias: true, trim: false, transparent: true })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((blob: any) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${fileName.replace(/\.[^.]+$/, "")}_view.png`;
        a.click();
        URL.revokeObjectURL(url);
      });
  };

  /** Toggle buttons shown to the right of the canvas */
  const RepColumn = () => (
    <div className="flex flex-col gap-1.5 w-[92px] flex-shrink-0 pt-0.5">
      <span className="text-[9px] font-semibold text-gray-600 uppercase tracking-wider text-center">
        Representation
      </span>
      {REP_LABELS.map(({ key, label }) => {
        const on = reps[key];
        return (
          <button
            key={key}
            onClick={() => setReps((r) => ({ ...r, [key]: !r[key] }))}
            disabled={!ready}
            className={`py-1.5 rounded-lg text-[10px] font-medium text-center transition-colors border disabled:opacity-40 ${
              on
                ? "bg-indigo-600 border-indigo-500 text-white"
                : "bg-gray-800/60 border-gray-700/50 text-gray-400 hover:text-gray-200 hover:bg-gray-800"
            }`}
          >
            {label}
          </button>
        );
      })}
      <div className="h-px bg-gray-700/50 my-0.5" />
      <button
        onClick={handleResetView}
        disabled={!ready}
        title="Reset view"
        className="flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-medium text-center transition-colors border border-gray-700/50 bg-gray-800/60 text-gray-400 hover:text-gray-200 hover:bg-gray-800 disabled:opacity-40"
      >
        <Crosshair size={10} />
        Reset View
      </button>
      <button
        onClick={handleScreenshot}
        disabled={!ready}
        title="Download screenshot"
        className="flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-medium text-center transition-colors border border-gray-700/50 bg-gray-800/60 text-gray-400 hover:text-gray-200 hover:bg-gray-800 disabled:opacity-40"
      >
        <Camera size={10} />
        Screenshot
      </button>
    </div>
  );

  if (inline) {
    return (
      <div className="flex gap-3 items-start">
        {/* Viewer canvas */}
        <div
          className="relative flex-1 rounded-xl overflow-hidden border border-gray-700/60 bg-gray-900 min-w-0"
          style={{ height: "520px" }}
        >
          {error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-red-400 gap-2 p-4 z-10">
              <AlertCircle size={20} />
              <span className="text-xs text-center break-all">{error}</span>
            </div>
          ) : !ready ? (
            <div className="absolute inset-0 flex items-center justify-center text-gray-400 z-10">
              <Loader2 size={20} className="animate-spin mr-2" />
              <span className="text-xs">Loading…</span>
            </div>
          ) : null}
          <div ref={containerRef} className="w-full h-full" />
          {ready && (
            <div className="absolute bottom-0 left-0 right-0 px-3 py-1 bg-gray-900/80 text-[10px] text-gray-500">
              drag to rotate · scroll to zoom · right-click to translate
            </div>
          )}
        </div>

        {/* Display toggles — right of canvas */}
        <RepColumn />
      </div>
    );
  }

  // ── Popup / modal variant ──────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div
        className="bg-gray-900 rounded-2xl overflow-hidden flex flex-col shadow-2xl border border-gray-700"
        style={{ width: "75vw", height: "75vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-sm font-mono text-gray-200">{fileName}</span>
            <span className="text-xs text-gray-500">3D Viewer</span>
            {/* Toggle buttons in popup header */}
            <div className="flex gap-1 ml-2">
              {REP_LABELS.map(({ key, label }) => {
                const on = reps[key];
                return (
                  <button
                    key={key}
                    onClick={() => setReps((r) => ({ ...r, [key]: !r[key] }))}
                    disabled={!ready}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors border disabled:opacity-40 ${
                      on
                        ? "bg-indigo-600 border-indigo-500 text-white"
                        : "bg-gray-700/50 border-gray-600/50 text-gray-400 hover:text-gray-200"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Viewer */}
        <div className="relative flex-1">
          {error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-red-400 gap-2 z-10">
              <AlertCircle size={24} />
              <span className="text-sm">{error}</span>
            </div>
          ) : !ready ? (
            <div className="absolute inset-0 flex items-center justify-center text-gray-400 z-10">
              <Loader2 size={24} className="animate-spin mr-2" />
              <span className="text-sm">Loading viewer…</span>
            </div>
          ) : null}
          <div ref={containerRef} className="w-full h-full" />
        </div>

        <div className="px-4 py-2 bg-gray-800/50 border-t border-gray-700 text-xs text-gray-500 flex-shrink-0">
          Drag to rotate · Scroll to zoom · Right-click to translate
        </div>
      </div>
    </div>
  );
}
