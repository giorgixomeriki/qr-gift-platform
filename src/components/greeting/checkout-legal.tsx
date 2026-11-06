"use client";

import { useTranslations } from "next-intl";

/**
 * Who is selling, and the policies that apply — shown on the checkout screen
 * just before payment (Bank of Georgia / card-scheme practice: the merchant's
 * name and its terms, privacy and refund policy must be reachable from the
 * payment page). The seller line appears only once the deployment has a real
 * registered name configured (MERCHANT_LEGAL_NAME_*); nothing is shown in its
 * place otherwise. Links open in a new tab so the checkout is not lost.
 */
export function CheckoutLegal({ merchantName, className }: { merchantName: string | null; className?: string }) {
  const t = useTranslations("wizard.checkout.legal");
  const links = [
    { href: "/terms", label: t("terms"), testId: "checkout-link-terms" },
    { href: "/privacy", label: t("privacy"), testId: "checkout-link-privacy" },
    { href: "/delivery-and-refunds", label: t("refunds"), testId: "checkout-link-refunds" },
  ];
  return (
    <div className={className} data-testid="checkout-legal">
      {merchantName && (
        <p data-testid="checkout-seller">
          {t("seller")}: <span className="font-medium">{merchantName}</span>
        </p>
      )}
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
