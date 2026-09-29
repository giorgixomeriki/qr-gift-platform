import { getTranslations } from "next-intl/server";
import { ScanLine } from "lucide-react";
import { StatusScreen } from "@/components/flow/status-screen";
import { LocaleSwitcher } from "@/components/greeting/locale-switcher";

export default async function NotFound() {
  const t = await getTranslations("qr");
  return <StatusScreen icon={<ScanLine aria-hidden />} title={t("notFoundTitle")} body={t("notFoundBody")} headerEnd={<LocaleSwitcher />} />;
}
