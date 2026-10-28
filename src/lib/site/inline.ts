import { isMerchantToken, type MerchantToken } from "@/lib/merchant/info";

/**
 * The small inline syntax the public information pages' long-form copy
 * (messages/site/*.json) is written in. Kept deliberately tiny and parsed
 * here, not with a Markdown library, so both languages are checked by the
 * same code (scripts/verify-site-content.ts):
 *
 *   **bold**            emphasis
 *   [label](/path)      link: internal path, mailto: or tel:
 *   {{merchant.name}}   merchant detail (lib/merchant/info.ts MERCHANT_TOKENS)
 *   {{fact.name}}       product fact derived from code (FACT_TOKENS)
 *   {{price}}           the current standard price
 *
 * Copy is read with t.raw(), so ICU braces never apply to it.
 */

export const FACT_TOKENS = [
  "messageMaxLength",
  "photoCount",
  "photoMaxMb",
  "photoFormats",
  "videoCount",
  "videoMaxMb",
  "videoFormats",
  "voiceCount",
  "voiceMaxSeconds",
  "voiceMaxMb",
  "voiceFormats",
  "themeCount",
  "editAccessDays",
] as const;
export type FactToken = (typeof FACT_TOKENS)[number];

export type InlineNode =
  | { kind: "text"; text: string }
  | { kind: "bold"; children: InlineNode[] }
  | { kind: "link"; href: string; children: InlineNode[] }
  | { kind: "merchant"; name: MerchantToken }
  | { kind: "fact"; name: FactToken }
  | { kind: "price" };

export class InlineSyntaxError extends Error {}

const PATTERN = /(\*\*.+?\*\*|\[[^\]]+\]\([^)\s]+\)|\{\{[a-zA-Z.]+\}\})/g;

export function isAllowedHref(href: string): boolean {
  return /^\/[a-z0-9\-/#]*$/.test(href) || /^mailto:\S+@\S+$/.test(href) || /^tel:\+\d+$/.test(href);
}

export function parseInline(source: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  for (const part of source.split(PATTERN)) {
    if (!part) continue;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      nodes.push({ kind: "bold", children: parseInline(part.slice(2, -2)) });
      continue;
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const href = link[2]!;
      if (!isAllowedHref(href)) throw new InlineSyntaxError(`Link target not allowed: ${href}`);
      nodes.push({ kind: "link", href, children: parseInline(link[1]!) });
      continue;
    }
    const token = /^\{\{([a-zA-Z.]+)\}\}$/.exec(part);
    if (token) {
      const name = token[1]!;
      if (name === "price") nodes.push({ kind: "price" });
      else if (name.startsWith("merchant.") && isMerchantToken(name.slice(9))) nodes.push({ kind: "merchant", name: name.slice(9) as MerchantToken });
      else if (name.startsWith("fact.") && (FACT_TOKENS as readonly string[]).includes(name.slice(5))) nodes.push({ kind: "fact", name: name.slice(5) as FactToken });
      else throw new InlineSyntaxError(`Unknown token {{${name}}}`);
      continue;
    }
    if (/\{\{|\}\}|\[\[|\]\]/.test(part)) throw new InlineSyntaxError(`Malformed placeholder in: ${part}`);
    nodes.push({ kind: "text", text: part });
  }
  return nodes;
}

/** Every merchant token used anywhere in these nodes. */
export function merchantTokensIn(nodes: InlineNode[]): MerchantToken[] {
  return nodes.flatMap((n) => (n.kind === "merchant" ? [n.name] : n.kind === "bold" || n.kind === "link" ? merchantTokensIn(n.children) : []));
}

export function linksIn(nodes: InlineNode[]): string[] {
  return nodes.flatMap((n) => (n.kind === "link" ? [n.href, ...linksIn(n.children)] : n.kind === "bold" ? linksIn(n.children) : []));
}
