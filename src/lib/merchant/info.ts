import { z } from "zod";
import type { Locale } from "@/lib/i18n/config";
import { DEMO_MERCHANT_ENV } from "./demo";

/**
 * The merchant's own identity and contact details, shown on the public
 * information pages and in the site footer (Bank of Georgia's merchant
 * website requirements: legal name, identification code, address, email,
 * phone). They are deployment configuration, not code: set them per
 * environment (MERCHANT_* variables, see docs/merchant/MERCHANT_INFORMATION.md).
 *
 * Nothing here is ever invented. A value that is unset, or set but invalid,
 * resolves to null and is listed in `missing`/`invalid`; the UI then renders
 * an explicit "not yet published" marker (components/site/merchant-value.tsx)
 * instead of anything that could pass for real data.
 *
 * Pure (no `server-only`, no process.env access) so tests and the
 * ops:check-merchant-info script can call it with any environment.
 */

export const ENTITY_TYPES = ["LLC", "JSC", "IE", "OTHER"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

type FieldSpec = {
  env: string;
  /** Required before the site can be presented as complete (BOG list). */
  required: boolean;
  schema: z.ZodType<string>;
  /** What the owner must provide, for the checklist. */
  describe: string;
};

const text = z.string().trim().min(2).max(300);

export const MERCHANT_FIELDS = {
  legalNameKa: { env: "MERCHANT_LEGAL_NAME_KA", required: true, schema: text, describe: "Registered legal name, in Georgian, exactly as in the registry extract" },
  legalNameEn: { env: "MERCHANT_LEGAL_NAME_EN", required: true, schema: text, describe: "Registered legal name, in Latin script (as on the registry extract / bank documents)" },
  entityType: {
    env: "MERCHANT_ENTITY_TYPE",
    required: true,
    schema: z.enum(ENTITY_TYPES),
    describe: "Legal form: LLC (შპს), JSC (სს), IE (ინდ. მეწარმე) or OTHER",
  },
  idCode: {
    env: "MERCHANT_ID_CODE",
    required: true,
    // 9 digits for a company identification code; 11 for an individual
    // entrepreneur's personal number.
    schema: z.string().trim().regex(/^(\d{9}|\d{11})$/, "9 or 11 digits"),
    describe: "Identification code (ს/კ): 9 digits, or 11 for an individual entrepreneur",
  },
  legalAddressKa: { env: "MERCHANT_LEGAL_ADDRESS_KA", required: true, schema: text, describe: "Registered legal address, in Georgian" },
  legalAddressEn: { env: "MERCHANT_LEGAL_ADDRESS_EN", required: true, schema: text, describe: "Registered legal address, in English" },
  actualAddressKa: { env: "MERCHANT_ACTUAL_ADDRESS_KA", required: false, schema: text, describe: "Actual (operating) address, in Georgian, if different from the legal address" },
  actualAddressEn: { env: "MERCHANT_ACTUAL_ADDRESS_EN", required: false, schema: text, describe: "Actual (operating) address, in English, if different from the legal address" },
  supportEmail: { env: "MERCHANT_SUPPORT_EMAIL", required: true, schema: z.email().trim(), describe: "Customer support email address" },
  phone: {
    env: "MERCHANT_PHONE",
    required: true,
    // Stored as entered; validated as a Georgian number in international form.
    schema: z.string().trim().regex(/^\+995[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}[\s-]?\d{2}$/, "+995 followed by 9 digits"),
    describe: "Customer contact phone, international format: +995 5XX XX XX XX",
  },
  supportHoursKa: { env: "MERCHANT_SUPPORT_HOURS_KA", required: false, schema: text, describe: "Support hours, in Georgian (e.g. ორშ–პარ, 10:00–18:00)" },
  supportHoursEn: { env: "MERCHANT_SUPPORT_HOURS_EN", required: false, schema: text, describe: "Support hours, in English" },
  privacyEmail: {
    env: "MERCHANT_PRIVACY_EMAIL",
    required: false,
    schema: z.email().trim(),
    describe: "Email for personal-data requests (falls back to the support email when unset)",
  },
  legalEffectiveDate: {
    env: "LEGAL_EFFECTIVE_DATE",
    required: false,
    schema: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
    describe: "Date the approved terms and policies take effect (YYYY-MM-DD). Set only after legal approval",
  },
} as const satisfies Record<string, FieldSpec>;

export type MerchantField = keyof typeof MERCHANT_FIELDS;
export const MERCHANT_FIELD_NAMES = Object.keys(MERCHANT_FIELDS) as MerchantField[];

export type MerchantInfo = {
  values: Record<MerchantField, string | null>;
  /** Required fields that are unset or invalid. */
  missing: MerchantField[];
  /** Fields that were set but rejected, with the reason. Their value is null. */
  invalid: { field: MerchantField; env: string; reason: string }[];
  complete: boolean;
  /**
   * "demo" when the fictional preview profile is in use (MERCHANT_PROFILE=demo):
   * every value then carries a visible DEMO notice. "configured" otherwise.
   */
  mode: "configured" | "demo";
  /** Why a requested profile was not applied (e.g. demo on production); logged by the server loader. */
  profileRefused?: string;
};

export function parseMerchantInfo(env: Record<string, string | undefined>): MerchantInfo {
  const values = {} as Record<MerchantField, string | null>;
  const invalid: MerchantInfo["invalid"] = [];

  for (const field of MERCHANT_FIELD_NAMES) {
    const spec: FieldSpec = MERCHANT_FIELDS[field];
    const raw = env[spec.env];
    if (raw === undefined || raw.trim() === "") {
      values[field] = null;
      continue;
    }
    const parsed = spec.schema.safeParse(raw);
    if (parsed.success) {
      values[field] = parsed.data;
    } else {
      values[field] = null;
      invalid.push({ field, env: spec.env, reason: parsed.error.issues[0]?.message ?? "invalid" });
    }
  }

  const missing = MERCHANT_FIELD_NAMES.filter((f) => MERCHANT_FIELDS[f].required && values[f] === null);
  return { values, missing, invalid, complete: missing.length === 0, mode: "configured" };
}

/** Production hosts the demo profile is never allowed on. */
const PRODUCTION_HOSTS = new Set(["qrapp.ge", "www.qrapp.ge"]);

/**
 * Is this the production deployment? Either the hosting platform says so
 * (Vercel's VERCEL_ENV=production) or the app's public origin is the
 * production domain. NODE_ENV alone can't tell: preview deployments run with
 * NODE_ENV=production too.
 */
export function isProductionDeployment(env: Record<string, string | undefined>): boolean {
  if (env.VERCEL_ENV === "production") return true;
  try {
    return PRODUCTION_HOSTS.has(new URL(env.NEXT_PUBLIC_APP_URL ?? "").hostname);
  } catch {
    return false;
  }
}

/**
 * The merchant details a deployment shows. Normally the MERCHANT_* variables
 * (parseMerchantInfo). With MERCHANT_PROFILE=demo, the fictional preview
 * profile (./demo.ts) replaces them entirely, so demo and real values never
 * mix, and every value is shown with a DEMO notice. The demo profile is
 * refused on production: there, MERCHANT_PROFILE is ignored and the real
 * variables, with their missing-information safeguards, apply as usual.
 */
export function loadMerchantInfo(env: Record<string, string | undefined>): MerchantInfo {
  const profile = env.MERCHANT_PROFILE?.trim();
  if (!profile) return parseMerchantInfo(env);
  if (profile !== "demo") return { ...parseMerchantInfo(env), profileRefused: `Unknown MERCHANT_PROFILE "${profile}" ignored (only "demo" exists)` };
  if (isProductionDeployment(env)) {
    return { ...parseMerchantInfo(env), profileRefused: "MERCHANT_PROFILE=demo is not allowed on the production deployment; using the real MERCHANT_* variables" };
  }
  return { ...parseMerchantInfo(DEMO_MERCHANT_ENV), mode: "demo" };
}

/** Fields that exist once per language; the rest are language-neutral. */
const LOCALIZED: Partial<Record<string, { ka: MerchantField; en: MerchantField }>> = {
  legalName: { ka: "legalNameKa", en: "legalNameEn" },
  legalAddress: { ka: "legalAddressKa", en: "legalAddressEn" },
  actualAddress: { ka: "actualAddressKa", en: "actualAddressEn" },
  supportHours: { ka: "supportHoursKa", en: "supportHoursEn" },
};

/** The names content may reference as {{merchant.<name>}}. */
export const MERCHANT_TOKENS = ["legalName", "legalAddress", "actualAddress", "supportHours", "entityType", "idCode", "supportEmail", "phone", "privacyEmail"] as const;
export type MerchantToken = (typeof MERCHANT_TOKENS)[number];

export function isMerchantToken(name: string): name is MerchantToken {
  return (MERCHANT_TOKENS as readonly string[]).includes(name);
}

/** The underlying field a token reads in this locale (privacyEmail falls back to supportEmail). */
export function resolveMerchantToken(info: MerchantInfo, token: MerchantToken, locale: Locale): { field: MerchantField; value: string | null } {
  const localized = LOCALIZED[token];
  if (localized) {
    const field = localized[locale];
    return { field, value: info.values[field] };
  }
  if (token === "privacyEmail" && info.values.privacyEmail === null) {
    return { field: "supportEmail", value: info.values.supportEmail };
  }
  const field = token as MerchantField;
  return { field, value: info.values[field] };
}
