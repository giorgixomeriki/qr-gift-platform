/**
 * Photoreal petals for the "film" look (C2, C3).
 *
 * Same instanced, GPU-only approach as the classic petals (engine.ts) — one draw call,
 * no per-petal CPU work — with:
 *  - real petal photographs (atlas built from Wikimedia Commons photos, see LICENSES.md:
 *    "Red Rose Petals" by THOR, CC BY 2.0; three single-petal photos by cogdogblog, CC0),
 *    8 silhouettes × 4 grades (burgundy, deep red, blush, ivory), mipmapped;
 *  - aerodynamics: launch velocity damped by air drag, a breeze from the envelope toward
 *    the viewer, light gravity, layered turbulence, asymmetric tumble + pendulum flutter,
 *    the petal flexing while it turns; every petal has its own mass/drag/frequencies;
 *  - emergence: petals are born across the envelope mouth, slightly inside it, and are
 *    hidden below the paper edge until they have risen out;
 *  - shading: warm key with wrapped diffuse, transmitted backlight through the thin petal,
 *    velvet rim sheen, paler matte underside, the envelope's interior light (inverse-square
 *    from the mouth), atmospheric perspective, ACES filmic tone mapping;
 *  - depth of field: per-petal mip bias from distance to the focus plane (blur without a
 *    post-processing pass);
 *  - optional macro petals: a few very close, heavily defocused petals at the frame edges.
 */
import { DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry, LinearMipmapLinearFilter, Mesh, NoColorSpace, PlaneGeometry, ShaderMaterial, Texture, type Scene } from "three";

export type FilmOptions = {
  image: HTMLImageElement | ImageBitmap;
  burst: number;
  drift: number;
  macro: number;
  start: number;
  spread: number;
  end: number;
  /** Macro petals fade out at this time (they may stay through the galaxy). */
  macroEnd: number;
  /** World-space focus distance from the camera, and how strongly out-of-focus petals blur (mip levels). */
  focus: number;
  dof: number;
  /** Breeze strength toward the viewer. */
  breeze: number;
  weights: [number, number, number, number];
};

