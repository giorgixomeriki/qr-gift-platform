/**
 * Stands in for a merchant detail or decision that has not been provided.
 * Deliberately looks like a marker, never like data: dashed outline, muted
 * ink, and the text says outright that the value is not yet published.
 * `data-pending` names what is missing, for tests and for the owner.
 */
export function Pending({ name, label, hint }: { name: string; label: string; hint: string }) {
  return (
    <span
      data-pending={name}
      title={hint}
      className="inline-flex items-center rounded-full border border-dashed border-line-strong bg-sunken px-2 py-px align-baseline text-caption font-medium text-ink-3"
    >
      {label}
    </span>
  );
}
