# QR Starr design system

One system for every surface — sender flow, recipient experience, partner and
admin dashboards, print sheets. Everything below lives in code; this page is a
map, not a second source of truth.

## Where things live

| Concern | File |
| --- | --- |
| Tokens (colour, type scale, radius, shadow, motion), `@font-face`, reveal choreography | `src/app/globals.css` |
| Buttons, fields, notices, bottom sheet, spinner, logo/spark | `src/components/ui/*` |
| Sender-flow shell, sticky action bar, status screens | `src/components/flow/*` |
| Recipient renderer, envelope, particles, voice player, theme swatch | `src/components/greeting/*` |
| Templates (catalogue, vocabulary, schema, rooms) | `src/lib/templates/` — see `docs/design/THEME-ENGINE.md` |
| Renderer views of a template: `--g-*` (v1 renderer), `--w-*` (worlds) | `src/lib/themes/registry.ts`, `src/lib/themes/worlds.ts` |
| Theme worlds (compositions, scenes) | `src/components/themes/` |
| Dashboard primitives (page header, panel, stat, badge, table, controls) | `src/components/dashboard/ui.tsx` |
| Money formatting (client + server) | `src/lib/format/money.ts` |

## Principles

- **Paper, ink, one accent.** Primary actions are ink (`bg-primary`); ember
  (`text-ember`) is the spark accent — use it sparingly.
- **One primary action per screen**, bottom-anchored on phones via `ActionBar`.
- **Type:** Google Sans for UI (Latin + Georgian); Newsreader + Noto Serif
  Georgian for display and greeting text (`font-serif`, `text-display`,
  `text-h1`). Never `uppercase` Georgian — `.text-eyebrow` disables it under
  `:lang(ka)` because it would switch to Mtavruli.
- **Radius:** 8 / 12 / 20 / 28 (`--radius-sm|md|lg|xl`). Controls 12, cards 20, sheets 28.
- **Buttons wrap** (min-height, not fixed height): Georgian labels run 30–50%
  longer than English.
- **Motion** carries state and is short; the recipient reveal is the one
  expressive moment. Everything collapses under `prefers-reduced-motion`.
- **Copy** lives only in `src/messages/{en,ka}.json` — keep keys in parity.
  Consumer screens never show raw server error strings; map them to localized copy.

## Adding a theme (template)

1. Add a `TemplateDefinition` in `src/lib/templates/definitions/` and list it in `catalog.ts` (and a collection).
2. Add a `themes` seed row in `src/db/seed.ts`.
3. Add `themes.<id>.{name,tagline,opening,ending,sample}` to both message files.
4. Run `npm run verify:templates`.

No component branches on a template id; a template reusing an existing composition needs no component or CSS changes. A new composition is a design pass — see `docs/design/THEME-ENGINE.md` §2.

## Fonts

Self-hosted in `public/fonts` (SIL OFL 1.1 — licences alongside). No build- or
run-time requests to Google.
