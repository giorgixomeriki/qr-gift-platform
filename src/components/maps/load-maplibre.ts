/**
 * Loads MapLibre GL on demand (never in the home page's first load) and
 * points it at the same-origin worker copied into public/ — the bundled
 * build cannot locate its worker from import.meta.url, and a same-origin
 * worker keeps the CSP to `worker-src 'self' blob:` (lib/security/csp.ts).
 * scripts/verify-partner-locations.ts checks the copy matches node_modules.
 */
export const MAPLIBRE_VERSION = "6.16.0";
export const MAPLIBRE_WORKER_URL = `/vendor/maplibre-gl-${MAPLIBRE_VERSION}/maplibre-gl-worker.mjs`;

let loading: Promise<typeof import("maplibre-gl")> | null = null;

export function loadMapLibre(): Promise<typeof import("maplibre-gl")> {
  loading ??= import("maplibre-gl").then((mod) => {
    mod.setWorkerUrl(MAPLIBRE_WORKER_URL);
    return mod;
  });
  return loading;
}

/** WebGL is required; without it the list (always rendered) is the experience. */
export function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export const MAP_ATTRIBUTION = [
  { label: "OpenFreeMap", href: "https://openfreemap.org" },
  { label: "© OpenMapTiles", href: "https://www.openmaptiles.org/" },
  { label: "© OpenStreetMap", href: "https://www.openstreetmap.org/copyright" },
];
