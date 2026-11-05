import { z } from "zod";
import { parseInline, merchantTokensIn, linksIn, type InlineNode } from "./inline";
import type { MerchantToken } from "@/lib/merchant/info";

/**
 * Shape of a long-form information page in messages/site/<locale>.json
 * (`<page>.sections`). Two block types carry the review state:
 *
 *   review    a provision a lawyer has not yet confirmed
 *   decision  something only the merchant can decide (ref = README D-number
 *             or BOG question, e.g. "D1", "C4")
 *
 * Both are internal: they are shown, with the draft banner, only in review
 * mode (SITE_REVIEW_MARKERS=1). The public page leaves them out
 * (publishableSections) and a policy states "Not yet in effect" until it is
 * published with an effective date. They are resolved by editing the copy
 * after the review or decision.
 */

const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("p"), text: z.string().min(1) }),
  z.object({ type: z.literal("list"), ordered: z.boolean().optional(), items: z.array(z.string().min(1)).min(1) }),
  z.object({ type: z.literal("table"), head: z.array(z.string().min(1)).min(2), rows: z.array(z.array(z.string())).min(1) }),
  z.object({ type: z.literal("callout"), tone: z.enum(["info", "important"]), title: z.string().optional(), text: z.string().min(1) }),
  z.object({ type: z.literal("review"), text: z.string().min(1) }),
  z.object({ type: z.literal("decision"), ref: z.string().regex(/^[A-Z]\d{1,2}$/), text: z.string().min(1) }),
]);

const sectionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  blocks: z.array(blockSchema).min(1),
});

export const sectionsSchema = z.array(sectionSchema).min(1);

export type Block = z.infer<typeof blockSchema>;
export type Section = z.infer<typeof sectionSchema>;

/** Every inline string in a block, in reading order. */
export function blockStrings(block: Block): string[] {
  switch (block.type) {
    case "p":
    case "review":
    case "decision":
      return [block.text];
    case "callout":
      return block.title ? [block.title, block.text] : [block.text];
    case "list":
      return block.items;
    case "table":
      return [...block.head, ...block.rows.flat()];
  }
}

export type DocumentAnalysis = {
  reviews: number;
  decisions: string[];
  merchantTokens: MerchantToken[];
  links: string[];
  inline: InlineNode[][];
};

export function analyseSections(sections: Section[], extraStrings: string[] = []): DocumentAnalysis {
  const strings = [...extraStrings, ...sections.flatMap((s) => [s.title, ...s.blocks.flatMap(blockStrings)])];
  const inline = strings.map(parseInline);
  const blocks = sections.flatMap((s) => s.blocks);
  return {
    reviews: blocks.filter((b) => b.type === "review").length,
    decisions: blocks.flatMap((b) => (b.type === "decision" ? [b.ref] : [])),
    merchantTokens: [...new Set(inline.flatMap(merchantTokensIn))],
    links: [...new Set(inline.flatMap(linksIn))],
    inline,
  };
}

/**
 * The part of a page that can be published as it stands (audit UX-01): review and decision notes are internal
 * and never shown; a paragraph, callout, list item or table row that names a merchant detail which is not set is
 * left out rather than shown with a placeholder — nothing is invented, and nothing unfinished is presented. A
 * section left without blocks is left out. Missing details are reported to the owner instead
 * (`npm run ops:check-merchant-info`).
 */
export function publishableSections(sections: Section[], isSet: (token: MerchantToken) => boolean): Section[] {
  const ok = (text: string) => merchantTokensIn(parseInline(text)).every(isSet);
  const keep = (block: Block): Block | null => {
    switch (block.type) {
      case "review":
      case "decision":
        return null;
      case "p":
        return ok(block.text) ? block : null;
      case "callout":
        return ok(block.text) && (!block.title || ok(block.title)) ? block : null;
      case "list": {
        const items = block.items.filter(ok);
        return items.length ? { ...block, items } : null;
      }
      case "table": {
        const rows = block.rows.filter((r) => r.every(ok));
        return rows.length && block.head.every(ok) ? { ...block, rows } : null;
      }
    }
  };
  return sections.flatMap((s) => {
    const blocks = s.blocks.map(keep).filter((b): b is Block => b !== null);
    return blocks.length ? [{ ...s, blocks }] : [];
  });
}
