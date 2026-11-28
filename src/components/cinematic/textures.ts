/**
 * Procedural textures for the cinematic opening — drawn on a canvas at run
 * time, so no image is fetched and no third-party artwork is shipped.
 *
 * The petal outline and the "three depth layers / flip / sway" model follow
 * Opus Motion Library's falling-petals motion (MIT, see LICENSES.md); the
 * flat SVG fill there is replaced by a shaded rose-petal material (pale
 * base, saturated body, darker rim, veins, grain) so the petal reads as a
 * real petal under the shader's light rather than as a cartoon shape.
 */

export type PetalPalette = [string, string, string, string];

/** Four luxury petal colours: burgundy, crimson, blush champagne, ivory. */
export const PETALS_DEFAULT: PetalPalette = ["#5e0a1c", "#8e1a30", "#e2bba6", "#f3e8d8"];

function hex(c: string) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
}
function mix(a: string, b: string, t: number) {
  const A = hex(a);
  const B = hex(b);
  return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`;
}

/** Seeded PRNG so the atlas is identical on every run (stable screenshots). */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rose-petal outline in a tile of size s (tip lobes at the top, narrow base at the bottom). */
function petalPath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, notch: number) {
  ctx.beginPath();
  // A broad, softly waved crown (not a heart): rose petals are widest near the top.
  ctx.moveTo(x + 0.5 * s, y + 0.985 * s);
  ctx.bezierCurveTo(x + 0.26 * s, y + 0.9 * s, x + 0.02 * s, y + 0.58 * s, x + 0.04 * s, y + 0.32 * s);
  ctx.bezierCurveTo(x + 0.06 * s, y + 0.1 * s, x + 0.26 * s, y + 0.03 * s, x + 0.44 * s, y + (0.04 + notch) * s);
  ctx.bezierCurveTo(x + 0.52 * s, y + (0.045 + notch * 0.6) * s, x + 0.6 * s, y + 0.02 * s, x + 0.7 * s, y + 0.035 * s);
  ctx.bezierCurveTo(x + 0.88 * s, y + 0.07 * s, x + 0.98 * s, y + 0.2 * s, x + 0.96 * s, y + 0.36 * s);
  ctx.bezierCurveTo(x + 0.95 * s, y + 0.6 * s, x + 0.74 * s, y + 0.9 * s, x + 0.5 * s, y + 0.985 * s);
  ctx.closePath();
}

function drawPetal(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, rand: () => number) {
  const [r, g, b] = hex(color);
  const light = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55;
  ctx.save();
  petalPath(ctx, x, y, s, rand() * 0.025);
  ctx.clip();
  // Body: pale, slightly yellow base → saturated body → deeper toward the lobes.
  const body = ctx.createLinearGradient(0, y + s, 0, y);
  body.addColorStop(0, mix(color, "#f6e7b8", light ? 0.35 : 0.55));
  body.addColorStop(0.22, mix(color, "#f6e7b8", light ? 0.12 : 0.18));
  body.addColorStop(0.55, color);
  body.addColorStop(1, mix(color, light ? "#c9a58e" : "#2a0309", light ? 0.25 : 0.32));
  ctx.fillStyle = body;
  ctx.fillRect(x, y, s, s);
  // Rim darkening (petals are thinner and fold at the edge).
  const rim = ctx.createRadialGradient(x + 0.5 * s, y + 0.5 * s, s * 0.18, x + 0.5 * s, y + 0.5 * s, s * 0.56);
  rim.addColorStop(0, "rgba(0,0,0,0)");
  rim.addColorStop(1, light ? "rgba(110,70,50,0.22)" : "rgba(20,0,4,0.38)");
  ctx.fillStyle = rim;
  ctx.fillRect(x, y, s, s);
  // Velvet sheen across the body.
  const sheen = ctx.createRadialGradient(x + 0.38 * s, y + 0.4 * s, 0, x + 0.38 * s, y + 0.4 * s, s * 0.42);
  sheen.addColorStop(0, light ? "rgba(255,255,255,0.32)" : "rgba(255,190,200,0.16)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(x, y, s, s);
  // Veins fanning from the base.
  ctx.lineCap = "round";
  for (let i = 0; i < 15; i++) {
    const a = -Math.PI / 2 + (i / 14 - 0.5) * 1.9 + (rand() - 0.5) * 0.08;
    const len = s * (0.65 + rand() * 0.25);
    ctx.beginPath();
    ctx.moveTo(x + 0.5 * s, y + 0.97 * s);
    ctx.quadraticCurveTo(
      x + 0.5 * s + Math.cos(a) * len * 0.45 + (rand() - 0.5) * s * 0.04,
      y + 0.97 * s + Math.sin(a) * len * 0.5,
      x + 0.5 * s + Math.cos(a) * len,
      y + 0.97 * s + Math.sin(a) * len,
    );
    ctx.strokeStyle = light ? `rgba(150,110,90,${0.06 + rand() * 0.05})` : `rgba(255,210,215,${0.04 + rand() * 0.04})`;
    ctx.lineWidth = s * (0.004 + rand() * 0.004);
    ctx.stroke();
  }
  // Grain.
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = rand() < 0.5 ? `rgba(255,255,255,${rand() * 0.05})` : `rgba(0,0,0,${rand() * 0.07})`;
    ctx.fillRect(x + rand() * s, y + rand() * s, 1.2, 1.2);
  }
  ctx.restore();
  // A fine lighter rim (light catching the edge).
  ctx.save();
  petalPath(ctx, x, y, s, 0.012);
  ctx.strokeStyle = light ? "rgba(255,250,240,0.55)" : "rgba(255,170,180,0.22)";
  ctx.lineWidth = s * 0.008;
  ctx.stroke();
  ctx.restore();
}

/** 2×2 atlas of four petals (one per palette colour). */
export function petalAtlas(palette: PetalPalette = PETALS_DEFAULT, size = 512): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const rand = rng(7);
  const s = size / 2;
  palette.forEach((col, i) => drawPetal(ctx, (i % 2) * s + 2, Math.floor(i / 2) * s + 2, s - 4, col, rand));
  return c;
}

/** One petal as a data URL — the lightweight (no WebGL) fallback paints these with CSS. */
export function petalDataUrls(palette: PetalPalette = PETALS_DEFAULT, size = 96): string[] {
  const rand = rng(11);
  return palette.map((col) => {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    drawPetal(c.getContext("2d")!, 1, 1, size - 2, col, rand);
    return c.toDataURL("image/png");
  });
}

/** Gold sprites for the stardust field (replaces the snowflake PNGs of three.js' points_sprites example). */
export function sparkSprite(kind: "dot" | "star", size = 64): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const h = size / 2;
  const g = ctx.createRadialGradient(h, h, 0, h, h, h);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(kind === "dot" ? 0.25 : 0.12, "rgba(255,240,205,0.85)");
  g.addColorStop(kind === "dot" ? 0.6 : 0.3, "rgba(230,190,120,0.18)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  if (kind === "star") {
    ctx.globalCompositeOperation = "lighter";
    const bars: [number, number][] = [
      [size, size * 0.06],
      [size * 0.06, size],
    ];
    for (const [w, hgt] of bars) {
      const lg = ctx.createRadialGradient(h, h, 0, h, h, h);
      lg.addColorStop(0, "rgba(255,245,220,0.9)");
      lg.addColorStop(1, "rgba(255,245,220,0)");
      ctx.fillStyle = lg;
      ctx.fillRect(h - w / 2, h - hgt / 2, w, hgt);
    }
  }
  return c;
}
