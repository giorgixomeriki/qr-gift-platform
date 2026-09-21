"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

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
    const result = await addAction({ email, role });
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
    <div className="flex flex-col gap-3" data-testid="membership-manager">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-neutral-500">
            <th className="py-1">{t("userIdHeader")}</th>
            <th className="py-1">{t("roleHeader")}</th>
            <th className="py-1" />
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.userId} className="border-t border-neutral-800" data-testid="membership-row">
              <td className="py-1 font-mono text-xs">{m.userId}</td>
              <td className="py-1">
                <select
                  value={m.role}
                  onChange={(e) => handleRoleChange(m.userId, e.target.value)}
                  className="rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-xs"
                  data-testid="membership-role-select"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {tRole(r)}
                    </option>
                  ))}
                </select>
              </td>
              <td className="py-1">
                <button
                  type="button"
                  onClick={() => handleRemove(m.userId)}
                  className="text-xs text-red-400 underline"
                  data-testid="membership-remove"
                >
                  {t("remove")}
                </button>
              </td>
            </tr>
          ))}
          {members.length === 0 && (
            <tr>
              <td colSpan={3} className="py-2 text-xs text-neutral-500">
                {t("noMembers")}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2" data-testid="add-member-form">
        <label className="flex flex-col gap-1 text-xs text-neutral-400">
          {t("emailLabel")}
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("emailPlaceholder")}
            className="w-72 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs"
            data-testid="add-member-email"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-400">
          {t("roleLabel")}
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs"
            data-testid="add-member-role"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {tRole(r)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-900 disabled:opacity-50"
          data-testid="add-member-submit"
        >
          {pending ? "…" : t("addButton")}
        </button>
      </form>
      {notice && (
        <p className="text-xs text-emerald-400" data-testid="membership-notice">
          {notice}
        </p>
      )}
      {error && (
        <p className="text-xs text-red-400" data-testid="membership-error">
          {error}
        </p>
      )}
    </div>
  );
}
