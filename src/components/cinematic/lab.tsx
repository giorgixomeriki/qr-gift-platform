"use client";

/**
 * Lab only (NEXT_PUBLIC_LAB=1): the cinematic opening prototypes on the production
 * recipient renderer, with synthetic content — no database, no real media, no
 * third-party requests. /lab/cinematic compares A/B/C in phone frames;
 * /lab/cinematic/stage is one full-screen run (also what each frame loads).
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { GreetingRenderer, type GreetingRenderContent } from "@/components/greeting/greeting-renderer";
import type { CinematicMetrics, QualityPref, Variant } from "./cinematic-interlude";
import { prefetchCinematic } from "./prefetch";
import "./lab.css";

const Interlude = lazy(() => import("./cinematic-interlude"));

const THEMES = ["romantic", "luxury-vintage", "wedding", "elegant", "birthday", "celebration", "minimal"] as const;
const PHOTOS = ["/lab/cinematic/photo-1.jpg", "/lab/cinematic/photo-2.jpg", "/lab/cinematic/photo-3.jpg"];
const MSG = "ჩემო ძვირფასო ნინო,\n\nდღეს მინდა გითხრა ის, რასაც ყოველდღე ვფიქრობ, მაგრამ იშვიათად ვამბობ ხმამაღლა.\n\nშენი გიორგი";
const PHRASES = ["მიყვარხარ", "სამუდამოდ", "ჩემი სამყარო", "შენთვის"];
const LABELS = { skip: "გამოტოვება", openLetter: "წერილის გახსნა" };

const pick = <T extends string>(v: string | undefined, all: readonly T[], d: T): T => (all.includes(v as T) ? (v as T) : d);

export function CinematicStage({ params }: { params: Record<string, string | undefined> }) {
  const variant = pick(params.v, ["A", "B", "C", "C2", "C3"] as const, "A");
  const theme = pick(params.theme, THEMES, "romantic");
  const n = Math.max(0, Math.min(3, Number(params.photos ?? 3) || 0));
  const quality = pick(params.q, ["auto", "high", "mid", "lite"] as const, "auto") as QualityPref;
  const reduced = params.reduced === "1";
  const autoplay = params.autoplay === "1";

  const content = useMemo<GreetingRenderContent>(
    () => ({ message: MSG, photos: PHOTOS.slice(0, n).map((url, i) => ({ id: `p${i}`, url })), video: null, audio: null }),
    [n],
  );
  const galleryPhotos = useMemo(() => content.photos.map((p, i) => ({ url: p.url, alt: `ფოტო ${i + 1}` })), [content.photos]);

  // Warm the WebGL layer while the envelope is sealed (never before first paint).
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 400));
    const h = idle(() => prefetchCinematic(variant));
    return () => (window.cancelIdleCallback ?? window.clearTimeout)(h as number);
  }, [variant]);

  useEffect(() => {
    if (!autoplay) return;
    const t = window.setTimeout(() => (document.querySelector(".sx-env__seal") as HTMLButtonElement | null)?.click(), 1100);
    return () => window.clearTimeout(t);
  }, [autoplay]);

  const onMetrics = useCallback((m: CinematicMetrics) => {
    if (window.parent !== window) window.parent.postMessage({ type: "cinematic-metrics", m }, window.location.origin);
  }, []);

  return (
    <GreetingRenderer
      themeKey={theme}
      content={content}
      mode="recipient"
      openingInterlude={({ reveal, done }) => (
        <Suspense fallback={null}>
          <Interlude
            variant={variant}
            themeKey={theme}
            photos={galleryPhotos}
            phrases={PHRASES}
            centerLabel="ნინო"
            quality={quality}
            forceReduced={reduced}
            labels={LABELS}
            reveal={reveal}
            done={done}
            onMetrics={onMetrics}
          />
        </Suspense>
      )}
    />
  );
}

const DEVICES = {
  iphone: { label: "iPhone 15 · 393×852", w: 393, h: 852 },
  pixel: { label: "Pixel 7 · 412×915", w: 412, h: 915 },
  small: { label: "Small · 360×740", w: 360, h: 740 },
} as const;
type Device = keyof typeof DEVICES;

const VARIANTS: { id: Variant; name: string; line: string }[] = [
  { id: "A", name: "Luxury Floral Reveal", line: "Golden light, then rose petals burst toward you and part over the letter." },
  { id: "B", name: "Golden Stardust Reveal", line: "A helix of gold dust rises from the envelope and bursts past you into the letter." },
  { id: "C", name: "Floral + Memory Galaxy", line: "The petals clear into a dark galaxy of the sender's photos; the letter follows." },
  { id: "C2", name: "Photorealistic Floral Galaxy", line: "Real photographed petals, cinematic light and depth, printed photographs in the night." },
  { id: "C3", name: "Luxury Film Reveal", line: "Fewer petals, macro foreground, deep focus falloff, a slow camera, understated." },
];
const SETS: Record<string, Variant[]> = { abc: ["A", "B", "C"], c: ["C", "C2", "C3"] };

function Phone({ src, device, runKey, scale }: { src: string; device: Device; runKey: number; scale: number }) {
  const d = DEVICES[device];
  return (
    <div className="cl-phone" style={{ width: d.w * scale, height: d.h * scale } as CSSProperties}>
      <iframe key={runKey} title="Cinematic preview" src={src} width={d.w} height={d.h} style={{ transform: `scale(${scale})` }} />
    </div>
  );
}

export function CinematicCompare() {
  const [variant, setVariant] = useState<Variant>("C2");
  const [all, setAll] = useState<false | "abc" | "c">(false);
  const [theme, setTheme] = useState<(typeof THEMES)[number]>("romantic");
  const [photos, setPhotos] = useState(3);
  const [quality, setQuality] = useState<QualityPref>("auto");
  const [reduced, setReduced] = useState(false);
  const [autoplay, setAutoplay] = useState(true);
  const [device, setDevice] = useState<Device>("iphone");
  const [runKey, setRunKey] = useState(0);
  const [metrics, setMetrics] = useState<CinematicMetrics[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.7);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== "cinematic-metrics") return;
      setMetrics((m) => [e.data.m as CinematicMetrics, ...m].slice(0, 12));
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const d = DEVICES[device];
      const cols = all ? 3 : 1;
      const availW = (el.clientWidth - (cols - 1) * 20) / cols;
      const availH = window.innerHeight - el.getBoundingClientRect().top - 24;
      setScale(Math.max(0.3, Math.min(1, availW / d.w, availH / d.h)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [device, all]);

  const src = (v: Variant) => {
    const p = new URLSearchParams({ v, theme, photos: String(photos), q: quality });
    if (reduced) p.set("reduced", "1");
    if (autoplay) p.set("autoplay", "1");
    return `/lab/cinematic/stage?${p}`;
  };
  const replay = () => setRunKey((k) => k + 1);

  return (
    <main className="cl">
      <header className="cl-head">
        <div>
          <p className="cl-kicker">QR STARR · Motion Lab</p>
          <h1 className="cl-title">Cinematic envelope opening</h1>
        </div>
        <button type="button" className="cl-replay" onClick={replay} data-testid="lab-replay">
          ↻ Replay
        </button>
      </header>

      <section className="cl-variants" role="tablist" aria-label="Prototype">
        {VARIANTS.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={!all && variant === v.id}
            className="cl-variant"
            onClick={() => {
              setAll(false);
              setVariant(v.id);
              replay();
            }}
            data-testid={`lab-variant-${v.id}`}
          >
            <span className="cl-variant__id">{v.id}</span>
            <span className="cl-variant__name">{v.name}</span>
            <span className="cl-variant__line">{v.line}</span>
          </button>
        ))}
        <button role="tab" aria-selected={all === "c"} className="cl-variant cl-variant--all" onClick={() => (setAll("c"), replay())} data-testid="lab-variant-c-all">
          <span className="cl-variant__id">C·C2·C3</span>
          <span className="cl-variant__name">Photoreal comparison</span>
          <span className="cl-variant__line">Original C beside C2 and C3, started together.</span>
        </button>
        <button role="tab" aria-selected={all === "abc"} className="cl-variant cl-variant--all" onClick={() => (setAll("abc"), replay())} data-testid="lab-variant-all">
          <span className="cl-variant__id">A·B·C</span>
          <span className="cl-variant__name">Side by side</span>
          <span className="cl-variant__line">The first three, started together.</span>
        </button>
      </section>

      <section className="cl-controls">
        <label>
          Theme
          <select value={theme} onChange={(e) => (setTheme(e.target.value as (typeof THEMES)[number]), replay())}>
            {THEMES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Photos
          <select value={photos} onChange={(e) => (setPhotos(Number(e.target.value)), replay())}>
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          Quality
          <select value={quality} onChange={(e) => (setQuality(e.target.value as QualityPref), replay())}>
            <option value="auto">auto (device)</option>
            <option value="high">high</option>
            <option value="mid">mid</option>
            <option value="lite">lite (no WebGL)</option>
          </select>
        </label>
        <label>
          Viewport
          <select value={device} onChange={(e) => setDevice(e.target.value as Device)}>
            {Object.entries(DEVICES).map(([k, d]) => (
              <option key={k} value={k}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label className="cl-check">
          <input type="checkbox" checked={reduced} onChange={(e) => (setReduced(e.target.checked), replay())} /> Reduced motion
        </label>
        <label className="cl-check">
          <input type="checkbox" checked={autoplay} onChange={(e) => (setAutoplay(e.target.checked), replay())} /> Auto-open
        </label>
        <a className="cl-full" href={src(variant)} target="_blank" rel="noreferrer">
          Open full screen ↗
        </a>
      </section>

      <div ref={stageRef} className="cl-stage" data-all={all || undefined}>
        {(all ? SETS[all]! : [variant]).map((v) => (
          <figure key={v} className="cl-fig">
            <Phone src={src(v)} device={device} runKey={runKey} scale={scale} />
            {all && <figcaption>{v}</figcaption>}
          </figure>
        ))}
        <aside className="cl-metrics" aria-live="polite">
          <h2>Last runs</h2>
          {metrics.length === 0 && <p className="cl-muted">Open the envelope to measure.</p>}
          {metrics.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Var</th>
                  <th>Tier</th>
                  <th>ms</th>
                  <th>fps</th>
                  <th>p95</th>
                  <th>1st GL</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m, i) => (
                  <tr key={i}>
                    <td>{m.variant}</td>
                    <td>
                      {m.quality}
                      {m.degraded ? "↓" : ""}
                    </td>
                    <td>{m.skipped ? "skip" : m.durationMs}</td>
                    <td>{m.fps || "–"}</td>
                    <td>{m.p95FrameMs || "–"}</td>
                    <td>{m.firstFrameMs ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="cl-muted">Synthetic letter and photos. Nothing leaves this device.</p>
          <p className="cl-muted">
            C2/C3 petals: “Red Rose Petals” by THOR (CC BY 2.0, adapted) and three petal photos by cogdogblog (CC0), via Wikimedia Commons.
          </p>
        </aside>
      </div>
    </main>
  );
}
