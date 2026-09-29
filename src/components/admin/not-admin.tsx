import { ShieldOff } from "lucide-react";
import { EmptyState, Panel } from "@/components/dashboard/ui";

/** Graceful state for a signed-in non-admin — never a crash into a generic error page. */
export function NotAdmin({ message }: { message: string }) {
  return (
    <Panel>
      <EmptyState icon={<ShieldOff aria-hidden />} title={message} />
    </Panel>
  );
}
