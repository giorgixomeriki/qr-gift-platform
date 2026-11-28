/**
 * WebGL layer of the cinematic opening (three.js, MIT).
 *
 * - Petals: one instanced draw call. Every petal's flight is computed on the
 *   GPU from per-instance random attributes and a single time uniform, so the
 *   CPU does no per-petal work per frame. Flight model (depth layers, sway,
 *   spin, 3D flip) after Opus Motion Library's falling-petals (MIT).
 * - Stream: gold stardust rising out of the envelope (points, GPU-animated).
 * - Field: the ambient star/dust field, adapted from three.js'
 *   examples/webgl_points_sprites.html (MIT): several THREE.Points layers
 *   sharing one geometry, each with its own sprite, size and colour, slowly
 *   counter-rotating, colour breathing in HSL. Sprites are procedural gold
 *   (textures.ts) instead of the example's snowflake PNGs.
 *
 * Everything is created on demand and released in dispose() (geometries,
 * materials, textures, the GL context itself).
 */
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NoColorSpace,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  WebGLRenderer,
  type Texture,
} from "three";
import { petalAtlas, rng, sparkSprite, type PetalPalette } from "./textures";

export type Quality = "high" | "mid";

export type EngineOptions = {
  canvas: HTMLCanvasElement;
  quality: Quality;
  /** Envelope mouth in CSS px (where petals and dust come from). */
  origin: { x: number; y: number };
  palette: PetalPalette;
  /** Relative weights of the four petal colours (theme). */
  weights: [number, number, number, number];
  petals: boolean;
  stream: boolean;
  field: boolean;
  /** Seconds (on the interlude clock). */
  petalWindow: { start: number; spread: number; push: number; end: number };
  streamWindow: { start: number; spread: number; burst: number; end: number };
};

const FOV = 40;
const CAM_Z = 10;

