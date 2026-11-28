import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { ActivatePartnerForm } from "@/components/auth/activate-partner-form";
import { ButtonLink } from "@/components/ui/button";
import { previewLink } from "@/lib/partners/login-access";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Landing page of an emailed partner activation / password-reset link
 * (lib/partners/login-access.ts). The token is only looked up by its hash;
 * a wrong, used, revoked or expired token shows a plain state and nothing
 * about any partner.
 */
export default async function PartnerActivatePage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token: raw } = await searchParams;
  const token = typeof raw === "string" ? raw : "";
  const preview = token ? await previewLink(token) : ({ state: "invalid" } as const);
  const t = await getTranslations("partnerAccess");
  const tAuth = await getTranslations("auth");

  if (preview.state !== "valid") {
    const title = { used: t("activate.usedTitle"), expired: t("activate.expiredTitle"), inactive: t("activate.inactiveTitle"), invalid: t("activate.invalidTitle") }[preview.state];
    const body = { used: t("errors.link_used"), expired: t("errors.link_expired"), inactive: t("errors.partner_inactive"), invalid: t("errors.invalid_link") }[preview.state];
    return (
      <AuthShell area={tAuth("areaPartner")}>
        <div className="flex flex-col gap-5" data-testid={`activate-state-${preview.state}`}>
          <h1 className="font-serif text-[1.875rem] leading-tight tracking-[-0.01em]">{title}</h1>
          <p className="text-body-sm text-ink-2">{body}</p>
          <ButtonLink href="/partner/login" size="lg" block>
            {t("activate.goToLogin")}
          </ButtonLink>
        </div>
      </AuthShell>
    );
  }

  const recovery = preview.purpose === "RECOVERY";
  return (
    <AuthShell area={tAuth("areaPartner")}>
      <div className="flex flex-col gap-5" data-testid="activate-state-valid">
        <div>
          <h1 className="font-serif text-[1.875rem] leading-tight tracking-[-0.01em]">{recovery ? t("activate.recoveryTitle") : t("activate.title")}</h1>
          <p className="mt-2 text-body-sm text-ink-2">{t(recovery ? "activate.recoveryBody" : "activate.body", { partner: preview.partnerName })}</p>
          <p className="mt-1 text-caption text-ink-3">{t("activate.emailLine", { email: preview.maskedEmail })}</p>
        </div>
        <ActivatePartnerForm token={token} recovery={recovery} />
      </div>
    </AuthShell>
  );
}
