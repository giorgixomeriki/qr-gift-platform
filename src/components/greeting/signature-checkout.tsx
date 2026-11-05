"use client";

import { useLocale, useTranslations } from "next-intl";
import { ErrorIcon, SecureIcon, SuccessIcon, TimeIcon } from "@/components/customer/icons";
import { WaxSeal } from "@/components/customer/wax-seal";
import { Dock, SigAction } from "@/components/signature/chrome";
import { ThemeWorld } from "@/components/themes/theme-world";
import { Spinner } from "@/components/ui/spinner";
import { formatMinorAmount } from "@/lib/format/money";
import type { ThemeKey } from "@/lib/themes/registry";
import { useCheckoutFlow } from "./checkout-flow";
import type { GreetingRenderContent } from "./greeting-renderer";
import "@/components/signature/checkout.css";

/**
 * Checkout in the Signature Experience: the order slip — the card itself,
 * ruled rows (design, contents, activation, total) and what happens next —
 * over the real CheckoutOrderSummary. The amount is only ever the server's
 * (summary.grossAmountMinor), never a constant.
 *
 * Behaviour is useCheckoutFlow's, shared verbatim with the legacy screen:
 * return-from-provider polling, the "still confirming" hold (never a second
 * Pay button), test-mode simulation behind a labelled disclosure, closed
 * checkout, failure and cancellation with retry. Only the presentation is
 * new; every data-testid of the legacy screen is kept.
 */
