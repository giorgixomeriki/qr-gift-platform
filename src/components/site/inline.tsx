import Link from "next/link";
import type { ReactNode } from "react";
import { formatMinorAmount } from "@/lib/format/money";
import { resolveMerchantToken } from "@/lib/merchant/info";
import { parseInline, type InlineNode } from "@/lib/site/inline";
import { Pending } from "./pending";
import type { SiteContext } from "./context";

const linkClass = "font-medium text-ink underline decoration-ember/50 decoration-1 underline-offset-[3px] transition-colors hover:decoration-ember";

function renderNode(node: InlineNode, ctx: SiteContext, key: number): ReactNode {
  switch (node.kind) {
    case "text":
      return node.text;
    case "bold":
      return (
        <strong key={key} className="font-medium text-ink">
          {renderNodes(node.children, ctx)}
        </strong>
      );
    case "link":
      return node.href.startsWith("/") ? (
        <Link key={key} href={node.href} className={linkClass}>
          {renderNodes(node.children, ctx)}
        </Link>
      ) : (
        <a key={key} href={node.href} className={linkClass}>
          {renderNodes(node.children, ctx)}
        </a>
      );
    case "fact":
      return ctx.facts[node.name];
    case "price":
      return ctx.price ? (
        <span key={key} className="whitespace-nowrap font-medium text-ink" data-price>
          {formatMinorAmount(ctx.price.amountMinor, ctx.price.currency, ctx.locale)}
        </span>
      ) : (
        <Pending key={key} name="price" label={ctx.labels.priceUnavailable} hint={ctx.labels.pendingHint} />
      );
    case "merchant": {
      const { field, value } = resolveMerchantToken(ctx.merchant, node.name, ctx.locale);
      if (value === null) return <Pending key={key} name={field} label={ctx.labels.pending} hint={ctx.labels.pendingHint} />;
      if (node.name === "entityType") return ctx.labels.entityTypes[value] ?? value;
      if (node.name === "supportEmail" || node.name === "privacyEmail")
        return (
          <a key={key} href={`mailto:${value}`} className={linkClass}>
            {value}
          </a>
        );
      if (node.name === "phone")
        return (
          <a key={key} href={`tel:${value.replace(/[\s-]/g, "")}`} className={`${linkClass} whitespace-nowrap`}>
            {value}
          </a>
        );
      return value;
    }
  }
}

function renderNodes(nodes: InlineNode[], ctx: SiteContext): ReactNode[] {
  return nodes.map((n, i) => renderNode(n, ctx, i));
}

/** Renders one string of site copy (see lib/site/inline.ts for the syntax). */
export function Inline({ text, ctx }: { text: string; ctx: SiteContext }) {
  return <>{renderNodes(parseInline(text), ctx)}</>;
}
