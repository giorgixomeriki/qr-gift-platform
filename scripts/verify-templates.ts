import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { COLLECTIONS, DEFAULT_TEMPLATE_ID, getCollection, getTemplate, restAssets, TEMPLATES } from "../src/lib/templates/catalog";
import { roomCss } from "../src/lib/templates/room";
import { isSafePaint, parseTemplateSpec, templateDefinitionSchema, type TemplateSpec } from "../src/lib/templates/schema";
import { ASSETS, COMPOSITION_IDS, FINALE_IDS, FINALES, finaleFits, ROOM_TEXTURES, TYPE_PAIRS } from "../src/lib/templates/vocabulary";
import { getThemeConfig, isThemeKey } from "../src/lib/themes/registry";
import { getThemeWorld } from "../src/lib/themes/worlds";
import { SCENES } from "../src/components/themes/scenes/scenes";
import { FINALE_SCENES } from "../src/components/themes/scenes/finales";
import { FINALE_LAYERS } from "../src/components/themes/finale-layers";

/**
 * Theme Experience Engine invariants (docs/design/THEME-ENGINE.md). No
 * browser, no app server; the database check runs when local Supabase is up.
 *
 *  1. Every template definition is valid against the schema; ids/versions unique.
 *  2. Lookup and versioning: latest published by default, exact versions on request,
 *     unknown ids fall back to the default without throwing.
 *  3. Collections name published templates; the default is in the launch collection.
 *  4. Copy: every published template has its strings in EN and KA.
 *  5. Assets: every asset, font file and room texture referenced exists in public/.
 *  6. Every composition has a scene, world CSS, a seal and an arrival.
 *  7. Rooms: chrome ink meets 4.5:1 on every room; the generated CSS is inert.
 *  8. Custom-builder boundary: a spec composed from approved blocks is accepted
 *     and renders; code, URLs, unknown blocks and extra keys are rejected.
 *  6b. Finales: every template closes with a finale authored for its composition;
 *     every finale has motion and a CSS resting state (shown under reduced
 *     motion); the six launch worlds close six different ways.
 *  9. Database: every published template has a `themes` row (greetings reference it).
 */

