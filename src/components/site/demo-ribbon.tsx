import { getTranslations } from "next-intl/server";
import { getMerchantInfo } from "@/lib/merchant/server";
import { DemoNotice } from "./demo";

/**
 * Page-top notice on every information page while the fictional demo
 * profile is active. Outside the sticky header, so it scrolls away instead
 * of covering the screen on a phone.
 */
export async function DemoRibbon() {
  if (getMerchantInfo().mode !== "demo") return null;
  const t = await getTranslations("site.demo");
  return (
    <div className="mx-auto w-full max-w-6xl px-page pt-[max(0.5rem,var(--safe-top))]" data-testid="demo-ribbon">
      <DemoNotice notice={t("notice")} body={t("body")} compact />
    </div>
  );
}
