"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Camera, Crosshair, Film, Loader2, Pause, Play } from "lucide-react";
import { downloadUrl, getFileContent } from "@/lib/api";
import { suppressNglDeprecationWarnings } from "@/lib/ngl";

interface Props {
  sessionId: string;
  topologyPath: string;
  trajectoryPath: string;
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    NGL: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    GIF: any;
  }
}

type LoadingStage = "ngl" | "topology" | "trajectory" | "frames" | null;

const LOADING_LABELS: Record<NonNullable<LoadingStage>, string> = {
  ngl:        "Loading viewer…",
  topology:   "Loading structure…",
  trajectory: "Loading trajectory…",
  frames:     "Reading frames…",
};

function parseStructureInfo(
  content: string,
  fileName: string,
): { atoms: number; residues: number } | null {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "gro") {
    const lines = content.split("\n");
    const atoms = parseInt(lines[1]?.trim() ?? "", 10);
    if (isNaN(atoms)) return null;
    const seen = new Set<string>();
    for (let i = 2; i < 2 + atoms && i < lines.length; i++) {
      const l = lines[i];
      if (l.length < 10) continue;
      seen.add(l.substring(0, 5).trim() + ":" + l.substring(5, 10).trim());
    }
    return { atoms, residues: seen.size };
  }
  if (ext === "pdb") {
    let atoms = 0;
    const seen = new Set<string>();
    for (const l of content.split("\n")) {
      if (l.startsWith("ATOM  ") || l.startsWith("HETATM")) {
        atoms++;
        seen.add(l.substring(21, 22) + l.substring(22, 26).trim());
      }
    }
    return atoms > 0 ? { atoms, residues: seen.size } : null;
  }
  return null;
}

