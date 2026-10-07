# QR Starr — Theme Experience Engine

How QR Starr templates are modelled, rendered, versioned and extended — from
the six launch themes to a library of hundreds, and later to templates
composed for one sender ("Create your own").

Code: `src/lib/templates/` (model, vocabulary, catalogue, rooms) ·
`src/lib/themes/` (renderer views) · `src/components/themes/` (world
compositions and scenes) · `scripts/verify-templates.ts` (invariants).
Companions: `QR-STARR-DESIGN-ARSENAL.md`, `QR-STARR-MOTION-LANGUAGE.md`,
`theme-worlds/`, `../visual-walkthrough/theme-picker-immersive/`.

---

## 1. Where we started (audit, 2026-10-06)

- Themes were a closed TypeScript union (`ThemeKey = "romantic" | …`) with
  **two parallel registries**: `lib/themes/registry.ts` (palette, entrance,
  particles — the recipient renderer) and `lib/themes/worlds.ts` (art
  direction — the picker). Adding a theme meant editing both, plus:
  hardcoded picker order, per-theme `switch`es in `theme-world.tsx`, a
  `Record<ThemeKey>` of scenes, per-theme preload `if`s in the picker,
  56 lines naming a theme in `theme-picker.css` (six hand-written rooms,
  a hand-maintained list of dark rooms) and 58 in `theme-world.css`.
- Persistence: `greetings.theme_id → themes(key)`. `themes.config` jsonb is
  a stale, unused reference. **No version is recorded**, so redesigning a
  theme silently changes every past greeting that uses it.
- The picker rendered **worlds**; Preview and the recipient still rendered
  the **v1 renderer** (palette + envelope + particles). What the sender picked
  was not what the recipient received. **Resolved 2026-10-06** — see §3.1.
- Nothing about theme rendering touches payments, orders, commissions,
  payouts, attribution or greeting content. Theme choice is saved by
  `updateGreetingTheme` (edit-token checked, analytics event only).

## 2. The model

```
Template (data: TemplateDefinition, versioned)
├── catalogue metadata  id · version · status · origin · category · occasions
│                       moods · tags · contentTypes · pricing · renderer
└── spec (TemplateSpec — the only part a custom builder may produce)
    ├── composition ──► authored world (code): layout · artwork · material
    │                   ambience · signature scene · media frame
    │                   message reveal · recipient reveal · tier · rest assets
    ├── type ─────────► type pair (code): display + text families, KA + EN files
    ├── palette         12 world tokens (colours, validated)
    ├── dark
    ├── room            Screen #2 room: base · glow · texture id · blend · dark
    ├── finale          how the world closes the reveal (approved, composition-compatible — §3.2)
    ├── greeting        v1 palette · entrance · particle (now read only by the marketing-page ThemeSwatch)
    └── audio           reserved slot ("none" only)
```

**Authored compositions + data skins.** The engine deliberately has two
grains:

- A **composition** is expensive and authored: a designer-made world with its
  own layout, artwork, material, choreography (`theme-world.tsx`,
  `theme-world.css`, `scenes/scenes.ts`). It is what makes a world feel
  *made* rather than recoloured. There are six (`quiet-light`,
  `paper-party`, `vellum`, `signal`, `ink-and-stone`, `just-words`).
- A **skin** is cheap data: palette, type pair, room. Many templates can
  share one composition ("Romantic — Midnight" is a skin of `quiet-light`).

This is the line between "templates share technology" and "templates look
interchangeable": share compositions sparingly, and grow the library mostly
by adding compositions in deliberate design passes, plus skins where a
variation is genuinely wanted (seasonal, palette-led collections).

Why not a fully granular block system (background × ambience × media ×
message × transition × finale, freely combined)? Because free recombination
of independently designed parts is exactly what produces generic results and
breaks the "one signature per world" rule. The vocabulary *describes*
compositions at that granularity (`material`, `ambience`, `mediaFrame`,
`messageReveal`, `reveal`) so search, AI and future renderers can reason
about them — but a composition is designed as a whole. When a block proves
reusable across compositions (e.g. a vellum-lift reveal), it is extracted as a
scene **primitive** (`scenes/primitives.ts` — already: `themeLight`, `grow`,
`inkLines`, `vellumReveal`, `paperBurst`, `starrIgnition`, `throughLight`,
`editorialShutters`, `drawFrame`, `equilibrium`, `playFilm`, `attachDepth`).

