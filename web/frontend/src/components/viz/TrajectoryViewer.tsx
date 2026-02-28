"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Camera, Loader2, Pause, Play } from "lucide-react";
import { downloadUrl } from "@/lib/api";
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
  }
}

export default function TrajectoryViewer({ sessionId, topologyPath, trajectoryPath }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stageRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const componentRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trajectoryRef = useRef<any>(null);
  const [reps, setReps] = useState({
    ball: true,
    stick: true,
    ribbon: false,
    surface: false,
  });
  const repsRef = useRef(reps);
  useEffect(() => { repsRef.current = reps; }, [reps]);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState<number | null>(null);

  // Apply representations; use currentReps when called from async (e.g. init) so toggles aren't lost.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyRepresentations = (component: any, currentReps?: typeof reps) => {
    const r = currentReps ?? repsRef.current;
    component.removeAllRepresentations();
    if (r.ball) {
      component.addRepresentation("spacefill", {
        colorScheme: "element",
        radiusScale: 0.2,
      });
    }
    if (r.stick) {
      component.addRepresentation("licorice", {
        colorScheme: "element",
      });
    }
    if (r.ribbon) {
      component.addRepresentation("cartoon", { sele: "protein", colorScheme: "residueindex" });
    }
    if (r.surface) {
      component.addRepresentation("surface", { color: "white", opacity: 0.1 });
    }
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
    trajectoryRef.current = null;

    const init = () => {
      if (!containerRef.current || !window.NGL || cancelled) return;
      suppressNglDeprecationWarnings();
      const stage = new window.NGL.Stage(containerRef.current, { backgroundColor: "#111827" });
      stageRef.current = stage;
      ro = new ResizeObserver(() => stage.handleResize());
      ro.observe(containerRef.current);

      const topologyExt = topologyPath.split(".").pop()?.toLowerCase() || "gro";
      const topologyUrl = downloadUrl(sessionId, topologyPath);
      const trajUrl = downloadUrl(sessionId, trajectoryPath);

      stage
        .loadFile(topologyUrl, {
          ext: topologyExt,
          defaultRepresentation: false,
          name: topologyPath.split("/").pop() || "topology",
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then((comp: any) => {
          componentRef.current = comp;
          comp.autoView(300);

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const trajComp = comp.addTrajectory(trajUrl, {
            centerPbc: true,
            removePbc: true,
          } as any);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const traj = trajComp?.trajectory as any;
          trajectoryRef.current = traj;
          if (traj?.signals?.frameChanged) {
            traj.signals.frameChanged.add((i: number) => setFrame(i));
          }

          // Apply representations and create the player only after trajectory
          // frames are available — mirrors the nglview pattern where
          // representations are set up after the trajectory is fully loaded.
          // Creating the player before gotNumframes can leave it unable to play.
          const initPlayer = (n: number) => {
            if (cancelled) return;
            setTotalFrames(Number(n));
            applyRepresentations(comp, repsRef.current);
            playerRef.current = new window.NGL.TrajectoryPlayer(traj, { step: 1, timeout: 80, mode: "loop" });
            setReady(true);
          };

          if (traj?.numframes) {
            initPlayer(traj.numframes);
          } else if (traj?.signals?.gotNumframes) {
            traj.signals.gotNumframes.add(initPlayer);
          } else {
            // Fallback: no signals available, set up immediately
            applyRepresentations(comp, repsRef.current);
            playerRef.current = new window.NGL.TrajectoryPlayer(traj, { step: 1, timeout: 80, mode: "loop" });
            setReady(true);
          }
        })
        .catch((e: unknown) => setError(String(e)));
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
        script.id = "ngl-script";
        script.src = "https://cdn.jsdelivr.net/npm/ngl/dist/ngl.js";
        script.async = true;
        loadHandler = () => { script.dataset.loaded = "true"; init(); };
        script.addEventListener("load", loadHandler, { once: true });
        document.head.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      if (scriptEl && loadHandler) {
        scriptEl.removeEventListener("load", loadHandler);
      }
      try {
        playerRef.current?.pause?.();
      } catch {
        /* ignore */
      }
      ro?.disconnect();
      if (stageRef.current) {
        stageRef.current.dispose();
        stageRef.current = null;
      }
      componentRef.current = null;
      playerRef.current = null;
      trajectoryRef.current = null;
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
    } catch {
      // ignore scrub errors on partially loaded trajectories
    }
  };

  const handleScreenshot = () => {
    if (!stageRef.current) return;
    stageRef.current
      .makeImage({ factor: 4, antialias: true, trim: false, transparent: true })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((blob: any) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const base = topologyPath.split("/").pop()?.replace(/\.[^.]+$/, "") || "trajectory";
        a.href = url;
        a.download = `${base}_trajectory_view.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
  };

  return (
    <div className="space-y-2">
      <div
        className="relative rounded-xl border border-gray-700/60 bg-gray-900 overflow-hidden"
        style={{ height: "360px" }}
      >
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-red-400 gap-2">
            <AlertCircle size={18} />
            <span className="text-xs px-4 text-center break-all">{error}</span>
          </div>
        ) : !ready ? (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 gap-2">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-xs">Loading trajectory…</span>
          </div>
        ) : null}
        <div ref={containerRef} className="w-full h-full" />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          {[
            { key: "ball", label: "Ball" },
            { key: "stick", label: "Stick" },
            { key: "ribbon", label: "Cartoon" },
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
          <span className="text-[11px] text-gray-500 font-mono ml-1">
            frame {frame}{totalFrames !== null ? ` / ${Math.max(totalFrames - 1, 0)}` : ""}
          </span>
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
            onClick={handleScreenshot}
            disabled={!ready}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border border-gray-700/60 bg-gray-800/60 text-gray-300 hover:bg-gray-700/60 disabled:opacity-40"
          >
            <Camera size={11} />
            Screenshot
          </button>
        </div>
      </div>
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
