import type { ComponentProps, ReactNode } from "react";
import { ContinueIcon } from "./icons";
import { Spinner } from "@/components/ui/spinner";

/**
 * The customer flow's primary action (seeded on the entry screen): deep wine,
 * lit from above, pressed into the page on tap — see .cx-cta in globals.css.
 * `loading` keeps the label in place (invisible) so the button never changes
 * size mid-action, and marks it busy for assistive tech.
 */
export function PrimaryAction({
  children,
  loading = false,
  disabled,
  icon = <ContinueIcon size={18} weight="bold" aria-hidden />,
  className = "",
  type = "button",
  ...rest
}: ComponentProps<"button"> & { loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      type={type}
      className={`cx-cta ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      <span className={`flex min-w-0 flex-1 items-center justify-center gap-3 ${loading ? "invisible" : ""}`}>
        <span className="min-w-0 flex-1 text-balance ps-9">{children}</span>
        <span className="cx-cta__icon">{icon}</span>
      </span>
      {loading && (
        <span className="absolute inset-0 grid place-items-center">
          <Spinner className="size-5" />
        </span>
      )}
    </button>
  );
}
