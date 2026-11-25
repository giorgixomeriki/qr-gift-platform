/**
 * FICTIONAL merchant details for previewing the public pages before the real
 * company information exists. Nothing here identifies a real business:
 * 000000000 is not a valid identification code, example.com is reserved for
 * documentation (RFC 2606), and the address is made up.
 *
 * Used ONLY when a deployment opts in with MERCHANT_PROFILE=demo, and never
 * on production (lib/merchant/info.ts loadMerchantInfo). Every page then
 * shows a "DEMO / სატესტო მონაცემები" notice wherever these values appear.
 * It is not a default and must not be copied into real configuration.
 */
export const DEMO_MERCHANT_ENV: Readonly<Record<string, string>> = {
  MERCHANT_LEGAL_NAME_KA: "შპს ქიუარ სტარ დემო",
  MERCHANT_LEGAL_NAME_EN: "QR Starr Demo LLC",
  MERCHANT_ENTITY_TYPE: "LLC",
  MERCHANT_ID_CODE: "000000000",
  MERCHANT_LEGAL_ADDRESS_KA: "საქართველო, თბილისი, დემო ქუჩა №1",
  MERCHANT_LEGAL_ADDRESS_EN: "1 Demo Street, Tbilisi, Georgia",
  MERCHANT_SUPPORT_EMAIL: "demo@example.com",
  MERCHANT_PHONE: "+995 555 00 00 00",
  MERCHANT_SUPPORT_HOURS_KA: "ორშაბათი–პარასკევი, 10:00–18:00",
  MERCHANT_SUPPORT_HOURS_EN: "Monday–Friday, 10:00–18:00",
  MERCHANT_PRIVACY_EMAIL: "privacy@example.com",
  // No LEGAL_EFFECTIVE_DATE: demo data never puts the policies into effect.
};
