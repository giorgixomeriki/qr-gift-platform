"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Badge, control, fieldLabel } from "@/components/dashboard/ui";
import { Button } from "@/components/ui/button";
import { LocationPinMap } from "./location-pin-map";
import {
  adminCreateLocationAction,
  adminDeleteLocationAction,
  adminSetLocationStockAction,
  adminSetLocationVisibilityAction,
  adminUpdateLocationAction,
  adminVerifyLocationAction,
  type LocationActionResult,
} from "@/lib/partner-locations/actions";
import { isInGeorgia, LOCATION_CATEGORIES, mapsSearchUrl, parseCoordinates, type LocationAvailability, type LocationCategory } from "@/lib/partner-locations/shared";

export type AdminLocationRow = {
  id: string;
  branchName: string | null;
  category: LocationCategory;
  addressKa: string;
  addressEn: string | null;
  cityKa: string;
  cityEn: string | null;
  districtKa: string | null;
  districtEn: string | null;
  latitude: number;
  longitude: number;
  phone: string | null;
  hoursKa: string | null;
  hoursEn: string | null;
  stocksCards: boolean;
  isPublic: boolean;
  isMock: boolean;
  verified: boolean;
  availability: LocationAvailability;
  updatedAt: string;
};

type Draft = Record<"branchName" | "addressKa" | "addressEn" | "cityKa" | "cityEn" | "districtKa" | "districtEn" | "coordinates" | "phone" | "hoursKa" | "hoursEn", string> & {
  category: LocationCategory;
  stocksCards: boolean;
};

function toDraft(row?: AdminLocationRow): Draft {
  return {
    branchName: row?.branchName ?? "",
    category: row?.category ?? "FLOWERS",
    addressKa: row?.addressKa ?? "",
    addressEn: row?.addressEn ?? "",
    cityKa: row?.cityKa ?? "თბილისი",
    cityEn: row?.cityEn ?? "Tbilisi",
    districtKa: row?.districtKa ?? "",
    districtEn: row?.districtEn ?? "",
    coordinates: row ? `${row.latitude}, ${row.longitude}` : "",
    phone: row?.phone ?? "",
    hoursKa: row?.hoursKa ?? "",
    hoursEn: row?.hoursEn ?? "",
    stocksCards: row?.stocksCards ?? true,
  };
}

/**
 * Super Admin management of one partner's shop locations: add/edit, check
 * and verify the map pin, switch public visibility and the branch's
 * "stocks cards" flag. The server re-validates everything and the database
 * enforces the rules (migrations/0023): new rows start hidden + unverified,
 * moving a shop un-verifies and hides it, and only verified rows can be public.
 */
