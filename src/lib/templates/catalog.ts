import type { TemplateDefinition } from "./schema";
import { ASSETS, COMPOSITIONS, ROOM_TEXTURE_ASSETS, TYPE_PAIRS, type AssetId } from "./vocabulary";
import { birthday } from "./definitions/birthday";
import { celebration } from "./definitions/celebration";
import { elegant } from "./definitions/elegant";
import { minimal } from "./definitions/minimal";
import { romantic } from "./definitions/romantic";
import { wedding } from "./definitions/wedding";

/**
 * The template catalogue (docs/design/THEME-ENGINE.md).
 *
 * Every version of every template ever published stays here (retired ones
 * included): a greeting made with Romantic v1 must keep opening as v1 after
 * Romantic v2 ships. Adding a template = a definition file, an entry below,
 * its copy under `themes.<id>` in messages/{en,ka}.json, and a `themes` row
 * (src/db/seed.ts); `npm run verify:templates` checks all of it.
 */
export const TEMPLATES: readonly TemplateDefinition[] = [romantic, birthday, wedding, celebration, elegant, minimal];

/** Ids of the launch collection — also the type used where a launch template is named in code (tests, defaults). */
export type LaunchTemplateId = (typeof LAUNCH_ORDER)[number];

/**
 * Curated collections: what the picker shows, in order. The launch picker
 * shows one collection of six; larger libraries add collections (seasonal,
 * featured, by occasion) without touching the picker's model.
 * Order: the quiet default first (a new greeting starts on it, so the
 * gallery opens at its beginning), then the emotional worlds.
 */
const LAUNCH_ORDER = ["minimal", "romantic", "birthday", "wedding", "celebration", "elegant"] as const;
export const COLLECTIONS = {
  launch: { templateIds: LAUNCH_ORDER as readonly string[] },
} as const;
export type CollectionId = keyof typeof COLLECTIONS;

export const DEFAULT_TEMPLATE_ID: LaunchTemplateId = "minimal";

const byId = new Map<string, TemplateDefinition[]>();
for (const t of TEMPLATES) byId.set(t.id, [...(byId.get(t.id) ?? []), t].sort((a, b) => a.version - b.version));

/**
 * A template by id: a specific version when given (a greeting's recorded
 * version), else the latest published one. Undefined for unknown ids.
 */
export function getTemplate(id: string, version?: number): TemplateDefinition | undefined {
  const versions = byId.get(id);
  if (!versions) return undefined;
  if (version !== undefined) return versions.find((t) => t.version === version);
  return [...versions].reverse().find((t) => t.status === "published");
}

/** True for ids a sender may choose today (a published version exists). */
export function isSelectableTemplateId(id: string): boolean {
  return getTemplate(id) !== undefined;
}

export function getCollection(id: CollectionId): TemplateDefinition[] {
  return COLLECTIONS[id].templateIds.map((tid) => getTemplate(tid)!);
}

/** A template joined with the code-owned blocks it names — everything a renderer needs. */
export type ResolvedTemplate = TemplateDefinition & {
  composition: (typeof COMPOSITIONS)[keyof typeof COMPOSITIONS];
  typePair: (typeof TYPE_PAIRS)[keyof typeof TYPE_PAIRS];
};

export function resolveTemplate(t: TemplateDefinition): ResolvedTemplate {
  return { ...t, composition: COMPOSITIONS[t.spec.composition], typePair: TYPE_PAIRS[t.spec.type] };
}

/**
 * The chosen world's rest-state assets — its largest paint, discovered by the
 * browser only after CSS and layout, so worth requesting up front. Scene
 * footage is NOT here: it loads only when its scene plays.
 */
export function restAssets(t: TemplateDefinition): { asset: (typeof ASSETS)[AssetId]; high: boolean }[] {
  const world = new Set<AssetId>(["paper-tooth", ...COMPOSITIONS[t.spec.composition].preload]);
  const room = ROOM_TEXTURE_ASSETS[t.spec.room.texture];
  return [...[...world].map((id) => ({ asset: ASSETS[id], high: true })), ...(room && !world.has(room) ? [{ asset: ASSETS[room], high: false }] : [])];
}
