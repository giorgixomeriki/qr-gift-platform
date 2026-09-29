import { getTranslations } from "next-intl/server";
import { Ban, Hourglass } from "lucide-react";
import { StatusScreen } from "@/components/flow/status-screen";
import { LocaleSwitcher } from "@/components/greeting/locale-switcher";

/**
 * Terminal QR states that have no greeting to show: BLOCKED (moderation — no
 * content either way) and a DRAFT visited without edit access (someone
 * else's in-progress draft, or a lost/cleared cookie). The ACTIVE recipient
 * route has a real experience — see components/greeting/recipient-view.tsx.
 */

export async function DraftNoAccessPlaceholder() {
  const t = await getTranslations("sender.noAccess");
  return (
    <StatusScreen
      icon={<Hourglass aria-hidden />}
      title={t("title")}
      body={t("body")}
      hint={t("hint")}
      headerEnd={<LocaleSwitcher />}
    />
  );
}

export async function BlockedPlaceholder() {
  const t = await getTranslations("qr");
  return <StatusScreen icon={<Ban aria-hidden />} title={t("unavailableTitle")} body={t("unavailableBody")} headerEnd={<LocaleSwitcher />} />;
}