const VERT = /* glsl */ `
attribute vec4 aR;
attribute vec4 aR2;
attribute vec4 aR3;
attribute float aTile;
attribute float aMode;
uniform float uTime, uStart, uSpread, uEnd, uMacroEnd, uAspect, uSize, uBreeze, uMouthW, uCamZ, uCamX;
uniform vec3 uOrigin;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
varying vec3 vWorld;
varying float vAlpha;
varying float vDepth;
varying float vHidden;
varying float vMacro;

mat3 rotAxis(vec3 a, float g) {
  float s = sin(g), c = cos(g), oc = 1.0 - c;
  return mat3(oc*a.x*a.x + c,     oc*a.x*a.y + a.z*s, oc*a.z*a.x - a.y*s,
              oc*a.x*a.y - a.z*s, oc*a.y*a.y + c,     oc*a.y*a.z + a.x*s,
              oc*a.z*a.x + a.y*s, oc*a.y*a.z - a.x*s, oc*a.z*a.z + c);
}
// Layered, non-repeating turbulence (incommensurate frequencies, per-petal phases).
vec3 turb(float t, vec4 r) {
  return vec3(
    sin(t * 1.31 + r.x * 6.28) + 0.5 * sin(t * 2.87 + r.y * 6.28) + 0.25 * sin(t * 5.03 + r.z * 6.28),
    sin(t * 1.07 + r.y * 6.28) + 0.5 * sin(t * 3.11 + r.w * 6.28),
    sin(t * 0.83 + r.z * 6.28) + 0.5 * sin(t * 2.29 + r.x * 6.28));
}

void main() {
  float macro = step(1.5, aMode);
  float drift = step(0.5, aMode) * (1.0 - macro);
  float spawn = uStart + aR.x * uSpread + drift * (0.15 + aR2.y * 0.5) + macro * (0.55 + aR3.x * 0.9);
  float t = uTime - spawn;
  float alive = step(0.0, t);
  t = max(t, 0.0);

  // Shape: a photo plane cupped, curled at the rim, twisted, and flexing as it tumbles.
  vec3 p = position;
  float cupK = 0.08 + aR2.w * 0.16;
  float curlK = 0.04 + aR2.z * 0.12;
  float cy = p.y + 0.5;
  float flex = sin(t * (3.0 + aR3.y * 3.0) + aR3.z * 6.28) * 0.06;
  p.z += cupK * 4.0 * p.x * p.x - curlK * cy * cy + (aR3.w - 0.5) * 0.18 * p.x * p.y + flex * p.x * cy;
  vec3 n = normalize(vec3(-cupK * 8.0 * p.x - (aR3.w - 0.5) * 0.18 * p.y, curlK * 2.0 * cy - (aR3.w - 0.5) * 0.18 * p.x, 1.0));

  // Tumble: a damped spin about an asymmetric axis + a pendulum flutter about the petal's own long axis.
  vec3 axis = normalize(vec3(aR2.x * 2.0 - 1.0, aR2.y * 0.6 + 0.2, aR2.z * 2.0 - 1.0));
  float drag = mix(1.2, 2.8, aR3.y);
  float w0 = (aR.y * 2.0 - 1.0) * mix(5.0, 9.0, aR3.x);
  float spinAng = aR.w * 6.2831 + w0 * (1.0 - exp(-drag * t)) / drag + (aR.y - 0.5) * 1.4 * t;
  float flutter = sin(t * mix(2.2, 4.6, aR3.z) + aR.z * 6.2831) * mix(0.5, 1.1, aR2.w);
  mat3 R = rotAxis(axis, spinAng) * rotAxis(vec3(0.0, 1.0, 0.0), flutter);
  float size = mix(0.46, 0.86, aR.z) * uSize * (macro > 0.5 ? mix(0.5, 0.7, aR3.w) : 1.0) * smoothstep(0.0, 0.3, t);
  vec3 local = R * (p * size);
  vN = normalMatrix * (R * n);

  vec3 pos;
  float halfK = 0.36397; // tan(20°)
  if (macro > 0.5) {
    // Macro: close to the lens (kept at a fixed distance from the moving camera), half out of
    // frame at an edge, drifting slowly — a foreground, never a curtain over the scene.
    float dist = mix(2.3, 3.1, aR3.y);
    float z = uCamZ - dist;
    float hH = halfK * dist;
    float side = aR.y < 0.5 ? -1.0 : 1.0;
    vec3 a = vec3(uCamX + side * hH * uAspect * mix(0.92, 1.12, aR2.x), mix(-0.85, 0.85, aR.z) * hH, z);
    pos = a + vec3(-side * 0.05 * t, -0.04 * t, 0.0) + turb(t * 0.3, aR2) * 0.03;
  } else {
    // Launch out of the mouth (spread across its width, from just inside), damped by drag,
    // carried by a breeze toward the viewer that builds then settles, light gravity, turbulence.
    vec3 o = uOrigin + vec3((aR3.x - 0.5) * uMouthW, 0.0, (aR2.y - 0.5) * 0.5 - 0.1);
    float a = aR.w * 6.2831;
    float rad = mix(0.15, 1.0, sqrt(aR.y));
    vec3 v0 = vec3(cos(a) * rad * 1.6, 2.2 + sin(a) * rad * 0.9 + aR.x * 0.8, 0.4);
    vec3 launch = v0 * (1.0 - exp(-drag * t)) / drag;
    vec3 flowDir = normalize(vec3(cos(a) * rad * 0.9, sin(a) * rad * 0.7 + 0.12, 1.0));
    float bt = max(t - 0.12, 0.0);
    float breeze = uBreeze * mix(0.7, 1.3, aR2.x) * (drift > 0.5 ? 0.45 : 1.0);
    vec3 flow = flowDir * breeze * bt * bt / (1.0 + 0.55 * bt) * 3.2;
    float g = mix(0.25, 0.6, aR3.w) * t * t * 0.5 / (1.0 + 0.8 * t);
    pos = o + launch + flow - vec3(0.0, g, 0.0) + turb(t, aR2) * 0.12 * min(t, 1.5);
    if (drift > 0.5) {
      // Drifters spread out across the frame at mid depth and float down through the reveal.
      float z = mix(1.0, 5.0, aR2.x);
      float hH = halfK * (10.0 - z);
      vec3 target = vec3((aR.y * 2.0 - 1.0) * hH * uAspect, mix(-0.2, 1.0, aR.z) * hH, z);
      float sp = 1.0 - exp(-t * 1.9);
      pos = mix(o + launch, target, sp) - vec3(0.0, max(t - 0.6, 0.0) * mix(0.25, 0.55, aR.x) * hH / 3.0, 0.0) + turb(t * 0.7, aR2) * 0.16;
    }
  }

  vec4 world = modelMatrix * vec4(pos + local, 1.0);
  vWorld = world.xyz;
  vec4 mv = viewMatrix * world;
  vDepth = -mv.z;
  vView = normalize(-mv.xyz);
  vMacro = macro;
  vHidden = 0.0;
  float nearFade = macro > 0.5 ? 1.0 : smoothstep(0.35, 1.0, -mv.z);
  float end = macro > 0.5 ? uMacroEnd : uEnd;
  float endFade = 1.0 - smoothstep(end - 0.8, end, uTime);
  vAlpha = alive * nearFade * endFade * (macro > 0.5 ? smoothstep(0.0, 1.2, t) * 0.88 : 1.0);

  float col = mod(aTile, 8.0);
  float row = floor(aTile / 8.0);
  vUv = vec2((uv.x + col) / 8.0, (uv.y + (3.0 - row)) / 4.0);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uGlow, uFocus, uDof;
uniform vec3 uOrigin;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
varying vec3 vWorld;
varying float vAlpha;
varying float vDepth;
varying float vHidden;
varying float vMacro;

vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

void main() {
  if (vHidden > 0.5) discard;
  // Depth of field: sample a blurrier mip the further the petal is from the focus plane.
  float coc = clamp(abs(vDepth - uFocus) / 3.5, 0.0, 1.0);
  // Capped at 2.2 mip levels: deeper mips average a petal's alpha across its whole atlas tile.
  float bias = min(uDof * coc * coc * 3.0 + vMacro * 2.0, 2.2);
  vec4 tex = texture2D(uMap, vUv, bias);
  // Defocused alpha is re-sharpened into a soft edge (no square halo from the tile).
  float edge = mix(0.5, 0.32, max(vMacro, coc));
  float a = smoothstep(edge - 0.18, edge + 0.18, tex.a) * vAlpha;
  if (a < 0.02) discard;

  vec3 alb = pow(tex.rgb, vec3(2.2));
  alb *= mix(1.0, 0.82, smoothstep(0.35, 0.8, dot(alb, vec3(0.33)))); // pale petals: keep the paper-white out
  bool front = gl_FrontFacing;
  vec3 N = normalize(vN) * (front ? 1.0 : -1.0);
  vec3 V = normalize(vView);
  vec3 L = normalize(vec3(-0.35, 0.75, 0.55));
  vec3 keyC = vec3(1.0, 0.84, 0.66) * 1.55;
  vec3 fillC = vec3(0.42, 0.28, 0.26) * 0.45;
  // Underside of a rose petal: paler and matte.
  if (!front) alb = mix(alb, vec3(dot(alb, vec3(0.3, 0.55, 0.15))) * vec3(1.15, 1.0, 0.95), 0.28);
  float wrap = max((dot(N, L) + 0.35) / 1.35, 0.0);
  vec3 c = alb * (keyC * wrap + fillC);
  // Light through the thin petal when it is between the light and the viewer.
  float through = pow(max(dot(-N, L), 0.0), 1.5) * max(dot(V, -L) * 0.5 + 0.5, 0.0);
  c += pow(alb, vec3(0.75)) * vec3(1.0, 0.55, 0.38) * through * 1.6;
  // Velvet sheen at grazing angles (rose petals scatter light at the rim).
  float rim = pow(1.0 - abs(dot(N, V)), 3.0);
  c += (alb * 0.6 + 0.04) * keyC * rim * 0.55;
  // The envelope's warm interior light, strongest early and close to the mouth.
  float d = length(vWorld - uOrigin);
  c += alb * vec3(1.0, 0.7, 0.35) * uGlow * 3.0 / (1.0 + d * d * 1.4);
  // Atmospheric perspective: distant petals sink into the warm dark.
  float haze = smoothstep(11.0, 18.0, vDepth);
  c = mix(c, vec3(0.05, 0.02, 0.02), haze);
  c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, 0.82); // film stock: restrained saturation
  c = aces(c * 0.85);
  c = pow(c, vec3(1.0 / 2.2));
  gl_FragColor = vec4(c, a);
}
`;

