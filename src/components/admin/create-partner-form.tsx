"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { adminCreatePartnerAction } from "@/lib/partners/actions";

export function CreatePartnerForm() {
  const t = useTranslations("admin.partnersPage");
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [commissionPct, setCommissionPct] = useState("10");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await adminCreatePartnerAction({
      slug,
      name,
      commissionRateBps: Math.round(Number(commissionPct) * 100),
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSlug("");
    setName("");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3" data-testid="create-partner-form">
      <label className="flex flex-col gap-1 text-xs text-neutral-400">
        {t("nameLabel")}
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
          data-testid="partner-name-input"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-neutral-400">
        {t("slugLabel")}
        <input
          required
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder={t("slugPlaceholder")}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
          data-testid="partner-slug-input"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-neutral-400">
        {t("commissionLabel")}
        <input
          type="number"
          min={0}
          max={100}
          step="0.1"
          value={commissionPct}
          onChange={(e) => setCommissionPct(e.target.value)}
          className="w-24 rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
          data-testid="partner-commission-input"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 disabled:opacity-50"
        data-testid="create-partner-submit"
      >
        {pending ? "…" : t("createButton")}
      </button>
      {error && (
        <p className="text-sm text-red-400" data-testid="create-partner-error">
          {error}
        </p>
      )}
    </form>
  );
}
