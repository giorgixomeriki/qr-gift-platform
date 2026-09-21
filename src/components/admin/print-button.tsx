"use client";

export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} style={{ padding: "10px 20px", fontSize: "14px", cursor: "pointer" }} data-testid="print-page-button">
      {label}
    </button>
  );
}
