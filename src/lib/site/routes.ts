/**
 * The public information pages (merchant website requirements). One list
 * drives the header, the mobile menu, the footer and the tests, so a page
 * can't exist without being linked, or be linked without existing.
 */
export const SITE_PAGES = [
  { key: "about", href: "/about", group: "company", primary: true },
  { key: "howItWorks", href: "/how-it-works", group: "service", primary: true },
  { key: "pricing", href: "/pricing", group: "service", primary: true },
  { key: "contact", href: "/contact", group: "company", primary: true },
  { key: "terms", href: "/terms", group: "legal", primary: false },
  { key: "privacy", href: "/privacy", group: "legal", primary: false },
  { key: "refunds", href: "/delivery-and-refunds", group: "legal", primary: false },
] as const;

export type SitePage = (typeof SITE_PAGES)[number];
export type SitePageKey = SitePage["key"];

export const SITE_GROUPS = ["company", "service", "legal"] as const;

export function sitePage(key: SitePageKey): SitePage {
  return SITE_PAGES.find((p) => p.key === key)!;
}