/** Base64url-encode a JSON payload for embedding in a URL path segment. */
function encodePathsB64(xtc: string, top: string): string {
  return btoa(JSON.stringify({ xtc, top }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export default function TrajectoryViewer({ sessionId, topologyPath, trajectoryPath }: Props) {
  const containerRef     = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stageRef         = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const componentRef     = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerRef        = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trajectoryRef    = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const initialOrientRef = useRef<any>(null);
  const repsRef          = useRef({ ball: true, stick: true, ribbon: false, surface: false });

  const [reps, setReps] = useState(repsRef.current);
  useEffect(() => { repsRef.current = reps; }, [reps]);

  const [ready, setReady]               = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [loadingStage, setLoadingStage] = useState<LoadingStage>("ngl");
  const [playing, setPlaying]           = useState(false);
  const [frame, setFrame]               = useState(0);
  const [totalFrames, setTotalFrames]   = useState<number | null>(null);
  const [structInfo, setStructInfo]     = useState<{ atoms: number; residues: number } | null>(null);
  const [gifGenerating, setGifGenerating] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyRepresentations = (component: any, currentReps?: typeof reps) => {
    const r = currentReps ?? repsRef.current;
    component.removeAllRepresentations();
    if (r.ball)    component.addRepresentation("spacefill", { colorScheme: "element", radiusScale: 0.2 });
    if (r.stick)   component.addRepresentation("licorice",  { colorScheme: "element" });
    if (r.ribbon)  component.addRepresentation("cartoon",   { sele: "protein", colorScheme: "residueindex" });
    if (r.surface) component.addRepresentation("surface",   { color: "white", opacity: 0.1 });
  };

  useEffect(() => {
    if (!componentRef.current) return;
    applyRepresentations(componentRef.current);
  }, [reps]);

  useEffect(() => {
    let ro: ResizeObserver | null = null;
    let cancelled = false;
    setReady(false);
    setError(null);
    setPlaying(false);
    setFrame(0);
    setTotalFrames(null);
    setStructInfo(null);
    setLoadingStage("ngl");
    initialOrientRef.current = null;
    trajectoryRef.current = null;

    // Fetch topology content in parallel for the struct-info overlay
    getFileContent(sessionId, topologyPath)
      .then((content) => {
        if (!cancelled) {
          const name = topologyPath.split("/").pop() ?? topologyPath;
          setStructInfo(parseStructureInfo(content, name));
        }
      })
      .catch(() => { /* overlay is optional */ });

    const init = () => {
      if (!containerRef.current || !window.NGL || cancelled) return;

      // NGL 2.4+ requires TrajectoryDatasource to be configured before addTrajectory.
      // We set it to route through our backend endpoints.
      window.NGL.TrajectoryDatasource = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getCountUrl: (trajPath: string) => `${trajPath}/numframes`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getFrameUrl: (trajPath: string, frameIndex: number) => `${trajPath}/frame/${frameIndex}`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getFrameParams: (_trajPath: string, atomIndices: any) =>
          atomIndices?.length
            ? `atomIndices=${(atomIndices as number[][]).map((r) => r.join(",")).join(";")}`
            : "",
      };

      suppressNglDeprecationWarnings();
      const stage = new window.NGL.Stage(containerRef.current, { backgroundColor: "#111827" });
      stageRef.current = stage;
      ro = new ResizeObserver(() => stage.handleResize());
      ro.observe(containerRef.current);

      const topologyExt = topologyPath.split(".").pop()?.toLowerCase() || "gro";
      const topologyUrl = downloadUrl(sessionId, topologyPath);

      // Build the NGL RemoteTrajectory base URL.
      // NGL appends "/numframes" and "/frame/{i}" to this URL.
      // We encode both paths in base64url to avoid query-string conflicts.
      const combined    = encodePathsB64(trajectoryPath, topologyPath);
      const trajApiBase = `/api/sessions/${sessionId}/ngl-traj/${combined}`;

      setLoadingStage("topology");
      stage
        .loadFile(topologyUrl, {
          ext: topologyExt,
          defaultRepresentation: false,
          name: topologyPath.split("/").pop() || "topology",
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then((comp: any) => {
          if (cancelled) return;
          componentRef.current = comp;
          comp.autoView(600);
          setTimeout(() => {
            try { initialOrientRef.current = stage.viewerControls.getOrientation(); } catch { /* ignore */ }
          }, 650);

          setLoadingStage("trajectory");
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const trajComp = comp.addTrajectory(trajApiBase, { centerPbc: true, removePbc: true } as any);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const traj = trajComp?.trajectory as any;
          trajectoryRef.current = traj;
          if (traj?.signals?.frameChanged) {
            traj.signals.frameChanged.add((i: number) => setFrame(i));
          }

          const initPlayer = (n: number) => {
            if (cancelled) return;
            setTotalFrames(Number(n));
            applyRepresentations(comp, repsRef.current);
            playerRef.current = new window.NGL.TrajectoryPlayer(traj, { step: 1, timeout: 80, mode: "loop" });
            setLoadingStage(null);
            setReady(true);
          };

          if (traj?.numframes) {
            initPlayer(traj.numframes);
          } else if (traj?.signals?.countChanged) {
            setLoadingStage("frames");
            traj.signals.countChanged.add(initPlayer);
          } else {
            applyRepresentations(comp, repsRef.current);
            playerRef.current = new window.NGL.TrajectoryPlayer(traj, { step: 1, timeout: 80, mode: "loop" });
            setLoadingStage(null);
            setReady(true);
          }
        })
        .catch((e: unknown) => {
          if (!cancelled) {
            setLoadingStage(null);
            setError(String(e));
          }
        });
    };

    let scriptEl: HTMLScriptElement | null = null;
    let loadHandler: (() => void) | null = null;

    if (window.NGL) {
      init();
    } else {
      const existing = document.getElementById("ngl-script") as HTMLScriptElement | null;
      if (existing) {
        scriptEl = existing;
        if (window.NGL || existing.dataset.loaded === "true") {
          init();
        } else {
          loadHandler = () => { existing.dataset.loaded = "true"; init(); };
          existing.addEventListener("load", loadHandler, { once: true });
        }
      } else {
        const script = document.createElement("script");
        scriptEl = script;
        script.id    = "ngl-script";
        script.src   = "https://cdn.jsdelivr.net/npm/ngl/dist/ngl.js";
        script.async = true;
        loadHandler = () => { script.dataset.loaded = "true"; init(); };
        script.addEventListener("load", loadHandler, { once: true });
        document.head.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      if (scriptEl && loadHandler) scriptEl.removeEventListener("load", loadHandler);
      try { playerRef.current?.pause?.(); } catch { /* ignore */ }
      ro?.disconnect();
      if (stageRef.current) { stageRef.current.dispose(); stageRef.current = null; }
      componentRef.current    = null;
      playerRef.current       = null;
      trajectoryRef.current   = null;
      initialOrientRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, topologyPath, trajectoryPath]);

  const handlePlay = () => {
    if (!playerRef.current) return;
    playerRef.current.play();
    setPlaying(true);
  };

  const handlePause = () => {
    if (!playerRef.current) return;
    playerRef.current.pause();
    setPlaying(false);
  };

  const handleSeek = (nextFrame: number) => {
    if (!trajectoryRef.current) return;
    const n = totalFrames ?? 0;
    if (n <= 0) return;
    const clamped = Math.max(0, Math.min(n - 1, nextFrame));
    try {
      playerRef.current?.pause?.();
      setPlaying(false);
      trajectoryRef.current.setFrame(clamped);
      setFrame(clamped);
    } catch { /* ignore */ }
  };

  const handleResetView = () => {
    if (!stageRef.current) return;
    if (initialOrientRef.current) {
      stageRef.current.animationControls.orient(initialOrientRef.current, 800);
    } else {
      componentRef.current?.autoView(800);
    }
  };

  const handleScreenshot = () => {
    if (!stageRef.current) return;
    stageRef.current
      .makeImage({ factor: 6, antialias: true, trim: false, transparent: true })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((blob: any) => {
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        const base = topologyPath.split("/").pop()?.replace(/\.[^.]+$/, "") || "trajectory";
        a.href     = url;
        a.download = `${base}_trajectory_view.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
  };

  const handleGifExport = async () => {
    if (!stageRef.current || !trajectoryRef.current || !totalFrames || totalFrames <= 0) return;
    setGifGenerating(true);

    // Pause player
    playerRef.current?.pause?.();
    setPlaying(false);

    try {
      // Load gif.js from CDN if not already loaded
      await new Promise<void>((resolve, reject) => {
        if (window.GIF) { resolve(); return; }
        const existing = document.getElementById("gif-script");
        if (existing) {
          if (window.GIF) { resolve(); return; }
          existing.addEventListener("load", () => resolve(), { once: true });
          existing.addEventListener("error", reject, { once: true });
          return;
        }
        const s = document.createElement("script");
        s.id  = "gif-script";
        s.src = "https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.js";
        s.onload  = () => resolve();
        s.onerror = reject;
        document.head.appendChild(s);
      });

      const GIF = window.GIF;
      const container = containerRef.current!;
      const gif = new GIF({
        workers: 2,
        quality: 10,
        workerScript: "https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js",
        width:  container.clientWidth,
        height: container.clientHeight,
      });

      const n = totalFrames;
      // Cap at 60 frames to keep GIF size reasonable
      const maxFrames = Math.min(n, 60);
      const step = Math.max(1, Math.floor(n / maxFrames));

      for (let i = 0; i < n; i += step) {
        trajectoryRef.current.setFrame(i);
        // Allow NGL to render the new frame before capturing
        await new Promise((r) => setTimeout(r, 80));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const blob: Blob = await stageRef.current!.makeImage({ factor: 1, antialias: false, trim: false, transparent: false }) as any;
        const imgUrl = URL.createObjectURL(blob);
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            gif.addFrame(img, { delay: 80, copy: true });
            URL.revokeObjectURL(imgUrl);
            resolve();
          };
          img.src = imgUrl;
        });
      }

      await new Promise<void>((resolve) => {
        gif.on("finished", (blob: Blob) => {
          const url  = URL.createObjectURL(blob);
          const a    = document.createElement("a");
          const base = topologyPath.split("/").pop()?.replace(/\.[^.]+$/, "") || "trajectory";
          a.href     = url;
          a.download = `${base}_trajectory.gif`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          resolve();
        });
        gif.render();
      });
    } catch {
      /* silently ignore GIF export errors */
    } finally {
      setGifGenerating(false);
    }
  };

  return (
    <div className="space-y-2">
      {/* Viewer canvas */}
      <div
        className="relative rounded-xl border border-gray-700/60 bg-gray-900 overflow-hidden"
        style={{ height: "360px" }}
      >
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-red-400 gap-2 z-10">
            <AlertCircle size={18} />
            <span className="text-xs px-4 text-center break-all">{error}</span>
          </div>
        ) : loadingStage ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 gap-2 z-10">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-xs">{LOADING_LABELS[loadingStage]}</span>
          </div>
        ) : null}
        <div ref={containerRef} className="w-full h-full" />

        {/* Upper-left overlay: atom/residue counts + frame info */}
        {(structInfo || totalFrames !== null) && (
          <div className="absolute top-2 left-2 flex flex-col gap-1 pointer-events-none">
            {structInfo && (
              <div className="flex gap-1.5">
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-gray-900/75 text-gray-300">
                  {structInfo.atoms.toLocaleString()} atoms
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-gray-900/75 text-gray-300">
                  {structInfo.residues} residues
                </span>
              </div>
            )}
            {totalFrames !== null && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-gray-900/75 text-gray-400 w-fit">
                frame {frame} / {Math.max(totalFrames - 1, 0)}
              </span>
            )}
          </div>
        )}

        {ready && (
          <div className="absolute bottom-0 left-0 right-0 px-3 py-1 bg-gray-900/80 text-[10px] text-gray-500">
            drag to rotate · scroll to zoom · right-click to translate
          </div>
        )}
      </div>

      {/* Controls row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          {[
            { key: "ball",    label: "Ball"    },
            { key: "stick",   label: "Stick"   },
            { key: "ribbon",  label: "Cartoon" },
            { key: "surface", label: "Surface" },
          ].map(({ key, label }) => {
            const on = reps[key as keyof typeof reps];
            return (
              <button
                key={key}
                onClick={() => setReps((r) => ({ ...r, [key]: !r[key as keyof typeof r] }))}
                disabled={!ready}
                className={`px-2 py-1 rounded text-[10px] border transition-colors disabled:opacity-40 ${
                  on
                    ? "bg-indigo-600 border-indigo-500 text-white"
                    : "bg-gray-800/60 border-gray-700/50 text-gray-400 hover:text-gray-200"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handlePlay}
            disabled={!ready || playing}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border border-emerald-700/60 bg-emerald-900/30 text-emerald-300 hover:bg-emerald-800/40 disabled:opacity-40"
          >
            <Play size={11} />
            Play
          </button>
          <button
            onClick={handlePause}
            disabled={!ready || !playing}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border border-amber-700/60 bg-amber-900/30 text-amber-300 hover:bg-amber-800/40 disabled:opacity-40"
          >
            <Pause size={11} />
            Pause
          </button>
          <button
            onClick={handleResetView}
            disabled={!ready}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border border-gray-700/60 bg-gray-800/60 text-gray-300 hover:bg-gray-700/60 disabled:opacity-40"
          >
            <Crosshair size={11} />
            Reset
          </button>
          <button
            onClick={handleScreenshot}
            disabled={!ready}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border border-gray-700/60 bg-gray-800/60 text-gray-300 hover:bg-gray-700/60 disabled:opacity-40"
          >
            <Camera size={11} />
            Screenshot
          </button>
          <button
            onClick={handleGifExport}
            disabled={!ready || gifGenerating || !totalFrames}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border border-purple-700/60 bg-purple-900/30 text-purple-300 hover:bg-purple-800/40 disabled:opacity-40"
          >
            {gifGenerating
              ? <Loader2 size={11} className="animate-spin" />
              : <Film size={11} />
            }
            {gifGenerating ? "Exporting…" : "GIF"}
          </button>
        </div>
      </div>

      {/* Scrubber */}
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={Math.max((totalFrames ?? 1) - 1, 0)}
          step={1}
          value={Math.min(frame, Math.max((totalFrames ?? 1) - 1, 0))}
          onChange={(e) => handleSeek(Number(e.currentTarget.value))}
          disabled={!ready || !totalFrames || totalFrames <= 1}
          className="w-full accent-indigo-500 disabled:opacity-40"
        />
      </div>
    </div>
  );
}