### Where things live

| Concern | Where | Why |
|---|---|---|
| Template definitions | TypeScript (`src/lib/templates/definitions/*.ts`), validated by zod at verify time | Typed, reviewable, diffable; no behaviour from jsonb |
| Vocabulary (compositions, type pairs, assets, room textures, taxonomy) | `src/lib/templates/vocabulary.ts` | URLs and CSS live only in code; templates name ids |
| Compositions & scenes | `src/components/themes/` (TSX + CSS + GSAP scenes) | Authored code |
| Copy (name, tagline, opening, ending, sample) | `src/messages/{en,ka}.json` → `themes.<id>` | Localised with the rest of the product |
| Static assets | `public/customer/…`, `public/fonts/themes/…` + `LICENSES.md` | CDN-cached, licence-tracked |
| Database | `themes` (key, name, active) — the FK target greetings reference | Integrity + admin toggling; **not** rendering config |
| Runtime config | none yet | Feature flags for collections can come later |
| Future: creator/custom templates | DB rows holding a `TemplateSpec` JSON, parsed by `parseTemplateSpec` on read | Same renderer, same validation |

### Adding a template

1. `src/lib/templates/definitions/<id>.ts` — a `TemplateDefinition`.
2. Add it to `TEMPLATES` in `catalog.ts`, and to a collection.
3. `themes.<id>.{name,tagline,opening,ending,sample}` in both message files.
4. A `themes` row (`src/db/seed.ts` for local; a data migration for envs).
5. `npm run verify:templates` — schema, copy parity, assets, contrast, DB row.

A new *composition* additionally needs: its id + metadata in
`vocabulary.ts`, its branch in `theme-world.tsx` (`WorldArtwork`,
`SealArt`), `.tw--<id>` rules in `theme-world.css`, a scene in `scenes.ts`,
an arrival in `theme-picker.css` (`[data-enter="<id>"]`). The verify script
fails until all exist.

## 3. Rendering and loading

