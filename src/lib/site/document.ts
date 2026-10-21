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
 * Both are rendered visibly, and any of them on a page marks the whole page
 * as a draft (components/site/draft-banner.tsx). They disappear only by
 * editing the copy after the review or decision, never by a flag.
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