const PETAL_VERT = /* glsl */ `
attribute vec4 aR;
attribute vec4 aR2;
attribute float aTile;
attribute float aMode;
uniform float uTime, uStart, uSpread, uPush, uEnd, uAspect, uSize;
uniform vec3 uOrigin;
varying vec2 vUv;
varying vec3 vN;
varying float vAlpha;
varying float vDepth;

mat3 rotAxis(vec3 a, float g) {
  float s = sin(g), c = cos(g), oc = 1.0 - c;
  return mat3(oc*a.x*a.x + c,     oc*a.x*a.y + a.z*s, oc*a.z*a.x - a.y*s,
              oc*a.x*a.y - a.z*s, oc*a.y*a.y + c,     oc*a.y*a.z + a.x*s,
              oc*a.z*a.x + a.y*s, oc*a.y*a.z - a.x*s, oc*a.z*a.z + c);
}

void main() {
  float drift = aMode;
  float spawn = uStart + aR.x * uSpread + drift * (0.25 + aR2.y * 0.55);
  float t = uTime - spawn;
  float alive = step(0.0, t);
  t = max(t, 0.0);

  // A flat plane cupped into a petal and curled back at the tip.
  vec3 p = position;
  float cupK = 0.03 + aR2.w * 0.08;
  float curlK = 0.04 + aR2.z * 0.14;
  float cy = (p.y + 0.625) / 1.25;
  p.z += cupK * 4.0 * p.x * p.x - curlK * cy * cy;
  vec3 n = normalize(vec3(-cupK * 8.0 * p.x, curlK * 2.0 * cy / 1.25, 1.0));

  // Tumble: a steady spin about a random axis plus a slower flutter (the 3D flip).
  vec3 axis = normalize(aR2.xyz * 2.0 - 1.0 + vec3(0.0, 0.0, 0.0001));
  float spin = (aR.y * 2.0 - 1.0) * (drift > 0.5 ? 2.2 : 4.5);
  float ang = aR.w * 6.2831 + spin * t + sin(t * (1.6 + aR.z * 2.4) + aR.x * 6.2831) * 0.9;
  mat3 R = rotAxis(axis, ang);
  float size = mix(0.3, 0.68, aR.z) * uSize * smoothstep(0.0, 0.28, t);
  vec3 local = R * (p * size);
  vN = normalMatrix * (R * n);

  vec3 pos;
  if (drift < 0.5) {
    // Burst: out of the mouth, then accelerating toward (and past) the viewer.
    float a = aR.w * 6.2831;
    float rad = mix(0.12, 1.0, sqrt(aR.y));
    vec3 dir = vec3(cos(a) * rad * 1.25, sin(a) * rad + 0.22, 1.0);
    float rise = (1.0 - exp(-t * 5.0)) * mix(0.35, 1.2, aR.x);
    float f = max(t - 0.1, 0.0);
    float fly = f * f * mix(2.0, 4.4, aR2.x) * uPush + f * 0.9;
    pos = uOrigin + vec3(0.0, rise, 0.0) + dir * fly;
    pos.x += sin(t * 2.1 + aR.z * 6.2831) * 0.2 * t;
  } else {
    // Drifters: spread across the frame at their own depth, then fall slowly, swaying.
    float z = mix(0.5, 5.2, aR2.x);
    float halfH = 0.36397 * (${CAM_Z.toFixed(1)} - z);
    float halfW = halfH * uAspect;
    vec3 target = vec3((aR.y * 2.0 - 1.0) * halfW * 1.05, mix(-0.1, 1.05, aR.z) * halfH, z);
    float sp = 1.0 - exp(-t * 2.4);
    pos = mix(uOrigin, target, sp);
    pos.y -= max(t - 0.5, 0.0) * mix(0.35, 0.9, aR.x) * (halfH / 3.0);
    pos.x += sin(t * 1.5 + aR.w * 6.2831) * 0.22 * (halfH / 3.0);
  }

  vec4 mv = modelViewMatrix * vec4(pos + local, 1.0);
  vDepth = -mv.z;
  // Fade as a petal brushes past the lens, and as the scene ends.
  float nearFade = smoothstep(0.3, 0.85, -mv.z);
  float endFade = 1.0 - smoothstep(uEnd - 0.7, uEnd, uTime);
  vAlpha = alive * nearFade * endFade;

  float col = mod(aTile, 2.0);
  float row = floor(aTile / 2.0);
  vUv = vec2(uv.x * 0.5 + col * 0.5, uv.y * 0.5 + (1.0 - row) * 0.5);
  gl_Position = projectionMatrix * mv;
}
`;