export function SignatureCheckout({
  greetingId,
  isTestPayments,
  themeKey,
  content,
  onBackToPreview,
  onEdit,
}: {
  greetingId: string;
  isTestPayments: boolean;
  themeKey: ThemeKey;
  content: GreetingRenderContent;
  onBackToPreview: () => void;
  onEdit: () => void;
}) {
  const t = useTranslations("wizard.checkout");
  const ts = useTranslations("wizard.sig");
  const tt = useTranslations("themes");
  const locale = useLocale();
  const { summary, loading, verifying, paying, error, closed, failed, cancelled, succeeded, uncertain, verifyReturn, pay, payReal, retry } = useCheckoutFlow(greetingId);

  const showRealPayButton = !isTestPayments && !failed && !cancelled;
  const amountLabel = summary ? formatMinorAmount(summary.grossAmountMinor, summary.currency, locale) : null;
  const contents = [
    content.message ? ts("itemsText") : null,
    content.photos.length ? ts("itemsPhotos", { count: content.photos.length }) : null,
    content.video ? ts("itemsVideo") : null,
    content.audio ? ts("itemsVoice") : null,
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-1 flex-col" data-testid="checkout-step">
      <h1 className="sig-title">{t("title")}</h1>
      <p className="sig-sub">{t("subtitle")}</p>

      {uncertain ? (
        <CheckoutState mark={<TimeIcon aria-hidden />} title={t("stillVerifying")} body={t("stillVerifyingBody")} testId="checkout-still-verifying" live>
          <button type="button" className="sig-ghost" onClick={() => void verifyReturn()} data-testid="checkout-check-again">
            {t("checkAgain")}
          </button>
        </CheckoutState>
      ) : verifying ? (
        <CheckoutState mark={<Spinner className="size-6" />} title={t("verifying")} body={t("verifyingBody")} testId="checkout-verifying" live />
      ) : loading ? (
        <section className="sig-order sig-order--skeleton" aria-busy="true">
          <div className="sig-order__head">
            <span className="sig-skel aspect-[4/5] !rounded-[3px]" />
            <span className="flex flex-col gap-2">
              <span className="sig-skel h-3 w-1/3" />
              <span className="sig-skel h-4 w-4/5" />
            </span>
          </div>
          <span className="sig-skel mt-2 h-px w-full" />
          <span className="sig-skel mt-5 h-3 w-full" />
          <span className="sig-skel mt-5 h-3 w-full" />
          <span className="sig-skel mt-6 ml-auto h-8 w-24" />
          <span className="sr-only">{t("loading")}</span>
        </section>
      ) : summary && !succeeded ? (
        <>
          <section className="sig-order" aria-labelledby="checkout-summary">
            <div className="sig-order__head">
              <ThemeWorld themeKey={themeKey} opening="" message="" near={false} className="sig-order__thumb" />
              <div className="min-w-0">
                <h2 id="checkout-summary" className="sig-kicker">
                  {t("orderKicker")}
                </h2>
                <p className="sig-order__msg">{content.message}</p>
              </div>
              <button type="button" className="sig-order__edit" onClick={onEdit}>
                {t("edit")}
              </button>
            </div>
            <dl className="sig-rows">
              <div>
                <dt>{t("design")}</dt>
                <dd>{tt(`${themeKey}.name`)}</dd>
              </div>
              <div>
                <dt>{t("contents")}</dt>
                <dd>{contents.join(" · ")}</dd>
              </div>
              <div>
                <dt>{t("activationLabel")}</dt>
                <dd className="sig-tnum">{amountLabel}</dd>
              </div>
              <div className="sig-rows__total">
                <dt>{t("total")}</dt>
                <dd data-testid="checkout-amount">{amountLabel}</dd>
              </div>
            </dl>
            <p className="sig-caption">{t("explanation")}</p>
          </section>

          <section className="sig-get" aria-labelledby="checkout-next">
            <h2 id="checkout-next" className="sig-kicker">
              {t("nextTitle")}
            </h2>
            <ol>
              {(["next1", "next2", "next3"] as const).map((k, i) => (
                <li key={k}>
                  <span className="sig-num">0{i + 1}</span>
                  {t(k)}
                </li>
              ))}
            </ol>
          </section>

          <p className="sig-caption sig-caption--lock">{t("lock")}</p>

          <div className="sig-co-links">
            <button type="button" className="sig-co-link" onClick={onBackToPreview} data-testid="checkout-back-link">
              {t("backToPreview")}
            </button>
            {isTestPayments && !failed && (
              <details>
                <summary className="sig-co-link" data-testid="checkout-testing-toggle">
                  {t("testingOptions")}
                </summary>
                <button type="button" onClick={() => pay("failure")} disabled={paying} className="sig-co-link sig-co-link--danger" data-testid="checkout-simulate-failure">
                  {t("simulateFailure")}
                </button>
              </details>
            )}
          </div>

          <Dock>
            {cancelled && (
              <p className="sig-status" data-tone="warning" role="status">
                <ErrorIcon size={16} weight="fill" aria-hidden />
                <span data-testid="payment-cancelled-message">{t("cancelledMessage")}</span>
              </p>
            )}
            {failed && (
              <p className="sig-status" data-tone="danger" role="alert">
                <ErrorIcon size={16} weight="fill" aria-hidden />
                <span data-testid="payment-failed-message">{t("paymentFailed")}</span>
              </p>
            )}
            {error && (
              <p className="sig-status" data-tone="danger" role="alert">
                <ErrorIcon size={16} weight="fill" aria-hidden />
                {t("errorGeneric")}
              </p>
            )}
            <SigAction
              className="sig-cta--pay"
              onClick={() => (failed || cancelled ? retry() : isTestPayments ? pay("success") : payReal())}
              disabled={paying || (showRealPayButton && !summary.redirectUrl)}
              busy={paying}
              testId={failed || cancelled ? "checkout-retry" : "checkout-pay"}
            >
              {paying
                ? t("processing")
                : failed || cancelled
                  ? t("retry")
                  : isTestPayments
                    ? t("payButton", { price: amountLabel ?? "" })
                    : t("payButtonReal", { price: amountLabel ?? "" })}
            </SigAction>
            {isTestPayments ? (
              <p className="sig-test">{t("testMode")}</p>
            ) : (
              <p className="sig-secure">
                <SecureIcon size={13} weight="bold" aria-hidden />
                {t("secureNote")}
              </p>
            )}
          </Dock>
        </>
      ) : succeeded ? (
        <CheckoutState mark={<SuccessIcon weight="fill" aria-hidden />} title={t("activating")} live seal />
      ) : closed ? (
        <CheckoutState mark={<TimeIcon aria-hidden />} title={t("closedTitle")} body={t("closedBody")} testId="checkout-closed">
          <button type="button" className="sig-ghost" onClick={onBackToPreview}>
            {t("backToPreview")}
          </button>
        </CheckoutState>
      ) : (
        <CheckoutState mark={<ErrorIcon aria-hidden />} title={t("errorTitle")} body={t("errorGeneric")}>
          <button type="button" className="sig-ghost" onClick={retry}>
            {t("retry")}
          </button>
        </CheckoutState>
      )}
    </div>
  );
}

function CheckoutState({
  mark,
  title,
  body,
  testId,
  live = false,
  seal = false,
  children,
}: {
  mark: React.ReactNode;
  title: string;
  body?: string;
  testId?: string;
  live?: boolean;
  seal?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="sig-co-state sig-rise" data-testid={testId} role={live ? "status" : undefined} aria-live={live ? "polite" : undefined}>
      {seal ? <WaxSeal className="sig-co-state__wax" /> : <span className="sig-co-state__mark">{mark}</span>}
      <h2>{title}</h2>
      {body && <p>{body}</p>}
      {children}
    </div>
  );
}