export function createFilmPetals(scene: Scene, rand: () => number, o: FilmOptions) {
  const total = o.burst + o.drift + o.macro;
  const base = new PlaneGeometry(1, 1, 6, 8);
  const geo = new InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setAttribute("uv", base.getAttribute("uv"));
  const aR = new Float32Array(total * 4);
  const aR2 = new Float32Array(total * 4);
  const aR3 = new Float32Array(total * 4);
  const tile = new Float32Array(total);
  const mode = new Float32Array(total);
  const wsum = o.weights.reduce((a, b) => a + b, 0);
  // Macro petals first (always kept when degrading), then burst and drifters interleaved.
  const every = o.drift ? Math.max(2, Math.round((o.burst + o.drift) / o.drift)) : 0;
  for (let i = 0; i < total; i++) {
    for (let k = 0; k < 4; k++) {
      aR[i * 4 + k] = rand();
      aR2[i * 4 + k] = rand();
      aR3[i * 4 + k] = rand();
    }
    let pick = rand() * wsum;
    let grade = 0;
    while (grade < 3 && (pick -= o.weights[grade]!) > 0) grade++;
    mode[i] = i < o.macro ? 2 : every && (i - o.macro) % every === 0 ? 1 : 0;
    // Macro foreground petals: the darker grades only (burgundy, deep red) — understated.
    if (mode[i] === 2) grade = rand() < 0.6 ? 0 : 1;
    tile[i] = grade * 8 + Math.floor(rand() * 8);
  }
  geo.setAttribute("aR", new InstancedBufferAttribute(aR, 4));
  geo.setAttribute("aR2", new InstancedBufferAttribute(aR2, 4));
  geo.setAttribute("aR3", new InstancedBufferAttribute(aR3, 4));
  geo.setAttribute("aTile", new InstancedBufferAttribute(tile, 1));
  geo.setAttribute("aMode", new InstancedBufferAttribute(mode, 1));
  geo.instanceCount = total;
  const map = new Texture(o.image);
  map.colorSpace = NoColorSpace;
  map.minFilter = LinearMipmapLinearFilter;
  map.anisotropy = 4;
  map.needsUpdate = true;
  const mat = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: DoubleSide,
    transparent: true,
    // No depth writes: dense, interpenetrating petals would otherwise cut each other into slivers.
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uStart: { value: o.start },
      uSpread: { value: o.spread },
      uEnd: { value: o.end },
      uMacroEnd: { value: o.macroEnd },
      uAspect: { value: 1 },
      uSize: { value: 1 },
      uBreeze: { value: o.breeze },
      uMouthW: { value: 1 },
      uCamZ: { value: 10 },
      uCamX: { value: 0 },
      uOrigin: { value: [0, 0, 0] },
      uMap: { value: map },
      uGlow: { value: 0 },
      uFocus: { value: o.focus },
      uDof: { value: o.dof },
    },
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  scene.add(mesh);
  return {
    mat,
    geo,
    total,
    dispose() {
      base.dispose();
      geo.dispose();
      mat.dispose();
      map.dispose();
    },
  };
}
