import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { Inline } from "./inline";
import type { SiteContext } from "./context";

const itemsSchema = z.array(z.object({ title: z.string().min(1), text: z.string().min(1) })).min(1);

/**
 * A row of short titled cards read from `<namespace>.<key>` (an array of
 * {title, text}). `numbered` shows them as steps.
 */
export async function Highlights({ namespace, itemsKey, ctx, numbered = false, label }: { namespace: string; itemsKey: string; ctx: SiteContext; numbered?: boolean; label: string }) {
  const t = await getTranslations(namespace);
  const items = itemsSchema.parse(t.raw(itemsKey));
  const Tag = numbered ? "ol" : "ul";
  return (
    <Tag aria-label={label} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid={`highlights-${itemsKey}`}>
      {items.map((item, i) => (
        <li key={i} className="rounded-[var(--radius-lg)] bg-surface p-5 shadow-xs ring-1 ring-line">
          {numbered && (
            <span aria-hidden className="grid size-8 place-items-center rounded-full bg-ember-soft font-serif text-[1.0625rem] text-ember-ink">
              {i + 1}
            </span>
          )}
          <p className={`text-h3 text-ink ${numbered ? "mt-4" : ""}`}>
            <Inline text={item.title} ctx={ctx} />
          </p>
          <p className="mt-1.5 text-body-sm text-ink-2">
            <Inline text={item.text} ctx={ctx} />
          </p>
        </li>
      ))}
    </Tag>
  );
}
