/**
 * Frontend file watcher for AMD dev mode.
 * Watches src/ and triggers `next build` on changes so FastAPI always
 * serves an up-to-date static export on the same port.
 *
 * Uses chokidar (already a Next.js dependency).
 */

import chokidar from "chokidar";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

let buildTimer = null;
let building = false;
let pendingAfterBuild = false;

function scheduleBuild() {
  if (buildTimer) clearTimeout(buildTimer);
  buildTimer = setTimeout(runBuild, 400);
}

function runBuild() {
  if (building) {
    pendingAfterBuild = true;
    return;
  }
  building = true;
  pendingAfterBuild = false;
  const start = Date.now();
  process.stdout.write("[watch] Rebuilding frontend…\n");

  exec("npm run build", { cwd: __dirname }, (err, _stdout, stderr) => {
    building = false;
    if (err) {
      process.stderr.write(`[watch] Build FAILED:\n${stderr || err.message}\n`);
    } else {
      process.stdout.write(`[watch] Build done in ${((Date.now() - start) / 1000).toFixed(1)}s\n`);
    }
    if (pendingAfterBuild) runBuild();
  });
}

const watcher = chokidar.watch(
  ["src", "public", "next.config.mjs", "tailwind.config.ts", "postcss.config.mjs"],
  {
    cwd: __dirname,
    ignoreInitial: true,
    ignored: /(^|[/\\])\../,
    usePolling: true,
    interval: 1000,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 200 },
  }
);

watcher.on("all", (event, path) => {
  process.stdout.write(`[watch] ${event}: ${path}\n`);
  scheduleBuild();
});

process.stdout.write("[watch] Watching src/ for changes (Ctrl+C to stop)…\n");
