"use client";

import { lazy, Suspense, type ComponentProps } from "react";

/**
 * The /g/[token] screens as separate client bundles, still server-rendered.
 * Next bundles every client component a page *can* render into that page's
 * chunk; behind these boundaries a recipient never downloads the sender's
 * wizard, and the Signature wizard never ships the legacy one it replaces.
 *
 * React.lazy inside an explicit Suspense, rather than next/dynamic: the tree
 * is then identical on the server and the client, so useId-based ids (the wax
 * seal's SVG defs) hydrate without a mismatch.
 */
const LazySenderEntry = lazy(() => import("./sender-entry").then((m) => ({ default: m.SenderEntry })));
const LazyCreationWizard = lazy(() => import("./creation-wizard").then((m) => ({ default: m.CreationWizard })));
const LazySignatureWizard = lazy(() => import("./signature-wizard").then((m) => ({ default: m.SignatureWizard })));
const LazyRecipientView = lazy(() => import("./recipient-view").then((m) => ({ default: m.RecipientView })));

export function SenderEntry(props: ComponentProps<typeof LazySenderEntry>) {
  return (
    <Suspense>
      <LazySenderEntry {...props} />
    </Suspense>
  );
}
export function CreationWizard(props: ComponentProps<typeof LazyCreationWizard>) {
  return (
    <Suspense>
      <LazyCreationWizard {...props} />
    </Suspense>
  );
}
export function SignatureWizard(props: ComponentProps<typeof LazySignatureWizard>) {
  return (
    <Suspense>
      <LazySignatureWizard {...props} />
    </Suspense>
  );
}
export function RecipientView(props: ComponentProps<typeof LazyRecipientView>) {
  return (
    <Suspense>
      <LazyRecipientView {...props} />
    </Suspense>
  );
}
