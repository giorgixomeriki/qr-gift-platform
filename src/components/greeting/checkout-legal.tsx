"use client";

import { useState } from "react";
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
 * The two consents a buyer gives before payment, both unticked by default:
 *   1. agreement to the Terms and the Delivery and Refunds policy, and
 *      acknowledgement of the Privacy Policy;
 *   2. the request for immediate activation and the acknowledgement that the
 *      right of withdrawal ends once the greeting is activated (digital
 *      content not on a physical medium).
 * onChange reports true only while both are ticked; the checkout screens keep
 * Pay disabled until then, and the server refuses a payment without both
 * (acceptCheckoutTerms), recording them against the order.
 */
export function CheckoutConsent({ onChange, className }: { onChange: (bothGiven: boolean) => void; className?: string }) {
  const t = useTranslations("wizard.checkout.legal");
  const [terms, setTerms] = useState(false);
  const [activation, setActivation] = useState(false);
  const box = "mt-0.5 size-5 shrink-0 accent-current";
  return (
    <div className={["flex flex-col gap-3", className].filter(Boolean).join(" ")}>
      <label className="flex items-start gap-2.5">
        <input
          type="checkbox"
          className={box}
          checked={terms}
          onChange={(e) => {
            setTerms(e.target.checked);
            onChange(e.target.checked && activation);
          }}
          data-testid="checkout-consent"
        />
        <span>{t("consent")}</span>
      </label>
      <label className="flex items-start gap-2.5">
        <input
          type="checkbox"
          className={box}
          checked={activation}
          onChange={(e) => {
            setActivation(e.target.checked);
            onChange(terms && e.target.checked);
          }}
          data-testid="checkout-consent-activation"
        />
        <span>{t("activationConsent")}</span>
      </label>
    </div>
  );
}