const ROOT = path.resolve(__dirname, "..");
let failures = 0;
function check(ok: unknown, label: string) {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}`);
  }
}
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const publicFile = (href: string) => existsSync(path.join(ROOT, "public", href));

// --- 1 ---------------------------------------------------------------------
console.log("1. Definitions");
for (const t of TEMPLATES) {
  const r = templateDefinitionSchema.safeParse(t);
  check(r.success, `${t.id}@${t.version} is a valid TemplateDefinition${r.success ? "" : `: ${r.error.message}`}`);
}
const keys = TEMPLATES.map((t) => `${t.id}@${t.version}`);
check(new Set(keys).size === keys.length, "id@version pairs are unique");

// --- 2 ---------------------------------------------------------------------
console.log("2. Lookup and versioning");
check(getTemplate("romantic")?.version === 1, "latest published Romantic resolves");
check(getTemplate("romantic", 1)?.id === "romantic", "an exact recorded version resolves");
check(getTemplate("romantic", 99) === undefined, "an unknown version is not silently substituted");
check(getTemplate("no-such-template") === undefined && !isThemeKey("no-such-template"), "unknown ids are not selectable");
check(getThemeConfig("no-such-template").key === DEFAULT_TEMPLATE_ID, "the renderer falls back to the default template for unknown ids");
check(getThemeWorld("no-such-template").key === DEFAULT_TEMPLATE_ID, "worlds fall back to the default template for unknown ids");

// --- 3 ---------------------------------------------------------------------
console.log("3. Collections");
for (const [id, c] of Object.entries(COLLECTIONS)) {
  check(c.templateIds.every((tid) => getTemplate(tid)?.status === "published"), `collection "${id}" names only published templates`);
  check(new Set(c.templateIds).size === c.templateIds.length, `collection "${id}" has no duplicates`);
}
check(getCollection("launch").some((t) => t.id === DEFAULT_TEMPLATE_ID), "the default template is in the launch collection");

// --- 4 ---------------------------------------------------------------------
console.log("4. Copy (EN, KA)");
const published = [...new Set(TEMPLATES.filter((t) => t.status === "published").map((t) => t.id))];
for (const locale of ["en", "ka"]) {
  const messages = JSON.parse(read(`src/messages/${locale}.json`)) as { themes: Record<string, Record<string, string>> };
  for (const id of published) {
    const copy = messages.themes[id] ?? {};
    // `ending` may be deliberately empty (Minimal closes on the words alone), but must exist.
    const missing = [...["name", "tagline", "opening", "sample"].filter((k) => !copy[k]?.trim()), ...(typeof copy.ending === "string" ? [] : ["ending"])];
    check(missing.length === 0, `${locale}: themes.${id} complete${missing.length ? ` (missing ${missing.join(", ")})` : ""}`);
  }
}

// --- 5 ---------------------------------------------------------------------
console.log("5. Assets");
for (const [id, a] of Object.entries(ASSETS)) check(publicFile(a.href), `asset ${id} → ${a.href}`);
for (const [id, p] of Object.entries(TYPE_PAIRS)) check(publicFile(p.files.latin) && publicFile(p.files.georgian), `type pair ${id} font files`);
for (const [id, css] of Object.entries(ROOM_TEXTURES)) {
  const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]!);
  check(urls.every(publicFile), `room texture ${id}${urls.length ? ` (${urls.join(", ")})` : ""}`);
}
for (const t of TEMPLATES) check(restAssets(t).every(({ asset }) => publicFile(asset.href)), `${t.id}: rest assets exist`);

// --- 6 ---------------------------------------------------------------------
console.log("6. Compositions");
const worldCss = read("src/components/themes/theme-world.css");
const pickerCss = read("src/components/greeting/theme-picker.css");
for (const c of COMPOSITION_IDS) {
  check(typeof SCENES[c] === "function", `${c}: signature scene`);
  check(worldCss.includes(`.tw--${c} `), `${c}: world CSS`);
  check(worldCss.includes(`.tw-seal--${c}`) || pickerCss.includes(`.tw-seal--${c}`), `${c}: seal`);
  check(pickerCss.includes(`[data-enter="${c}"]`), `${c}: arrival grammar`);
}
check(!/data-world="[a-z]/.test(pickerCss), "picker CSS names no template ids (rooms are generated)");

console.log("6b. Finales");
for (const f of FINALE_IDS) {
  check(typeof FINALE_SCENES[f] === "function", `${f}: finale motion`);
  check(worldCss.includes(`[data-finale="${f}"]`) || FINALE_LAYERS[f] !== undefined, `${f}: resting state (CSS rule or finale artwork)`);
}
for (const t of TEMPLATES) check(finaleFits(t.spec.finale, t.spec.composition), `${t.id}: finale "${t.spec.finale}" is authored for ${t.spec.composition}`);
const launchFinales = getCollection("launch").map((t) => t.spec.finale);
check(new Set(launchFinales).size === launchFinales.length, `the launch worlds close ${launchFinales.length} different ways (${launchFinales.join(", ")})`);
check(COMPOSITION_IDS.every((c) => FINALE_IDS.some((f) => (FINALES[f].compositions as readonly string[]).includes(c))), "every composition has at least one finale");

// --- 7 ---------------------------------------------------------------------
console.log("7. Rooms");
function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};
const lightInk = ["#f6efe7", "#dcd2c7", "#b9aea3"]; // theme-picker.css, dark rooms
const darkInk = ["#1d1916", "#5a514a", "#625952"]; // globals.css --ink / --ink-2; theme-picker.css light-room --ink-3
for (const t of getCollection("launch")) {
  const { base, dark } = t.spec.room;
  if (!base.startsWith("#") || base.length !== 7) {
    check(false, `${t.id}: room base must be #rrggbb to be checked`);
    continue;
  }
  const worst = Math.min(...(dark ? lightInk : darkInk).map((ink) => contrast(ink, base)));
  check(worst >= 4.5, `${t.id}: chrome ink on its ${dark ? "dark" : "light"} room ≥ 4.5:1 (worst ${worst.toFixed(2)})`);
}
const css = roomCss(TEMPLATES);
check(!/[<>"']\s*\/?script|javascript:|expression\(/i.test(css), "generated room CSS contains no script");
check([...css.matchAll(/url\(([^)]+)\)/g)].every((m) => publicFile(m[1]!)), "generated room CSS only references bundled textures");

// --- 8 ---------------------------------------------------------------------
console.log("8. Custom-builder boundary");
// "An anime-inspired romantic Tokyo night, sakura, dreamy, purple neon" — as a
// future builder would compose it: approved blocks, its own palette.
const sakuraNight: TemplateSpec = {
  ...getTemplate("romantic")!.spec,
  type: "letter-italic",
  palette: { ...getTemplate("romantic")!.spec.palette, ground: "#3a2550", groundDeep: "#1b1030", accent: "#f2b8d0", light: "#c9a6ff", onGround: "#f6eaff" },
  room: { base: "#1a1028", glow: "rgb(150 110 200 / 0.35)", texture: "linen", textureSize: 192, dark: true },
};
const ok = parseTemplateSpec(sakuraNight);
check(ok.success, "a spec composed from approved blocks is accepted");
check(ok.success && SCENES[ok.data.composition] !== undefined, "…and maps onto an existing composition and scene");
const reject = (label: string, spec: unknown) => check(!parseTemplateSpec(spec).success, `rejects ${label}`);
reject("an unknown composition", { ...sakuraNight, composition: "neon-tokyo" });
reject("an unknown type pair", { ...sakuraNight, type: "comic-sans" });
reject("extra keys (e.g. markup)", { ...sakuraNight, html: "<script>alert(1)</script>" });
reject("a colour that closes the declaration", { ...sakuraNight, palette: { ...sakuraNight.palette, ground: "#fff;}body{display:none" } });
reject("a url() paint", { ...sakuraNight, greeting: { ...sakuraNight.greeting, palette: { ...sakuraNight.greeting.palette, background: "url(https://evil.example/x.png)" } } });
reject("a var()/image() paint", { ...sakuraNight, greeting: { ...sakuraNight.greeting, palette: { ...sakuraNight.greeting.palette, liner: "image(var(--x))" } } });
reject("a named-colour room (unverifiable)", { ...sakuraNight, room: { ...sakuraNight.room, base: "red" } });
reject("audio that has no renderer", { ...sakuraNight, audio: "lofi-beats" });
reject("an unknown finale", { ...sakuraNight, finale: "fireworks" });
reject("a finale authored for another world", { ...sakuraNight, finale: "gallery-doors" });
check(isSafePaint("repeating-linear-gradient(45deg, rgb(111 139 105 / 0.55) 0 1px, transparent 1px 9px), #e6ecdf"), "real gradients are safe paints");
check(!isSafePaint("linear-gradient(red, blue); } * { color: red"), "a paint cannot break out of its declaration");

// --- 9 ---------------------------------------------------------------------
console.log("9. Database");
(async () => {
  const url = process.env.MIGRATIONS_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  const sql = postgres(url, { max: 1, connect_timeout: 3 });
  try {
    const rows = await sql<{ key: string; active: boolean }[]>`select key, active from themes`;
    const db = new Map(rows.map((r) => [r.key, r.active]));
    for (const id of published) check(db.get(id) === true, `themes row for ${id} (active)`);
  } catch (e) {
    console.log(`  – skipped (database unreachable: ${(e as Error).message})`);
  } finally {
    await sql.end({ timeout: 1 });
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll template checks passed.");
  process.exit(failures ? 1 : 0);
})();
