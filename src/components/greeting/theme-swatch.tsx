import type { ReactNode } from "react";
import { Spark } from "@/components/ui/logo";
import { getThemeConfig, themeVars } from "@/lib/themes/registry";
import { Envelope } from "./envelope";

/**
 * A miniature of the recipient experience in a given palette: the same
 * envelope, the same colours. Used wherever a theme needs to be *felt*
 * rather than described — welcome hero, theme picker, checkout summary.
 */
export function ThemeSwatch({
  themeKey,
  label,
  className = "",
  envelopeWidth = "58%",
  children,
}: {
  themeKey: string;
  label?: ReactNode;
  className?: string;
  envelopeWidth?: string;
  children?: ReactNode;
}) {
  const theme = getThemeConfig(themeKey);
  const p = theme.palette;
  return (
    <div className={`gift relative isolate grid place-items-center overflow-hidden ${className}`} style={themeVars(theme)} data-stage="static">
      {theme.particle !== "none" && (
        <div aria-hidden className="absolute inset-0">
          {[
            ["12%", "16%", 0.9, 0],
            ["80%", "12%", 0.6, 1],
            ["86%", "70%", 0.75, 2],
            ["14%", "78%", 0.5, 0],
          ].map(([left, top, scale, c], i) => (
            <Spark
              key={i}
              className="absolute size-3 animate-twinkle"
              style={{ left: String(left), top: String(top), scale: Number(scale), color: p.particleColors[Number(c)] ?? p.accent, animationDelay: `${i * 0.6}s` }}
            />
          ))}
        </div>
      )}
      <div className="flex w-full flex-col items-center gap-3">
        <div style={{ width: envelopeWidth }}>
          <Envelope size="mini" />
        </div>
        {label && <div className="px-3 text-center font-serif leading-tight text-[var(--g-ink)]">{label}</div>}
      </div>
      {children}
    </div>
  );
}
