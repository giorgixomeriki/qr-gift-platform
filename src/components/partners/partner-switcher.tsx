"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { setActivePartnerAction } from "@/lib/auth/actions";

type Membership = { partnerId: string; role: string; partnerName: string };

export function PartnerSwitcher({ memberships, activePartnerId }: { memberships: Membership[]; activePartnerId: string | null }) {
  const t = useTranslations("partnerSwitcher");
  const tRole = useTranslations("enums.partnerRole");
  const router = useRouter();

  if (memberships.length <= 1) return null;

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    await setActivePartnerAction(e.target.value);
    router.refresh();
  }

  return (
    <label className="flex items-center gap-2 text-xs text-neutral-500">
      {t("label")}
      <select
        defaultValue={activePartnerId ?? ""}
        onChange={handleChange}
        className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs"
        data-testid="partner-switcher"
      >
        {memberships.map((m) => (
          <option key={m.partnerId} value={m.partnerId}>
            {m.partnerName} ({tRole(m.role)})
          </option>
        ))}
      </select>
    </label>
  );
}
