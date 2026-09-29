"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton({ label }: { label: string }) {
  return (
    <Button onClick={() => window.print()} icon={<Printer className="size-4" aria-hidden />} data-testid="print-page-button">
      {label}
    </Button>
  );
}
