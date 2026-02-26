"use client";

import { useEffect, useRef } from "react";
import { X, Loader2 } from "lucide-react";
import { useState } from "react";

interface Props {
  fileContent: string;
  fileName: string;
  onClose: () => void;
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $3Dmol: any;
  }
}

export default function MoleculeViewer({ fileContent, fileName, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "pdb";

    const initViewer = () => {
      if (!containerRef.current || !window.$3Dmol) return;
      containerRef.current.innerHTML = "";
      const viewer = window.$3Dmol.createViewer(containerRef.current, {
        backgroundColor: "0x111827",
      });
      viewer.addModel(fileContent, ext);
      viewer.setStyle(
        {},
        {
          cartoon: { color: "spectrum" },
          stick: { radius: 0.15 },
        }
      );
      viewer.zoomTo();
      viewer.render();
      setReady(true);
    };

    if (window.$3Dmol) {
      initViewer();
      return;
    }

    // Load 3Dmol.js dynamically — library is loaded once and cached
    const existing = document.getElementById("3dmol-script");
    if (existing) {
      existing.addEventListener("load", initViewer);
      return;
    }
    const script = document.createElement("script");
    script.id = "3dmol-script";
    // Uses 3Dmol.js from jsDelivr CDN (npm package mirror — no account needed)
    script.src = "https://cdn.jsdelivr.net/npm/3dmol/build/3Dmol-min.js";
    script.async = true;
    script.onload = initViewer;
    document.head.appendChild(script);
  }, [fileContent, fileName]);

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl overflow-hidden flex flex-col shadow-2xl border border-gray-700"
           style={{ width: "75vw", height: "75vh" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700 flex-shrink-0">
          <div>
            <span className="text-sm font-mono text-gray-200">{fileName}</span>
            <span className="ml-2 text-xs text-gray-500">3D Viewer</span>
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
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-400">
              <Loader2 size={24} className="animate-spin mr-2" />
              <span className="text-sm">Loading viewer…</span>
            </div>
          )}
          <div ref={containerRef} className="w-full h-full" />
        </div>

        <div className="px-4 py-2 bg-gray-800/50 border-t border-gray-700 text-xs text-gray-500 flex-shrink-0">
          Drag to rotate · Scroll to zoom · Right-click to translate
        </div>
      </div>
    </div>
  );
}
