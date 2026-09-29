import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Spinner } from "./spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "inverse";
type Size = "sm" | "md" | "lg";

const base =
  // min-h (not fixed h) + wrapping labels: Georgian copy runs 30–50% longer than
  // English, and a label must never push a button wider than a 320px screen.
  "relative inline-flex max-w-full select-none items-center justify-center gap-2 text-center leading-tight font-medium [&_svg]:shrink-0 " +
  "transition-[background-color,color,box-shadow,transform,opacity] duration-150 ease-out " +
  "active:scale-[0.98] disabled:pointer-events-none aria-disabled:pointer-events-none " +
  "focus-visible:outline-2 focus-visible:outline-offset-2";

const variants: Record<Variant, string> = {
  primary:
    "bg-primary text-ink-inverse shadow-xs hover:bg-primary-hover " +
    "disabled:bg-[var(--disabled-bg)] disabled:text-[var(--disabled-ink)] disabled:shadow-none",
  secondary:
    "bg-surface text-ink shadow-xs ring-1 ring-inset ring-line-strong hover:bg-sunken " +
    "disabled:text-[var(--disabled-ink)] disabled:ring-line",
  ghost: "text-ink-2 hover:bg-sunken hover:text-ink disabled:text-[var(--disabled-ink)]",
  danger: "text-danger hover:bg-danger-soft disabled:text-[var(--disabled-ink)]",
  inverse: "bg-white/95 text-ink shadow-sm backdrop-blur hover:bg-white",
};

const sizes: Record<Size, string> = {
  sm: "min-h-9 rounded-sm px-3 py-1.5 text-label",
  md: "min-h-11 rounded-md px-4 py-2 text-[0.9375rem]",
  lg: "min-h-13 rounded-md px-6 py-2.5 text-base",
};

export function buttonClasses({
  variant = "primary",
  size = "md",
  block = false,
  className = "",
}: {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  className?: string;
}) {
  return `${base} ${variants[variant]} ${sizes[size]} ${block ? "w-full" : ""} ${className}`;
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  loading?: boolean;
  /** When set, shown next to the spinner while loading (e.g. "Processing payment…"). */
  loadingLabel?: ReactNode;
  icon?: ReactNode;
  iconEnd?: ReactNode;
};

/**
 * `loading` keeps the label in the layout (invisible) so the button never
 * changes width mid-action, and marks itself busy for assistive tech.
 */
export function Button({
  variant,
  size,
  block,
  loading = false,
  loadingLabel,
  icon,
  iconEnd,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses({ variant, size, block, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      <span className={`inline-flex min-w-0 items-center gap-2 ${loading ? "invisible" : ""}`}>
        {icon}
        {children}
        {iconEnd}
      </span>
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center gap-2" role="status">
          <Spinner className="size-[1.15em]" />
          {loadingLabel}
        </span>
      )}
    </button>
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> & {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  icon?: ReactNode;
  iconEnd?: ReactNode;
};

export function ButtonLink({ variant, size, block, icon, iconEnd, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={buttonClasses({ variant, size, block, className })} {...rest}>
      {icon}
      {children}
      {iconEnd}
    </Link>
  );
}