const PETAL_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uGlow;
varying vec2 vUv;
varying vec3 vN;
varying float vAlpha;
varying float vDepth;
void main() {
  vec4 tex = texture2D(uMap, vUv);
  float a = tex.a * vAlpha;
  if (a < 0.04) discard;
  vec3 N = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 L = normalize(vec3(0.35, 0.8, 0.5));
  float diff = max(dot(N, L), 0.0);
  float through = max(dot(-N, L), 0.0);
  // Key light, soft fill, and light shining through the thin petal (warm).
  // Warm (never grey) shadow side: petals are lit by the envelope's golden light.
  vec3 shade = mix(vec3(0.62, 0.5, 0.46), vec3(1.0), diff);
  vec3 c = tex.rgb * (0.64 + 0.46 * diff) * shade + tex.rgb * vec3(1.0, 0.72, 0.6) * through * 0.4;
  // Golden light from the envelope, strongest early and on far petals.
  c += vec3(0.95, 0.72, 0.38) * uGlow * 0.18 * smoothstep(4.0, 10.0, vDepth);
  // Back faces slightly darker (they face away from the key light).
  c *= gl_FrontFacing ? 1.0 : 0.82;
  gl_FragColor = vec4(c, a);
}
`;

const STREAM_VERT = /* glsl */ `
attribute vec4 aR;
uniform float uTime, uStart, uSpread, uBurst, uEnd, uScale;
uniform vec3 uOrigin;
varying float vAlpha;
varying float vSpark;
void main() {
  float spawn = uStart + aR.x * uSpread;
  float t = uTime - spawn;
  float alive = step(0.0, t);
  t = max(t, 0.0);
  float ang = aR.y * 6.2831 + t * (2.2 + aR.z * 2.6);
  float r = 0.05 + t * mix(0.2, 0.85, aR.w);
  float up = t * mix(0.9, 2.4, aR.z);
  vec3 p = uOrigin + vec3(cos(ang) * r, up, sin(ang) * r * 0.6);
  float b = max(uTime - uBurst, 0.0);
  float ba = aR.y * 6.2831;
  vec3 bd = vec3(cos(ba) * aR.w * 1.3, sin(ba) * aR.w + 0.15, 1.0);
  p += bd * b * b * mix(2.6, 6.5, aR.x);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float tw = 0.65 + 0.35 * sin(uTime * (7.0 + aR.z * 9.0) + aR.w * 30.0);
  float endFade = 1.0 - smoothstep(uEnd - 0.6, uEnd, uTime);
  vAlpha = alive * tw * endFade * smoothstep(0.2, 1.2, -mv.z) * smoothstep(0.0, 0.15, t);
  vSpark = step(0.86, aR.z);
  gl_PointSize = mix(0.05, 0.13, aR.w) * (1.0 + vSpark * 1.6) * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const STREAM_FRAG = /* glsl */ `
varying float vAlpha;
varying float vSpark;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c);
  float core = exp(-d * 38.0);
  float star = vSpark * (max(0.0, 1.0 - abs(c.x) * 16.0) * max(0.0, 1.0 - abs(c.y) * 2.1)
                      + max(0.0, 1.0 - abs(c.y) * 16.0) * max(0.0, 1.0 - abs(c.x) * 2.1));
  float a = (core + star * 0.55) * vAlpha;
  vec3 col = mix(vec3(0.85, 0.62, 0.3), vec3(1.0, 0.95, 0.85), core);
  gl_FragColor = vec4(col * a, a);
}
`;

export type Engine = {
  render: (t: number, glow: number, fieldOpacity: number) => void;
  resize: () => void;
  /** Halve the work (fewer instances, lower resolution) if frames run long. */
  degrade: () => void;
  dispose: () => void;
  info: () => { drawCalls: number; triangles: number; points: number; pixelRatio: number; petals: number; dust: number };
};

export function createEngine(o: EngineOptions): Engine {
  const high = o.quality === "high";
  const renderer = new WebGLRenderer({ canvas: o.canvas, alpha: true, antialias: false, powerPreference: "high-performance", premultipliedAlpha: true });
  let pixelRatio = Math.min(window.devicePixelRatio || 1, high ? 2 : 1.25);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 60);
  camera.position.z = CAM_Z;
  const disposables: { dispose: () => void }[] = [];
  const own = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);

  const rand = rng(2026);
  const toWorld = (px: number, py: number) => {
    const w = o.canvas.clientWidth || window.innerWidth;
    const h = o.canvas.clientHeight || window.innerHeight;
    const halfH = Math.tan(((FOV / 2) * Math.PI) / 180) * CAM_Z;
    return [((px / w) * 2 - 1) * halfH * (w / h), (1 - (py / h) * 2) * halfH, 0] as const;
  };

  // ---------------- petals ----------------
  let petalGeo: InstancedBufferGeometry | null = null;
  let petalMat: ShaderMaterial | null = null;
  let petalTotal = 0;
  if (o.petals) {
    const burst = high ? 300 : 170;
    const drift = high ? 70 : 40;
    petalTotal = burst + drift;
    const base = new PlaneGeometry(1, 1.25, 4, 6);
    petalGeo = own(new InstancedBufferGeometry());
    petalGeo.index = base.index;
    petalGeo.setAttribute("position", base.getAttribute("position"));
    petalGeo.setAttribute("uv", base.getAttribute("uv"));
    own(base);
    const aR = new Float32Array(petalTotal * 4);
    const aR2 = new Float32Array(petalTotal * 4);
    const tile = new Float32Array(petalTotal);
    const mode = new Float32Array(petalTotal);
    const wsum = o.weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < petalTotal; i++) {
      for (let k = 0; k < 4; k++) {
        aR[i * 4 + k] = rand();
        aR2[i * 4 + k] = rand();
      }
      let pick = rand() * wsum;
      let ti = 0;
      while (ti < 3 && (pick -= o.weights[ti]!) > 0) ti++;
      tile[i] = ti;
      // Interleave modes so that a degrade (lower instanceCount) keeps both.
      mode[i] = i % Math.round(petalTotal / drift) === 0 ? 1 : 0;
    }
    petalGeo.setAttribute("aR", new InstancedBufferAttribute(aR, 4));
    petalGeo.setAttribute("aR2", new InstancedBufferAttribute(aR2, 4));
    petalGeo.setAttribute("aTile", new InstancedBufferAttribute(tile, 1));
    petalGeo.setAttribute("aMode", new InstancedBufferAttribute(mode, 1));
    petalGeo.instanceCount = petalTotal;
    const map = own(new CanvasTexture(petalAtlas(o.palette, high ? 1024 : 512)));
    map.colorSpace = NoColorSpace;
    map.anisotropy = 2;
    petalMat = own(
      new ShaderMaterial({
        vertexShader: PETAL_VERT,
        fragmentShader: PETAL_FRAG,
        side: DoubleSide,
        transparent: true,
        depthWrite: true,
        uniforms: {
          uTime: { value: 0 },
          uStart: { value: o.petalWindow.start },
          uSpread: { value: o.petalWindow.spread },
          uPush: { value: o.petalWindow.push },
          uEnd: { value: o.petalWindow.end },
          uAspect: { value: 1 },
          uSize: { value: 1 },
          uOrigin: { value: [0, 0, 0] },
          uMap: { value: map },
          uGlow: { value: 0 },
        },
      }),
    );
    const mesh = new Mesh(petalGeo, petalMat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    scene.add(mesh);
  }

  // ---------------- gold stream ----------------
  let streamGeo: BufferGeometry | null = null;
  let streamMat: ShaderMaterial | null = null;
  let streamTotal = 0;
  if (o.stream) {
    streamTotal = high ? 1600 : 800;
    streamGeo = own(new BufferGeometry());
    const pos = new Float32Array(streamTotal * 3);
    const aR = new Float32Array(streamTotal * 4);
    for (let i = 0; i < aR.length; i++) aR[i] = rand();
    streamGeo.setAttribute("position", new Float32BufferAttribute(pos, 3));
    streamGeo.setAttribute("aR", new Float32BufferAttribute(aR, 4));
    streamMat = own(
      new ShaderMaterial({
        vertexShader: STREAM_VERT,
        fragmentShader: STREAM_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uStart: { value: o.streamWindow.start },
          uSpread: { value: o.streamWindow.spread },
          uBurst: { value: o.streamWindow.burst },
          uEnd: { value: o.streamWindow.end },
          uScale: { value: 400 },
          uOrigin: { value: [0, 0, 0] },
        },
      }),
    );
    const pts = new Points(streamGeo, streamMat);
    pts.frustumCulled = false;
    pts.renderOrder = 3;
    scene.add(pts);
  }

  // ---------------- ambient field (after three.js webgl_points_sprites) ----------------
  const field: { pts: Points; mat: PointsMaterial; hsl: [number, number, number]; base: number }[] = [];
  let fieldTotal = 0;
  if (o.field) {
    scene.fog = new FogExp2(0x000000, 0.045);
    fieldTotal = high ? 1500 : 600;
    const g = own(new BufferGeometry());
    const v = new Float32Array(fieldTotal * 3);
    for (let i = 0; i < fieldTotal; i++) {
      v[i * 3] = (rand() * 2 - 1) * 22;
      v[i * 3 + 1] = (rand() * 2 - 1) * 22;
      v[i * 3 + 2] = (rand() * 2 - 1) * 22 - 6;
    }
    g.setAttribute("position", new Float32BufferAttribute(v, 3));
    const dot = own(new CanvasTexture(sparkSprite("dot")));
    const star = own(new CanvasTexture(sparkSprite("star")));
    // [hsl colour, sprite, size] — the example's parameter table, retuned to champagne gold.
    const params: [[number, number, number], Texture, number][] = [
      [[0.11, 0.55, 0.7], star, 0.34],
      [[0.09, 0.6, 0.6], dot, 0.22],
      [[0.12, 0.45, 0.75], dot, 0.16],
      [[0.08, 0.5, 0.55], dot, 0.12],
      [[0.1, 0.4, 0.8], star, 0.2],
    ];
    params.forEach(([hsl, map, size], i) => {
      const mat = own(new PointsMaterial({ size, map, blending: AdditiveBlending, depthTest: false, depthWrite: false, transparent: true, opacity: 0, fog: true }));
      mat.color.setHSL(hsl[0], hsl[1], hsl[2], SRGBColorSpace);
      const pts = new Points(g, mat);
      pts.rotation.set(rand() * 6, rand() * 6, rand() * 6);
      pts.renderOrder = 1;
      scene.add(pts);
      field.push({ pts, mat, hsl, base: i });
    });
  }

  function resize() {
    const w = o.canvas.clientWidth || window.innerWidth;
    const h = o.canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const origin = toWorld(o.origin.x, o.origin.y);
    if (petalMat) {
      petalMat.uniforms.uAspect!.value = w / h;
      petalMat.uniforms.uOrigin!.value = origin;
      // Petals keep a similar on-screen size on phones and desktops.
      petalMat.uniforms.uSize!.value = Math.min(1.25, Math.max(0.8, 1.15 * Math.sqrt(Math.min(w / h, 1.4))));
    }
    if (streamMat) {
      streamMat.uniforms.uOrigin!.value = origin;
      streamMat.uniforms.uScale!.value = (h * renderer.getPixelRatio()) / (2 * Math.tan(((FOV / 2) * Math.PI) / 180));
    }
  }
  resize();

  return {
    render(t, glow, fieldOpacity) {
      if (petalMat) {
        petalMat.uniforms.uTime!.value = t;
        petalMat.uniforms.uGlow!.value = glow;
      }
      if (streamMat) streamMat.uniforms.uTime!.value = t;
      // The example's motion: each layer rotates at its own rate, colour breathing within the gold band.
      const ft = t * 0.04;
      for (const f of field) {
        f.mat.opacity = fieldOpacity;
        f.pts.rotation.y = ft * (f.base < 4 ? f.base + 1 : -(f.base + 1));
        f.mat.color.setHSL(f.hsl[0] + 0.015 * Math.sin(t * 0.7 + f.base), f.hsl[1], f.hsl[2], SRGBColorSpace);
        f.pts.visible = fieldOpacity > 0.001;
      }
      renderer.render(scene, camera);
    },
    resize,
    degrade() {
      pixelRatio = 1;
      renderer.setPixelRatio(1);
      if (petalGeo) petalGeo.instanceCount = Math.round(petalTotal * 0.55);
      if (streamGeo) streamGeo.setDrawRange(0, Math.round(streamTotal * 0.5));
      for (const f of field) f.pts.geometry.setDrawRange(0, Math.round(fieldTotal * 0.5));
      resize();
    },
    dispose() {
      for (const d of disposables) d.dispose();
      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss();
    },
    info() {
      const i = renderer.info;
      return {
        drawCalls: i.render.calls,
        triangles: i.render.triangles,
        points: i.render.points,
        pixelRatio,
        petals: petalGeo?.instanceCount ?? 0,
        dust: streamTotal + fieldTotal,
      };
    },
  };
}
