"use client";

import { useTranslations } from "next-intl";

/**
 * Who is selling, and the policies that apply — shown on the checkout screen
 * just before payment (Bank of Georgia / card-scheme practice: the merchant's
 * name and its terms, privacy and refund policy must be reachable from the
 * payment page; card schemes also expect the merchant's country there). The
 * seller and country lines appear only once the deployment has a real
 * registered name configured (MERCHANT_LEGAL_NAME_*); nothing is shown in its
 * place otherwise. Links open in a new tab so the checkout is not lost.
 */
export function CheckoutLegal({
  merchantName,
  vatStatus = null,
  className,
}: {
  merchantName: string | null;
  /** Display only: the price itself always comes from the server (order snapshot). */
  vatStatus?: "NOT_REGISTERED" | "REGISTERED" | null;
  className?: string;
}) {
  const t = useTranslations("wizard.checkout.legal");
  const links = [
    { href: "/terms", label: t("terms"), testId: "checkout-link-terms" },
    { href: "/privacy", label: t("privacy"), testId: "checkout-link-privacy" },
    { href: "/delivery-and-refunds", label: t("refunds"), testId: "checkout-link-refunds" },
    { href: "/contact", label: t("contact"), testId: "checkout-link-contact" },
  ];
  return (
    <div className={className} data-testid="checkout-legal">
      <p data-testid="checkout-brand">
        <span className="font-medium">QR Starr</span>
        {merchantName && (
          <span data-testid="checkout-seller">
            {" · "}
            {t("seller")}: <span className="font-medium">{merchantName}</span>
          </span>
        )}
      </p>
      {merchantName && <p data-testid="checkout-country">{t("country")}</p>}
      {vatStatus && <p data-testid="checkout-vat">{t(`vat.${vatStatus}`)}</p>}
      <p data-testid="checkout-age">{t("age")}</p>
      <p>
        {t("policies")}{" "}
        {links.map((l, i) => (
          <span key={l.href}>
            {i > 0 && " · "}
            <a href={l.href} target="_blank" rel="noopener" className="underline underline-offset-2" data-testid={l.testId}>
              {l.label}
            </a>
          </span>
        ))}
      </p>
    </div>
  );
}