export function PartnerLocationsManager({ partnerId, locations, distributedUnsold }: { partnerId: string; locations: AdminLocationRow[]; distributedUnsold: number }) {
  const t = useTranslations("admin.locations");
  const tCat = useTranslations("landing.locations.categories");
  const locale = useLocale();
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(toDraft());
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const coords = parseCoordinates(draft.coordinates);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function run(key: string, call: () => Promise<LocationActionResult>, after?: () => void) {
    setPending(key);
    setError(null);
    setNotice(null);
    const result = await call();
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    after?.();
    router.refresh();
  }

  function open(row?: AdminLocationRow) {
    setDraft(toDraft(row));
    setEditing(row ? row.id : "new");
    setError(null);
    setNotice(null);
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!coords) {
      setError(t("coordinatesInvalid"));
      return;
    }
    const input = {
      branchName: draft.branchName,
      category: draft.category,
      addressKa: draft.addressKa,
      addressEn: draft.addressEn,
      cityKa: draft.cityKa,
      cityEn: draft.cityEn,
      districtKa: draft.districtKa,
      districtEn: draft.districtEn,
      latitude: coords.latitude,
      longitude: coords.longitude,
      phone: draft.phone,
      hoursKa: draft.hoursKa,
      hoursEn: draft.hoursEn,
      stocksCards: draft.stocksCards,
    };
    const row = locations.find((l) => l.id === editing);
    const moved =
      row !== undefined &&
      row.verified &&
      (row.latitude !== coords.latitude || row.longitude !== coords.longitude || row.addressKa !== draft.addressKa.trim() || (row.addressEn ?? "") !== draft.addressEn.trim() || row.cityKa !== draft.cityKa.trim() || (row.districtKa ?? "") !== draft.districtKa.trim());
    void run(
      "save",
      () => (row ? adminUpdateLocationAction(partnerId, row.id, row.updatedAt, input) : adminCreateLocationAction(partnerId, input)),
      () => {
        setEditing(null);
        if (moved) setNotice(t("movedNotice"));
      },
    );
  }

  const text = (key: Exclude<keyof Draft, "category" | "stocksCards">, opts: { required?: boolean; type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"] } = {}) => (
    <label className={fieldLabel}>
      {t(`fields.${key}`)}
      <input
        className={control}
        value={draft[key]}
        onChange={(e) => set(key, e.target.value)}
        required={opts.required}
        type={opts.type ?? "text"}
        inputMode={opts.inputMode}
        data-testid={`location-field-${key}`}
      />
    </label>
  );

  const form = (
    <form onSubmit={save} className="flex flex-col gap-4 rounded-lg bg-sunken/50 p-4 ring-1 ring-line ring-inset" data-testid="location-form">
      <div className="grid gap-4 sm:grid-cols-2">
        {text("branchName")}
        <label className={fieldLabel}>
          {t("fields.category")}
          <select className={control} value={draft.category} onChange={(e) => set("category", e.target.value as LocationCategory)} data-testid="location-field-category">
            {LOCATION_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {tCat(c)}
              </option>
            ))}
          </select>
        </label>
        {text("addressKa", { required: true })}
        {text("addressEn")}
        {text("cityKa", { required: true })}
        {text("cityEn")}
        {text("districtKa")}
        {text("districtEn")}
        {text("phone", { type: "tel", inputMode: "tel" })}
        {text("hoursKa")}
        {text("hoursEn")}
      </div>
      <div className="flex flex-col gap-2">
        {text("coordinates", { required: true, inputMode: "decimal" })}
        <p className="text-caption text-ink-3">{t("fields.coordinatesHint")}</p>
        {draft.coordinates !== "" && !coords && <p className="text-caption text-danger">{t("coordinatesInvalid")}</p>}
        {coords && !isInGeorgia(coords.latitude, coords.longitude) && <p className="text-caption text-warning" data-testid="location-outside-georgia">{t("outsideGeorgia")}</p>}
        <LocationPinMap
          latitude={coords?.latitude ?? null}
          longitude={coords?.longitude ?? null}
          onMove={(lat, lng) => set("coordinates", `${lat}, ${lng}`)}
          label={t("pinMapLabel")}
          unavailable={t("pinMapUnavailable")}
          locale={locale}
        />
        {coords && (
          <a href={mapsSearchUrl(coords.latitude, coords.longitude)} target="_blank" rel="noopener noreferrer" className="w-fit text-label text-ember-ink underline">
            {t("checkInMaps")}
          </a>
        )}
      </div>
      <label className="flex items-center gap-2 text-body-sm">
        <input type="checkbox" checked={draft.stocksCards} onChange={(e) => set("stocksCards", e.target.checked)} data-testid="location-field-stocksCards" />
        {t("fields.stocksCards")}
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={pending === "save"} data-testid="location-save">
          {editing === "new" ? t("create") : t("save")}
        </Button>
        <Button variant="ghost" onClick={() => setEditing(null)}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );

  return (
    <div className="flex flex-col gap-5" data-testid="partner-locations-manager">
      <div className="flex flex-col gap-1">
        <p className="text-label text-ink" data-testid="location-stock-summary">
          {t("stockSummary", { count: distributedUnsold })}
        </p>
        <p className="text-caption text-ink-3">{t("stockHint")}</p>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-caption text-danger" data-testid="location-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-caption text-warning" data-testid="location-notice">
          {notice}
        </p>
      )}

      {locations.length === 0 && editing !== "new" && <p className="text-caption text-ink-3">{t("empty")}</p>}

      <ul className="flex flex-col gap-3">
        {locations.map((row) => (
          <li key={row.id} className="flex flex-col gap-3 rounded-lg p-4 ring-1 ring-line ring-inset" data-testid="location-row" data-location-id={row.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-label text-ink">
                  {row.branchName ?? row.addressKa}
                  <span className="ml-2 text-caption text-ink-3">{tCat(row.category)}</span>
                </p>
                <p className="text-caption text-ink-2">
                  {row.addressKa}
                  {row.districtKa ? `, ${row.districtKa}` : ""}, {row.cityKa}
                </p>
                <p className="font-mono text-caption text-ink-3">
                  {row.latitude.toFixed(6)}, {row.longitude.toFixed(6)}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={row.isPublic ? "success" : "neutral"}>{row.isPublic ? t("status.public") : t("status.hidden")}</Badge>
                <Badge tone={row.verified ? "success" : "warning"}>{row.verified ? t("status.verified") : t("status.unverified")}</Badge>
                <Badge tone={row.availability === "AVAILABLE" ? "success" : row.availability === "OUT" ? "danger" : "neutral"}>{t(`status.${row.availability}`)}</Badge>
                {row.isMock && <Badge tone="warning">{t("status.test")}</Badge>}
              </div>
            </div>
            {editing === row.id ? (
              form
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => open(row)} data-testid="location-edit">
                  {t("edit")}
                </Button>
                <a href={mapsSearchUrl(row.latitude, row.longitude)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center px-2 text-label text-ember-ink underline">
                  {t("checkInMaps")}
                </a>
                {!row.verified && (
                  <Button
                    size="sm"
                    variant="secondary"
                    title={t("verifyHint")}
                    loading={pending === `verify-${row.id}`}
                    onClick={() => run(`verify-${row.id}`, () => adminVerifyLocationAction(partnerId, row.id, row.updatedAt))}
                    data-testid="location-verify"
                  >
                    {t("verify")}
                  </Button>
                )}
                {!row.isMock && (
                  <Button
                    size="sm"
                    variant={row.isPublic ? "secondary" : "primary"}
                    disabled={!row.isPublic && !row.verified}
                    loading={pending === `vis-${row.id}`}
                    onClick={() => run(`vis-${row.id}`, () => adminSetLocationVisibilityAction(partnerId, row.id, row.updatedAt, !row.isPublic))}
                    data-testid="location-visibility"
                  >
                    {row.isPublic ? t("hide") : t("publish")}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  loading={pending === `stock-${row.id}`}
                  onClick={() => run(`stock-${row.id}`, () => adminSetLocationStockAction(partnerId, row.id, row.updatedAt, !row.stocksCards))}
                  data-testid="location-stock"
                >
                  {row.stocksCards ? t("markOut") : t("markStocked")}
                </Button>
                {!row.isPublic && (
                  <Button
                    size="sm"
                    variant="danger"
                    loading={pending === `del-${row.id}`}
                    onClick={() => {
                      if (window.confirm(t("deleteConfirm"))) void run(`del-${row.id}`, () => adminDeleteLocationAction(partnerId, row.id, row.updatedAt));
                    }}
                    data-testid="location-delete"
                  >
                    {t("delete")}
                  </Button>
                )}
              </div>
            )}
            {!row.verified && editing !== row.id && <p className="text-caption text-ink-3">{t("verifyHint")}</p>}
          </li>
        ))}
      </ul>

      {editing === "new" ? (
        form
      ) : (
        <div>
          <Button variant="secondary" onClick={() => open()} data-testid="location-add">
            {t("add")}
          </Button>
        </div>
      )}
    </div>
  );
}
