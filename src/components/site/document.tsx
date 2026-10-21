import { Scale, Signpost } from "lucide-react";
import type { Block, Section } from "@/lib/site/document";
import { Inline } from "./inline";
import type { SiteContext } from "./context";

export type DocumentLabels = { onThisPage: string; review: string; decision: string };

function BlockView({ block, ctx, labels }: { block: Block; ctx: SiteContext; labels: DocumentLabels }) {
  switch (block.type) {
    case "p":
      return (
        <p>
          <Inline text={block.text} ctx={ctx} />
        </p>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className={`space-y-2 pl-5 ${block.ordered ? "list-decimal marker:text-ink-3" : "list-disc marker:text-ember"}`}>
          {block.items.map((item, i) => (
            <li key={i} className="pl-1">
              <Inline text={item} ctx={ctx} />
            </li>
          ))}
        </Tag>
      );
    }
    case "table":
      return (
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[34rem] border-collapse text-left text-body-sm">
            <thead>
              <tr className="border-b border-line-strong">
                {block.head.map((h, i) => (
                  <th key={i} scope="col" className="py-2.5 pr-4 align-bottom font-medium text-ink">
                    <Inline text={h} ctx={ctx} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-b border-line align-top">
                  {row.map((cell, c) => (
                    <td key={c} className={`py-2.5 pr-4 ${c === 0 ? "text-ink" : ""}`}>
                      <Inline text={cell} ctx={ctx} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "callout":
      return (
        <div className={`rounded-md px-4 py-3.5 ${block.tone === "important" ? "border-l-2 border-ember bg-ember-soft/60" : "bg-sunken"}`}>
          {block.title && (
            <p className="mb-1 font-medium text-ink">
              <Inline text={block.title} ctx={ctx} />
            </p>
          )}
          <p>
            <Inline text={block.text} ctx={ctx} />
          </p>
        </div>
      );
    case "review":
      return (
        <div data-marker="review" className="flex gap-3 rounded-md border border-dashed border-warning/40 bg-warning-soft/70 px-4 py-3 text-body-sm">
          <Scale className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p>
            <span className="font-medium text-warning">{labels.review}: </span>
            <Inline text={block.text} ctx={ctx} />
          </p>
        </div>
      );
    case "decision":
      return (
        <div data-marker="decision" data-ref={block.ref} className="flex gap-3 rounded-md border border-dashed border-line-strong bg-sunken px-4 py-3 text-body-sm">
          <Signpost className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
          <p>
            <span className="font-medium text-ink">
              {labels.decision} ({block.ref}):{" "}
            </span>
            <Inline text={block.text} ctx={ctx} />
          </p>
        </div>
      );
  }
}

/** Table of contents + numbered sections of a long-form information page. */
export function SiteDocument({ sections, ctx, labels, numbered = false }: { sections: Section[]; ctx: SiteContext; labels: DocumentLabels; numbered?: boolean }) {
  return (
    <div className="grid gap-10 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-14">
      {sections.length > 2 && (
        <nav aria-label={labels.onThisPage} className="lg:sticky lg:top-24 lg:self-start">
          <p className="text-eyebrow text-ink-3">{labels.onThisPage}</p>
          <ol className="mt-3 space-y-1.5 border-l border-line text-body-sm">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="-ml-px block border-l border-transparent py-0.5 pl-3 text-ink-2 transition-colors hover:border-ember hover:text-ink">
                  {numbered ? `${i + 1}. ` : ""}
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className={`min-w-0 space-y-12 text-body text-ink-2 ${sections.length > 2 ? "" : "lg:col-span-2 lg:max-w-3xl"}`}>
        {sections.map((s, i) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-24">
            <h2 id={`${s.id}-title`} className="font-serif text-[1.5rem] leading-tight text-ink">
              {numbered && <span className="mr-2 text-ember">{i + 1}.</span>}
              {s.title}
            </h2>
            <div className="mt-4 space-y-4">
              {s.blocks.map((b, j) => (
                <BlockView key={j} block={b} ctx={ctx} labels={labels} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
