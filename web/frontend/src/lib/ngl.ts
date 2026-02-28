/** Suppress Three.js useLegacyLights deprecation warning from NGL Viewer. */
let _patched = false;
export function suppressNglDeprecationWarnings(): void {
  if (_patched) return;
  _patched = true;
  const orig = console.warn;
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes("useLegacyLights")) return;
    orig.apply(console, args);
  };
}
