import type { CSSProperties } from "react";
import type { Room, TemplateDefinition } from "./schema";
import { ROOM_TEXTURES } from "./vocabulary";

/**
 * A template's room — the space around its world: Screen #2 takes it on
 * (the whole screen becomes the chosen world), and the recipient reveal is
 * set in it. Generated from each template's `room` tokens, so a new template
 * brings its own room without new stylesheet rules.
 *
 * Safe to inline: ids are slugs and every value is validated by the template
 * schema (colours only; textures are ids into ROOM_TEXTURES). The room's
 * chrome ink (light ink on dark rooms) is static CSS keyed on
 * `data-room="dark"` (theme-picker.css, reveal.css).
 */
function roomDeclarations(room: Room): [string, string][] {
  const size = room.textureSize ? `0 0 / ${room.textureSize}px ${room.textureSize}px` : "center / cover no-repeat";
  return [
    ["--room", room.base],
    ["--room-glow", `radial-gradient(ellipse 85% 55% at 50% 44%,${room.glow},transparent 72%)`],
    ["--room-tex", `${ROOM_TEXTURES[room.texture]} ${size}`],
    ...(room.blend ? ([["--room-blend", room.blend]] as [string, string][]) : []),
  ];
}

/** Screen #2: every template's room as CSS, rendered by the picker as an inline <style> (painted from the first frame, no JS). */
export function roomCss(templates: readonly TemplateDefinition[]): string {
  return templates
    .map(
      ({ id, spec: { room } }) =>
        `body:has(.tp[data-world="${id}"]),.tp-room__layer--${id}{` + roomDeclarations(room).map(([k, v]) => `${k}:${v};`).join("") + `}`,
    )
    .join("\n");
}

/** One room as custom properties on an element (the recipient reveal). */
export function roomVars(room: Room): CSSProperties {
  return Object.fromEntries(roomDeclarations(room)) as CSSProperties;
}