- **Rest state first.** Every world is fully designed in CSS at rest; its
  first paint is server-rendered (the picker's LCP). Scenes animate *from*
  offsets *to* that rest state, so a failed or skipped scene still leaves
  a finished world.
- **Rooms** are generated from template tokens (`templates/room.ts`) into one
  inline `<style>` — no per-template stylesheet rules, painted from the first
  frame without JS. Values are schema-validated (colours only; textures are
  ids), so the generated CSS cannot carry injected content. CSP allows
  inline styles (`style-src 'self' 'unsafe-inline'`).
- **Preloads** come from the catalogue: `restAssets(template)` = paper tooth
  + the composition's rest assets + the room texture. Footage is never
  preloaded: `<video preload="none" data-src>` gets its `src` only when its
  scene plays.
- **Fonts**: a world's faces apply only near the viewport (`data-near`); the
  chosen world's files are preloaded; neighbours' after idle.
- **Engines**: GSAP + plugins are a dynamic import (`scenes/runtime.ts`),
  ~36 KB gz in five async chunks, prefetched on idle, never in the route's
  initial JS (checked in the build manifest).

### 3.1 The recipient reveal is the world

`GreetingRenderer` (Preview and the recipient page — one renderer) tells the
greeting inside the template's world, in its room:

| Beat | What happens | Where the composition shows |
|---|---|---|
| Opening | The world **sealed**: its ground, the opening line, a seal in its accent; "Open" | ground, `--w-on-ground`, accent |
| Message | The world's **signature scene** plays with the sender's own words on its card | the whole composition |
| — long message | The card keeps its beginning under a fade; when the scene is at rest the **letter** rises in the world's paper, ink and type (scrollable, with a scroll cue) | `messageLines` (per composition) decides; the letter keeps one trait of its world (ruled frame, cut-paper shadow, tilt, the point) |
| Photo / video | Framed as the composition frames media (`mediaFrame`) | vellum mount · cut-paper slip · deckle mount · full bleed · inset hairline · plain |
| Voice | The voice player on the world's card stock | card, ink |
| Ending | The world returns (the sender's words still on its card) and closes with its **finale**; the template's closing line takes the world's headline slot; replay | `spec.finale` (§3.2) |

The same world dresses the sender's path: the message step writes on the
world's card stock in its type and room; the desktop live preview and the
checkout thumbnail are the world with the sender's own words.

Contract kept: the beat sequence, every `data-testid`, `onBeatChange`,
`onContentPlayed` (analytics), `senderControls`/`senderBanner`. The world is
`aria-hidden`; every word in it is also real text (sealed opening line, a
screen-reader copy of a message on the card, the letter). Reduced motion:
no scenes; worlds, letter and beats fade in at rest.

Implementation notes: the stage is a size container (the world is sized
from the space between the chrome on every phone height), so the renderer
must have a definite height (`h-dvh`, or a flex child of the Preview layer).
Fit is measured in the world's own type against the composition's designed
capacity (`COMPOSITIONS[id].messageLines`), not against the card box — some
cards are sized by their content. A scene that never reports rest still
yields the letter after `sceneMs + 1.8 s`.

`spec.greeting` (v1 palette, entrance, particles) is now read only by
`ThemeSwatch` on the marketing page; it can be retired with that swatch.

### 3.2 Finales — how each world closes

A finale is an approved block (`FINALES` in `vocabulary.ts`) chosen by the
template (`spec.finale`). It is authored for the world it closes — it moves
that composition's own elements — so each finale lists the compositions it
can close and the schema rejects any other pairing; a custom spec can only
name an approved, compatible finale (no code, CSS or URLs).

| Finale | World | Gesture | Resting state (CSS) · reduced motion |
|---|---|---|---|
| `evening-falls` | Romantic / quiet-light | Dusk returns, the window light withdraws, the card keeps the last light while "With love" is inked | Dusk over the room, light withdrawn |
| `paper-encore` | Birthday / paper-party | The closing words drop in, the cut paper hops once, a cut-paper rosette snaps onto the card | The rosette on the card |
| `vellum-close` | Wedding / vellum | The closing line is printed, the vellum is drawn back over the card, the seal is pressed | The card under vellum, sealed |
| `afterglow` | Celebration / signal | Three small Starrs ignite in turn, then the Starr; rays redraw; the words come through the light | A warm glow remains |
| `gallery-doors` | Elegant / ink-and-stone | The graphite doors glide in and stop at the card's edges | The card framed between the doors |
| `full-stop` | Minimal / just-words | Label and rule withdraw; the point travels to the end of the message as its full stop (beneath a clamped letter) | Label and rule gone |

Mechanics: `ThemeWorld finale=…` holds the world at the rest its scene
left (`data-scene="finale-pending"`, finale rules inactive), then plays the
finale (`scenes/finales.ts`) to the finale's resting state, which is CSS
(`theme-world.css`, "Finales") — the single source of truth, read at both
ends by `settleIntoFinale` and shown directly under reduced motion. A
finale that needs artwork of its own registers it in
`components/themes/finale-layers.tsx` (the rosette). A closing line set in
a headline slot is fitted so its longest word never breaks (after the
world's face has loaded). `verify:templates` §6b checks compatibility,
motion, resting state and that the launch worlds close differently.

### Performance tiers (engineering-only)

| Tier | May use | Rules |
|---|---|---|
| **light** | CSS, static assets | Default for chrome and fallbacks |
| **rich** | + GSAP scene runtime, ≤ 200 KB footage played once | All six launch compositions |
| **immersive** | + Rive / WebGL (R3F, Paper Shaders) | Lazy, recipient-side first, must declare a `rich` fallback and pass a mid-Android budget (longest task < 100 ms, no dropped first frame) |

Tiers live on compositions (`COMPOSITIONS[id].tier`). Later the renderer can
step a template down a tier on `prefers-reduced-motion`, Save-Data, low
`deviceMemory`, or measured jank.

### Reduced motion

No scene runs; worlds show their rest state with a 240 ms opacity fade
(see motion language). Selection, saving and replay work identically.

## 4. Versioning

**Risk:** a greeting stores only `theme_id`. Redesigning Romantic would change
every Romantic greeting already sent — including ones a recipient has
already opened and loved.

**Model (implemented in code):** templates carry `version`; the catalogue keeps
every published and retired version; `getTemplate(id, version?)` returns an
exact version when asked and never substitutes a different one;
`getThemeConfig(key, version)` passes it through. Rules:

- A visible change to a **published** template = a new version file
  (`romantic.v2.ts`), old version kept (status `retired` once it may no
  longer be chosen, still renderable).
- Renderer contract changes bump `renderer` (currently `1`); a renderer
  must keep rendering every spec version it ever accepted, or the spec is
  migrated by a pure function under test.
- Compositions referenced by retired versions are not deleted.

**Persisted (migration 0017):** `greetings.theme_version` (int, not null,
default 1 — every greeting before it was made with version 1) is written at
creation and whenever the theme is chosen (`updateGreetingTheme`), and
freezes at activation (greetings are editable only while DRAFT). The
recipient loader returns it and `GreetingRenderer` / `ThemeWorld` /
`getThemeWorld` render that exact version, falling back to the latest only
if a version were ever missing from the catalogue. Tested in
`verify:payment-integrity` §12. For creator/custom templates (future),
snapshot the full validated spec onto the greeting at activation.

## 5. Create your own (future)

```
Sender intent ("anime-inspired romantic Tokyo night, sakura, purple neon")
→ Direction: 2–3 suggested specs to choose from (never a blank canvas)
→ Personalise: palette nudges, type pair, occasion copy
→ parseTemplateSpec(untrusted JSON)       ← the only gate
→ TemplateSpec (composition + skin from the approved vocabulary)
→ the same renderer as curated templates → Preview → Pay
```

- AI (or a creator tool) outputs **JSON naming approved ids and colour
  tokens** — never HTML, CSS or JS. `parseTemplateSpec` is strict: unknown
  keys, unknown blocks, `url()`, `var()`, `;`/`}` and non-colour values are
  rejected (`verify:templates` §8 exercises this with a composed "Sakura
  night" spec and injection attempts).
- What is expressible grows only as compositions and type pairs are added —
  a deliberate limit that keeps quality, performance, accessibility,
  moderation and versioning tractable.
- Copy for custom templates (opening/ending) will need a localised `copy`
  field validated for length and moderated; launch templates use messages.
- Contrast is checked at build time for studio templates; custom specs need
  the same check at parse time before they can be previewed (planned:
  move the contrast helpers from the verify script into the schema).

## 6. Creator marketplace (not built — not blocked)

`origin: "studio" | "creator" | "custom"`, `status`, `version` and
`pricing` already exist on the definition. A marketplace would add: a
`templates` table storing creator specs (JSON) + review state; moderation
(the spec is data, so review is of tokens + preview renders, not code);
revenue share — **a separate ledger, never mixed into partner commission
tables**. Licence rule: compositions and assets must be resale-safe
(Arsenal §1.4).

## 7. Audio (reserved)

`spec.audio` exists with only `"none"` implemented. Any future ambience:
licensed or original assets only (Arsenal §9), off by default, explicit
sender opt-in and recipient play control, no autoplay (browser policy), mute
always visible, paused on `visibilitychange`, never mixed with the sender's
own voice message (which stays a separate, primary control), and absent under
Save-Data.

## 8. Template library UX (scale path)

Launch: one curated collection of six — swipe gallery + six seals on phones,
list + stage on desktop. The model already supports more:

| Library size | Picker |
|---|---|
| ≤ 7 | Current design (seal row fits 320 px) |
| 8–20 | Collections as horizontal rows ("For love", "Celebrate", "Classic"), the gallery shows one collection at a time; seals replaced by a collection switcher |
| 20+ | Occasion-first entry ("What's the occasion?") → curated collection → gallery; search later; server sends only the chosen collection's resolved worlds (the catalogue stays server-side — today the six definitions ship in the route chunk, +2.2 kB gz) |
| Any | "Create your own" as the last card of a collection, never the first |

## 9. Known gaps & next steps

1. ~~Picked ≠ received~~ — done (§3.1); per-world finales — done (§3.2).
   The Theme Picker / Recipient Worlds design phase is closed (2026-10-06).
2. ~~Persist `theme_version`~~ — done (§4, migration 0017).
3. Move room-contrast validation into `parseTemplateSpec` (§5).
4. Retire the stale `themes.config` jsonb seed values (harmless; unused).
5. Server-side catalogue once the library passes ~20 templates (§8).
