"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Badge, control, fieldLabel } from "@/components/dashboard/ui";
import { formatGeorgianMobile, maskEmail, maskPhone } from "@/lib/partners/contact";
import {
  adminRevokeInvitationAction,
  adminRevokeLoginAction,
  adminSendActivationAction,
  adminSendPasswordResetAction,
  adminSetPartnerContactsAction,
  type LoginActionResult,
} from "@/lib/partners/login-actions";
import { PASSWORD_MIN_LENGTH_PUBLIC } from "@/lib/partners/login-rules";

export type PartnerLoginPanelProps = {
  partnerId: string;
  contactEmail: string | null;
  contactPhone: string | null;
  logins: { userId: string; email: string | null; phone: string | null; lastSignInAt: string | null; banned: boolean }[];
  pending: { channel: "EMAIL" | "PHONE"; purpose: "ACTIVATION" | "RECOVERY"; contact: string; expiresAt: string } | null;
  emailConfigured: boolean;
  phoneEnabled: boolean;
};

/**
 * Admin control for a partner's single login: the registered contacts, the
 * linked login, any open invitation, and the actions that change them. All
 * rules are enforced server-side (lib/partners/login-access.ts); this only
 * shows what is possible.
 */
export function PartnerLoginPanel(props: PartnerLoginPanelProps) {
  const t = useTranslations("partnerAccess");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [email, setEmail] = useState(props.contactEmail ?? "");
  const [phone, setPhone] = useState(props.contactPhone ? formatGeorgianMobile(props.contactPhone) : "");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const date = (iso: string) => new Intl.DateTimeFormat(locale === "ka" ? "ka-GE" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tbilisi" }).format(new Date(iso));
  const hasLogin = props.logins.length > 0;

  async function run<T extends object>(key: string, action: () => Promise<LoginActionResult<T>>, success: (r: T) => string) {
    setBusy(key);
    setMessage(null);
    const result = await action();
    setBusy(null);
    if (!result.ok) {
      setMessage({ tone: "danger", text: t(`errors.${result.code}`, { min: PASSWORD_MIN_LENGTH_PUBLIC }) });
      return;
    }
    setMessage({ tone: "success", text: success(result) });
    setConfirmRevoke(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6" data-testid="partner-login-panel">
      <form
        className={`grid gap-3 sm:items-end ${props.phoneEnabled ? "sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" : "sm:grid-cols-[minmax(0,1fr)_auto]"}`}
        onSubmit={(e) => {
          e.preventDefault();
          // Email-only mode keeps any stored phone as it is; it just isn't shown.
          void run("contacts", () => adminSetPartnerContactsAction(props.partnerId, { email, phone: props.phoneEnabled ? phone : (props.contactPhone ?? "") }), () => t("admin.saved"));
        }}
      >
        {props.phoneEnabled && (
        <label className={fieldLabel}>
          {t("admin.contactPhone")}
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="off" placeholder={t("admin.phonePlaceholder")} className={`${control} tabular-nums`} data-testid="partner-contact-phone" />
        </label>
        )}
        <label className={fieldLabel}>
          {t("admin.contactEmail")}
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="off" autoCapitalize="none" spellCheck={false} className={control} data-testid="partner-contact-email" />
        </label>
        <Button type="submit" variant="secondary" loading={busy === "contacts"} data-testid="partner-contacts-save">
          {t("admin.saveContacts")}
        </Button>
      </form>

      <div className="flex flex-col gap-2 text-body-sm" data-testid="partner-login-status">
        <span className="text-caption font-medium text-ink-2">{t("admin.loginLinked")}</span>
        {hasLogin ? (
          props.logins.map((l) => (
            <div key={l.userId} className="flex flex-wrap items-center gap-2" data-testid="partner-login-row">
              <span className="font-medium">{l.email ? maskEmail(l.email) : l.phone ? maskPhone(l.phone) : l.userId.slice(0, 8)}</span>
              <span className="text-ink-3">{l.lastSignInAt ? t("admin.lastSignIn", { date: date(l.lastSignInAt) }) : t("admin.never")}</span>
              {l.banned && <Badge tone="danger">{t("admin.blocked")}</Badge>}
            </div>
          ))
        ) : (
          <span className="text-ink-3">{t("admin.noLogin")}</span>
        )}
        {props.pending && (
          <span className="text-ink-2" data-testid="partner-login-pending">
            {t(props.pending.purpose === "RECOVERY" ? "admin.pendingRECOVERY" : props.pending.channel === "PHONE" ? "admin.pendingPHONE" : "admin.pendingEMAIL", {
              contact: props.pending.channel === "PHONE" ? maskPhone(props.pending.contact) : maskEmail(props.pending.contact),
              date: date(props.pending.expiresAt),
            })}
          </span>
        )}
      </div>

      {!props.emailConfigured && <p className="text-caption text-ink-3">{t("admin.emailUnavailable")}</p>}

      <div className="flex flex-wrap gap-2">
        {!hasLogin && (
          <>
            <Button
              size="sm"
              disabled={!props.emailConfigured || !props.contactEmail}
              loading={busy === "email"}
              onClick={() => run("email", () => adminSendActivationAction(props.partnerId, "EMAIL"), (r) => t("admin.sent", { date: date(r.expiresAt) }))}
              data-testid="partner-send-email-activation"
            >
              {t("admin.sendEmail")}
            </Button>
            {props.phoneEnabled && (
            <Button
              size="sm"
              variant="secondary"
              disabled={!props.contactPhone}
              loading={busy === "phone"}
              onClick={() => run("phone", () => adminSendActivationAction(props.partnerId, "PHONE"), (r) => t("admin.phoneOpened", { date: date(r.expiresAt) }))}
              data-testid="partner-open-phone-signin"
            >
              {t("admin.openPhone")}
            </Button>
            )}
          </>
        )}
        {hasLogin && props.contactEmail && (
          <Button
            size="sm"
            variant="secondary"
            disabled={!props.emailConfigured}
            loading={busy === "reset"}
            onClick={() => run("reset", () => adminSendPasswordResetAction(props.partnerId), (r) => t("admin.sent", { date: date(r.expiresAt) }))}
            data-testid="partner-send-reset"
          >
            {t("admin.sendReset")}
          </Button>
        )}
        {props.pending && (
          <Button size="sm" variant="ghost" loading={busy === "cancel"} onClick={() => run("cancel", () => adminRevokeInvitationAction(props.partnerId), () => t("admin.revoked"))} data-testid="partner-revoke-invitation">
            {t("admin.revokeInvitation")}
          </Button>
        )}
        {hasLogin && !confirmRevoke && (
          <Button size="sm" variant="danger" onClick={() => setConfirmRevoke(true)} data-testid="partner-revoke-login">
            {t("admin.revokeLogin")}
          </Button>
        )}
      </div>

      {confirmRevoke && (
        <Notice tone="danger">
          <div className="flex flex-col gap-3">
            <span>{t("admin.revokeConfirm")}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="danger" loading={busy === "revoke"} onClick={() => run("revoke", () => adminRevokeLoginAction(props.partnerId), () => t("admin.revoked"))} data-testid="partner-revoke-login-confirm">
                {t("admin.confirm")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmRevoke(false)}>
                {tCommon("cancel")}
              </Button>
            </div>
          </div>
        </Notice>
      )}

      {message && (
        <p className={`text-caption ${message.tone === "danger" ? "text-danger" : "text-success"}`} role={message.tone === "danger" ? "alert" : "status"} data-testid="partner-login-message">
          {message.text}
        </p>
      )}
    </div>
  );
}
