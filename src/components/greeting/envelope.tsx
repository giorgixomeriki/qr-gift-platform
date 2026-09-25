import { Spark } from "@/components/ui/logo";

/**
 * The sealed envelope — the recipient's first impression. Pure markup; all
 * colour comes from --g-* theme variables and all motion from the stage
 * attribute on the surrounding .gift element (see globals.css).
 */
export function Envelope({ name, size = "full" }: { name?: string; size?: "full" | "mini" }) {
  return (
    <div className="envelope" style={size === "mini" ? { width: "100%", filter: "drop-shadow(0 8px 14px rgb(0 0 0 / 0.18))" } : undefined}>
      <div className="envelope-back" />
      <div className="envelope-letter">
        <Spark className="size-[14%] text-[var(--g-seal)] opacity-80" />
      </div>
      <svg className="envelope-front" viewBox="0 0 320 220" preserveAspectRatio="none" aria-hidden>
        <path d="M0 14 L160 128 L320 14 V206 a14 14 0 0 1 -14 14 H14 a14 14 0 0 1 -14 -14 Z" fill="var(--g-envelope)" />
        <path d="M0 212 L132 112 M320 212 L188 112" stroke="rgb(0 0 0 / 0.06)" strokeWidth="1.5" fill="none" />
      </svg>
      <div className="envelope-flap">
        <svg viewBox="0 0 320 128" preserveAspectRatio="none" className="size-full" aria-hidden>
          <path d="M14 0 H306 A14 14 0 0 1 320 14 L160 128 L0 14 A14 14 0 0 1 14 0 Z" fill="var(--g-envelope-flap)" />
        </svg>
      </div>
      <div className="envelope-seal">
        <Spark className="size-[52%]" />
      </div>
      {name && size === "full" && (
        <p className="envelope-name px-6 font-serif text-[clamp(1.125rem,4.6vw,1.5rem)] italic leading-tight">
          <span className="line-clamp-1">{name}</span>
        </p>
      )}
    </div>
  );
}
