"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { control, fieldLabel, table } from "@/components/dashboard/ui";
import { Button } from "@/components/ui/button";

type Member = { userId: string; role: string };
type ActionResult = { ok: true } | { ok: false; error: string };
type AddMemberByEmailResult = { ok: true; invited: boolean } | { ok: false; error: string };

const ROLES = ["OWNER", "ADMIN", "STAFF", "VIEWER"] as const;

/**
 * Membership CRUD UI, reused by both the admin console (any partner) and a
 * partner's own dashboard (their own partner only) — the action props are the
 * only thing that differs; authorization itself is enforced server-side in
 * whichever action is passed in, never by this component.
 *
 * Adds by EMAIL, not a raw Supabase auth UUID (Phase 5 §13) — an
 * owner/admin knows a teammate's email, never their internal user id. The
 * server resolves an existing account or invites a brand-new one via
 * Supabase Auth's own invite flow (lib/auth/admin-users.ts) — no new
 * invitation system, just the auth provider's existing capability.
 */
export function MembershipManager({
  members,
  addAction,
  updateRoleAction,
  removeAction,
}: {
  members: Member[];
  addAction: (input: unknown) => Promise<AddMemberByEmailResult>;
  updateRoleAction: (memberUserId: string, role: unknown) => Promise<ActionResult>;
  removeAction: (memberUserId: string) => Promise<ActionResult>;
}) {
  const t = useTranslations("membershipManager");
  const tRole = useTranslations("enums.partnerRole");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("STAFF");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);
    const result = await addAction({ email: email.trim(), role });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEmail("");
    setNotice(result.invited ? t("invited", { email }) : t("added", { email }));
    router.refresh();
  }

  async function handleRoleChange(memberUserId: string, nextRole: string) {
    setError(null);
    const result = await updateRoleAction(memberUserId, nextRole);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function handleRemove(memberUserId: string) {
    setError(null);
    const result = await removeAction(memberUserId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col" data-testid="membership-manager">
      <div className={table.wrap}>
        <table className={table.table}>
          <thead className={table.thead}>
            <tr>
              <th className={table.th}>{t("userIdHeader")}</th>
              <th className={table.th}>{t("roleHeader")}</th>
              <th className={table.th}>
                <span className="sr-only">{t("remove")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId} className={table.tr} data-testid="membership-row">
                <td className={`${table.td} max-w-56 truncate font-mono text-caption text-ink-2`} title={m.userId}>
                  {m.userId}
                </td>
                <td className={table.td}>
                  <select
                    value={m.role}
                    onChange={(e) => handleRoleChange(m.userId, e.target.value)}
                    aria-label={t("roleHeader")}
                    className={`${control} h-9 w-40`}
                    data-testid="membership-role-select"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {tRole(r)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className={`${table.td} text-right`}>
                  <Button size="sm" variant="danger" onClick={() => handleRemove(m.userId)} data-testid="membership-remove">
                    {t("remove")}
                  </Button>
                </td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={3} className="px-5 py-6 text-center text-caption text-ink-3">
                  {t("noMembers")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form onSubmit={handleAdd} className="grid gap-3 border-t border-line p-5 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-end" data-testid="add-member-form">
        <label className={fieldLabel}>
          {t("emailLabel")}
          <input
            required
            type="email"
            inputMode="email"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("emailPlaceholder")}
            className={control}
            data-testid="add-member-email"
          />
        </label>
        <label className={fieldLabel}>
          {t("roleLabel")}
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
            className={control}
            data-testid="add-member-role"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {tRole(r)}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" loading={pending} data-testid="add-member-submit">
          {t("addButton")}
        </Button>
      </form>
      {(notice || error) && (
        <div className="px-5 pb-5">
          {notice && (
            <p className="text-caption text-success" role="status" data-testid="membership-notice">
              {notice}
            </p>
          )}
          {error && (
            <p className="text-caption text-danger" role="alert" data-testid="membership-error">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
