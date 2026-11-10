/**
 * Joins class names: strings, falsy values (skipped) and { class: condition }
 * maps. The small subset of clsx that the vendored UI components use
 * (components/vendor), so they need no extra dependency.
 */
type ClassValue = string | false | null | undefined | Record<string, boolean | undefined | null>;

export function cn(...values: ClassValue[]): string {
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    if (typeof v === "string") out.push(v);
    else for (const [k, on] of Object.entries(v)) if (on) out.push(k);
  }
  return out.join(" ");
}
