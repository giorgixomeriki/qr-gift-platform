import type { ReactNode } from "react";
import { Spark } from "@/components/ui/logo";
import { getThemeConfig, themeVars } from "@/lib/themes/registry";

/**
 * A theme as a physical object: the card leaning in front of its open
 * envelope (liner showing), on the theme's own backdrop — so a theme is felt
 * before its name is read. Used by the theme picker, the entry hero and the
 * checkout summary.
 *
 * Pure CSS, measured in container-query units (cqw) and centred as one
 * group, so the same composition works from an 80px thumbnail to a hero of
 * any aspect ratio; `scale` shrinks the group for wide, short containers.
 */
export function ThemeSwatch({
  themeKey,
  line,
  scale = 1,
  className = "",
  children,
}: {
  themeKey: string;
  /** Optional words set on the card (e.g. the theme's opening line). Without it, the card shows a quiet text texture. */
  line?: ReactNode;
  scale?: number;
  className?: string;
  children?: ReactNode;
}) {
  const theme = getThemeConfig(themeKey);
  return (
    <div
      className={`gift relative isolate overflow-hidden [container-type:inline-size] ${className}`}
      style={themeVars(theme)}
      data-stage="static"
      aria-hidden
    >
      <div
        className="absolute top-1/2 left-1/2 h-[74cqw] w-[82cqw]"
        style={{ transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        {/* Open envelope, flap up, liner visible. */}
        <div className="absolute top-[30cqw] left-[30cqw] w-[50cqw]" style={{ transform: "rotate(6deg)" }}>
          <div
            className="absolute bottom-full left-0 h-[22cqw] w-full"
            style={{ background: "var(--g-liner)", clipPath: "polygon(0 100%, 50% 0, 100% 100%)" }}
          />
          <div
            className="relative h-[36cqw] w-full rounded-[0.6cqw]"
            style={{ background: "var(--g-envelope)", boxShadow: "0 0 0 1px var(--g-edge), 0 2.5cqw 6cqw -2.5cqw rgb(0 0 0 / 0.35)" }}
          >
            <svg viewBox="0 0 100 72" preserveAspectRatio="none" className="absolute inset-0 size-full">
              <path d="M0 0 L50 38 L100 0" fill="none" stroke="rgb(0 0 0 / 0.07)" strokeWidth="0.8" />
            </svg>
          </div>
        </div>

        {/* The card, leaning in front. */}
        <div
          className="paper-card absolute top-[4cqw] left-[2cqw] flex h-[50.4cqw] w-[36cqw] flex-col items-center px-[4cqw] pt-[7.5cqw] after:inset-[2cqw]"
          style={{ transform: "rotate(-4deg)" }}
        >
          <Spark className="size-[5cqw] text-[var(--g-seal)]" />
          {line ? (
            <p className="mt-[3.5cqw] line-clamp-4 text-center font-serif text-[4cqw] leading-[1.15] text-[var(--g-paper-ink)]">{line}</p>
          ) : (
            <div className="mt-[4.5cqw] flex w-full flex-col items-center gap-[2cqw]">
              {[86, 68, 78, 44].map((w, i) => (
                <span key={i} className="block h-[1cqw] rounded-full bg-[var(--g-paper-ink-soft)] opacity-35" style={{ width: `${w}%` }} />
              ))}
            </div>
          )}
        </div>
      </div>

      {theme.particle !== "none" && (
        <div className="absolute inset-0">
          {[
            ["7%", "9%", 0.9, 0],
            ["88%", "10%", 0.7, 1],
            ["90%", "84%", 0.8, 2],
          ].map(([left, top, s, c], i) => (
            <Spark
              key={i}
              className="absolute size-[3.2cqw] animate-twinkle"
              style={{
                left: String(left),
                top: String(top),
                scale: Number(s),
                color: theme.palette.particleColors[Number(c)] ?? theme.palette.accent,
                animationDelay: `${i * 0.6}s`,
              }}
            />
          ))}
        </div>
      )}
      {children}
    </div>
  );
}
