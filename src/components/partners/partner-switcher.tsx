"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { control, fieldLabel } from "@/components/dashboard/ui";
import { setActivePartnerAction } from "@/lib/auth/actions";

type Membership = { partnerId: string; role: string; partnerName: string };

export function PartnerSwitcher({ memberships, activePartnerId }: { memberships: Membership[]; activePartnerId: string | null }) {
  const t = useTranslations("partnerSwitcher");
  const tRole = useTranslations("enums.partnerRole");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (memberships.length <= 1) return null;

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    startTransition(async () => {
      await setActivePartnerAction(value);
      router.refresh();
    });
  }

  return (
    <label className={`${fieldLabel} min-w-56`}>
      {t("label")}
      <select
        defaultValue={activePartnerId ?? ""}
        onChange={handleChange}
        disabled={pending}
        className={control}
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
