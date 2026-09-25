"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { control, fieldLabel } from "@/components/dashboard/ui";
import { Button } from "@/components/ui/button";
import { adminCreatePartnerAction } from "@/lib/partners/actions";

/** Lowercase, hyphenated identifier derived from the name until the admin edits it by hand. */
function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function CreatePartnerForm() {
  const t = useTranslations("admin.partnersPage");
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [name, setName] = useState("");
  const [commissionPct, setCommissionPct] = useState("10");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await adminCreatePartnerAction({
      slug: slug.trim(),
      name: name.trim(),
      commissionRateBps: Math.round(Number(commissionPct) * 100),
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSlug("");
    setSlugTouched(false);
    setName("");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" data-testid="create-partner-form">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem_auto] sm:items-end">
        <label className={fieldLabel}>
          {t("nameLabel")}
          <input
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              // Latin names get a suggested identifier; Georgian names leave it for the admin to type.
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
            className={control}
            data-testid="partner-name-input"
          />
        </label>
        <label className={fieldLabel}>
          {t("slugLabel")}
          <input
            required
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            placeholder={t("slugPlaceholder")}
            autoCapitalize="none"
            spellCheck={false}
            className={`${control} font-mono`}
            data-testid="partner-slug-input"
          />
        </label>
        <label className={fieldLabel}>
          {t("commissionLabel")}
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step="0.1"
            value={commissionPct}
            onChange={(e) => setCommissionPct(e.target.value)}
            className={`${control} tabular-nums`}
            data-testid="partner-commission-input"
          />
        </label>
        <Button type="submit" loading={pending} data-testid="create-partner-submit">
          {t("createButton")}
        </Button>
      </div>
      {error && (
        <p className="text-caption text-danger" role="alert" data-testid="create-partner-error">
          {error}
        </p>
      )}
    </form>
  );
}
