import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";

type Tone = "info" | "success" | "warning" | "danger";

const tones: Record<Tone, { cls: string; Icon: typeof Info }> = {
  info: { cls: "bg-sunken text-ink-2", Icon: Info },
  success: { cls: "bg-success-soft text-success", Icon: CircleCheck },
  warning: { cls: "bg-warning-soft text-warning", Icon: TriangleAlert },
  danger: { cls: "bg-danger-soft text-danger", Icon: CircleAlert },
};

/** Inline, non-modal status message. Errors are announced (role=alert). */
export function Notice({
  tone = "info",
  title,
  children,
  action,
  className = "",
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const { cls, Icon } = tones[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={`flex gap-3 rounded-md px-4 py-3 text-body-sm ${cls} ${className}`}
    >
      <Icon className="mt-0.5 size-[18px] shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium text-ink">{title}</p>}
        {children && <div className={title ? "mt-0.5 text-ink-2" : "text-ink"}>{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}
