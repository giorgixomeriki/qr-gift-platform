import "server-only";
import { parseInline, type InlineNode } from "@/lib/site/inline";
import { getProductFacts } from "@/lib/site/facts";
import { resolveMerchantToken, type MerchantInfo } from "@/lib/merchant/info";
import kaSite from "@/messages/site/ka.json";
import enSite from "@/messages/site/en.json";

/**
 * The Terms and the Delivery and Refunds policy as plain text, for the
 * purchase confirmation. Consumer Rights Protection Law Art. 12(6): the
 * confirmation on a durable medium must carry the Art. 5(1)(a)–(i) and
 * Art. 10 information (trader, service, price, payment and performance,
 * complaints, duration, withdrawal) — these two documents hold all of it.
 * Same tokens and the same publication gates as the live policy pages.
 */
export type ConfirmationDocument = { title: string; sections: { title: string; lines: string[] }[] };

type Block =
  | { type: "p"; text: string }
  | { type: "list"; items: string[]; ordered?: boolean }
  | { type: "callout"; title?: string; text: string }
  | { type: "table"; head: string[]; rows: string[][] };

function flatten(nodes: InlineNode[], ctx: { info: MerchantInfo; locale: "ka" | "en"; facts: Record<string, string>; price: string }): string {
  return nodes
    .map((n) => {
      switch (n.kind) {
        case "text":
          return n.text;
        case "bold":
          return flatten(n.children, ctx);
        case "link": {
          const label = flatten(n.children, ctx);
          const href = n.href.startsWith("/") ? `qrapp.ge${n.href}` : n.href.replace(/^mailto:|^tel:/, "");
          return label.includes(href) ? label : `${label} (${href})`;
        }
        case "merchant":
          return resolveMerchantToken(ctx.info, n.name, ctx.locale).value ?? "—";
        case "fact":
          return ctx.facts[n.name] ?? "";
        case "price":
          return ctx.price;
      }
    })
    .join("");
}

export function confirmationDocuments(info: MerchantInfo, locale: "ka" | "en", price: string): ConfirmationDocument[] {
  const site = (locale === "en" ? enSite : kaSite) as unknown as Record<string, { title: string; sections: { title: string; blocks: Block[] }[] }>;
  const ctx = { info, locale, facts: getProductFacts() as Record<string, string>, price };
  const text = (s: string) => flatten(parseInline(s), ctx);
  return (["terms", "refunds"] as const).map((key) => ({
    title: text(site[key]!.title),
    sections: site[key]!.sections.map((s) => ({
      title: text(s.title),
      lines: s.blocks.flatMap((b): string[] => {
        if (b.type === "p") return [text(b.text)];
        if (b.type === "list") return b.items.map((i, n) => `${b.ordered ? `${n + 1}.` : "•"} ${text(i)}`);
        if (b.type === "callout") return [b.title ? `${text(b.title)}: ${text(b.text)}` : text(b.text)];
        return b.rows.map((r) => r.map((c, n) => `${text(b.head[n] ?? "")}: ${text(c)}`).join("; "));
      }),
    })),
  }));
}
