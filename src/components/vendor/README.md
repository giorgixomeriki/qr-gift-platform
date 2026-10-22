# Third-party components (copied in, not installed)

Used only by the Luxury Vintage world's closing (`src/components/greeting/vintage-keepsake.tsx`),
which RevealClosing loads lazily, so none of this — nor `motion` / `canvas-confetti` — reaches
the six other worlds. Each file's header records its source commit and every adaptation.

| Component | Source | Commit | Licence | Adaptation | Used for |
|---|---|---|---|---|---|
| `react-bits/Stack.tsx` + `Stack.css` | https://github.com/DavidHDev/react-bits — `src/ts-default/Components/Stack` | `08a0115` (2026-10-08) | MIT + Commons Clause (`react-bits/LICENSE-react-bits.md`): use in an app allowed; the component itself may not be sold or redistributed | `ariaLabel` prop (localized) instead of a fixed English label; non-null assertions / one tuple type for `noUncheckedIndexedAccess` | The closing's photos as a pile of prints (drag, tap, Enter/Space/arrows) |
| `motion-primitives/spinning-text.tsx` | https://github.com/ibelick/motion-primitives — `components/core/spinning-text.tsx` | `e3c7b99` (2025-01-09) | MIT (`motion-primitives/LICENCE.md`) | `cn` → plain join; reduced motion honoured; `ease` typed `as const` | The postmark ring around the wax seal (turns once, then rests) |
| `magic-ui/confetti.tsx` | https://github.com/magicuidesign/magicui — `apps/www/registry/magicui/confetti.tsx` | `8f0ff43` (2026-07-31) | MIT (`magic-ui/LICENSE.md`) | Only `<Confetti>` kept (ConfettiButton needs shadcn's Button); worker off (a blob: worker would need a CSP change) | Rose petals falling once when the seal is seen (never under reduced motion) |

Runtime packages added for these (approved 2026-10-22): `motion` 12 (MIT), `canvas-confetti` 1.9 (ISC; `@types/canvas-confetti` dev).

Evaluated, not integrated: React Bits **SplitText** (needs `@gsap/react`, not approved — the world's own GSAP scene already inks the letter), Motion Primitives **Morphing Dialog** (its tap-to-expand would compete with the Stack's tap-to-next).
