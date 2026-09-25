"use client";

import { useEffect } from "react";

/**
 * Audit finding (Phase 6, UI/UX §6): the print sheet deliberately renders in
 * the owning Partner's `defaultLocale`, not the viewing admin/partner staff
 * member's browser locale (see PrintBatchPage's own doc comment) — but the
 * shared root layout's `<html lang>` still reflects the viewer's locale,
 * since this app intentionally has a single root layout (see
 * AGENTS.md/CLAUDE.md guidance against unnecessary restructuring). Splitting
 * every route into its own root layout just to get a second `<html>` tag
 * would be a real architectural change for a cosmetic mismatch; setting
 * `document.documentElement.lang` for this one page achieves the same
 * outcome (assistive tech and browser language tooling read this attribute
 * live, not just at initial paint) without touching the shared layout tree.
 */
export function SetHtmlLang({ lang }: { lang: string }) {
  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = lang;
    return () => {
      document.documentElement.lang = previous;
    };
  }, [lang]);

  return null;
}
