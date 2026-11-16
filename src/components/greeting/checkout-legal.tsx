"use client";

import { useTranslations } from "next-intl";
import type { CheckoutSeller } from "@/lib/merchant/info";

/**
 * Who is selling, and the policies that apply — shown on the checkout screen
 * just before payment (Bank of Georgia / card-scheme practice: the merchant's
 * name and its terms, privacy and refund policy must be reachable from the
 * payment page; card schemes also expect the merchant's country there). The
 * seller lines appear only once the deployment has a real registered name
 * configured (MERCHANT_LEGAL_NAME_*); nothing is shown in its place otherwise.
 * The registered identification code and legal address (E-Commerce Law
 * Art. 4(1)(d), Consumer Protection Law Art. 5(1)(b)) follow the same
 * publication gates as the legal pages: they arrive here as null until the
 * owner's approval variable is set, and are then simply not rendered.
 * Links open in a new tab so the checkout is not lost.
 */
export function CheckoutLegal({
  seller,
  currency = null,
  vatStatus = null,
  className,
}: {
  seller: CheckoutSeller | null;
  /** The order's currency (server summary); GEL gets an explicit "Georgian lari (GEL)" line next to the ₾ sign. */
  currency?: string | null;
  /** Display only: the price itself always comes from the server (order snapshot). */
  vatStatus?: "NOT_REGISTERED" | "REGISTERED" | null;
  className?: string;
}) {
  const t = useTranslations("wizard.checkout.legal");
  return (
    <div className={className} data-testid="checkout-legal">
      <p data-testid="checkout-brand">
        <span className="font-medium">QR Starr</span>
        {seller && (
          <span data-testid="checkout-seller">
            {" · "}
            {t("seller")}: <span className="font-medium">{seller.name}</span>
          </span>
        )}
      </p>
      {seller?.idCode && (
        <p data-testid="checkout-id-code">
          {t("idCode")}: <span className="tabular-nums">{seller.idCode}</span>
        </p>
      )}
      {seller?.legalAddress && (
        <p data-testid="checkout-legal-address">
          {t("legalAddress")}: {seller.legalAddress}
        </p>
      )}
      {seller && <p data-testid="checkout-country">{t("country")}</p>}
      {currency === "GEL" && <p data-testid="checkout-currency">{t("currencyGel")}</p>}
      {vatStatus && <p data-testid="checkout-vat">{t(`vat.${vatStatus}`)}</p>}
      <p data-testid="checkout-age">{t("age")}</p>
      <p>
        {t("policies")} <PolicyLinks />
      </p>
    </div>
  );
}

function PolicyLinks() {
  const t = useTranslations("wizard.checkout.legal");
  const links = [
    { href: "/terms", label: t("terms"), testId: "checkout-link-terms" },
    { href: "/privacy", label: t("privacy"), testId: "checkout-link-privacy" },
    { href: "/delivery-and-refunds", label: t("refunds"), testId: "checkout-link-refunds" },
    { href: "/contact", label: t("contact"), testId: "checkout-link-contact" },
  ];
  return (
    <>
      {links.map((l, i) => (
        <span key={l.href}>
          {i > 0 && " · "}
          <a href={l.href} target="_blank" rel="noopener" className="underline underline-offset-2" data-testid={l.testId}>
            {l.label}
          </a>
        </span>
      ))}
    </>
  );
}

/**
 * The buyer's explicit agreement to the Terms and the Delivery and Refunds
 * policy, and acknowledgement of the Privacy Policy, before payment. Unticked
 * by default; the checkout screens keep the Pay button disabled until it is
 * ticked. Consent is given per visit and is not stored: it gates the redirect
 * to the bank's page, which is the moment the purchase is made.
 */
export function CheckoutConsent({ checked, onChange, className }: { checked: boolean; onChange: (checked: boolean) => void; className?: string }) {
  const t = useTranslations("wizard.checkout.legal");
  return (
    <label className={["flex items-start gap-2.5", className].filter(Boolean).join(" ")}>
      <input
        type="checkbox"
        className="mt-0.5 size-5 shrink-0 accent-current"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        data-testid="checkout-consent"
      />
      <span>{t("consent")}</span>
    </label>
  );
}
