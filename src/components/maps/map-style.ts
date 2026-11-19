import type { StyleSpecification, ExpressionSpecification } from "maplibre-gl";

/**
 * QR STARR's own basemap: OpenMapTiles vector data served by OpenFreeMap
 * (https://openfreemap.org — free, no API key, commercial use allowed, no
 * view limits; attribution required: OpenFreeMap, OpenMapTiles,
 * OpenStreetMap contributors). Only the layers a shop-finder needs, painted
 * in the home page's ivory / wine / warm-neutral palette (home.css --hm-*).
 * No sprite: the style draws no icons, so no sprite request is made.
 *
 * Labels follow the page language: Georgian names (name:ka, then the local
 * name) or English (name:en, then the Latin transliteration). OpenFreeMap's
 * Noto Sans glyph ranges include Georgian script.
 */
export const TILE_ORIGIN = "https://tiles.openfreemap.org";

const C = {
  paper: "#f4ede3",
  land2: "#efe6d9",
  park: "#e4e3cf",
  wood: "#dfe0c9",
  water: "#d5dee0",
  waterLine: "#c3cfd2",
  building: "#e9dfd1",
  buildingLine: "#ddcfbd",
  road: "#fffaf3",
  roadCasing: "#e3d7c6",
  major: "#fbf1e4",
  majorCasing: "#d9c8b2",
  motorway: "#f6e3d3",
  motorwayCasing: "#cfb39c",
  rail: "#d3c5b3",
  border: "#b79aa2",
  label: "#5d4f47",
  labelStrong: "#2a201c",
  labelWater: "#6d8288",
  halo: "#fbf7f0",
};

function nameExpr(locale: string): ExpressionSpecification {
  return locale === "en"
    ? ["coalesce", ["get", "name:en"], ["get", "name:latin"], ["get", "name"]]
    : ["coalesce", ["get", "name:ka"], ["get", "name"]];
}

const width = (stops: [number, number][]): ExpressionSpecification => ["interpolate", ["exponential", 1.4], ["zoom"], ...stops.flat()];

export function buildMapStyle(locale: string): StyleSpecification {
  const name = nameExpr(locale);
  return {
    version: 8,
    glyphs: `${TILE_ORIGIN}/fonts/{fontstack}/{range}.pbf`,
    sources: {
      omt: { type: "vector", url: `${TILE_ORIGIN}/planet` },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": C.paper } },
      { id: "residential", type: "fill", source: "omt", "source-layer": "landuse", filter: ["in", ["get", "class"], ["literal", ["residential", "suburb", "neighbourhood"]]], paint: { "fill-color": C.land2, "fill-opacity": 0.6 } },
      { id: "wood", type: "fill", source: "omt", "source-layer": "landcover", filter: ["in", ["get", "class"], ["literal", ["wood", "forest", "grass"]]], paint: { "fill-color": C.wood, "fill-opacity": 0.7 } },
      { id: "park", type: "fill", source: "omt", "source-layer": "park", paint: { "fill-color": C.park, "fill-opacity": 0.85 } },
      { id: "water", type: "fill", source: "omt", "source-layer": "water", paint: { "fill-color": C.water } },
      { id: "waterway", type: "line", source: "omt", "source-layer": "waterway", paint: { "line-color": C.waterLine, "line-width": width([[8, 0.5], [16, 3]]) } },
      { id: "building", type: "fill", source: "omt", "source-layer": "building", minzoom: 14, paint: { "fill-color": C.building, "fill-outline-color": C.buildingLine } },
      {
        id: "road-minor",
        type: "line",
        source: "omt",
        "source-layer": "transportation",
        minzoom: 12,
        filter: ["in", ["get", "class"], ["literal", ["minor", "service", "track"]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": C.road, "line-width": width([[12, 0.5], [14, 2], [18, 12]]) },
      },
      {
        id: "road-major-casing",
        type: "line",
        source: "omt",
        "source-layer": "transportation",
        minzoom: 8,
        filter: ["in", ["get", "class"], ["literal", ["primary", "secondary", "tertiary", "trunk"]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": C.majorCasing, "line-width": width([[8, 0.8], [12, 2.5], [18, 22]]) },
      },
      {
        id: "road-major",
        type: "line",
        source: "omt",
        "source-layer": "transportation",
        minzoom: 8,
        filter: ["in", ["get", "class"], ["literal", ["primary", "secondary", "tertiary", "trunk"]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": C.major, "line-width": width([[8, 0.4], [12, 1.6], [18, 18]]) },
      },
      {
        id: "road-motorway-casing",
        type: "line",
        source: "omt",
        "source-layer": "transportation",
        minzoom: 5,
        filter: ["==", ["get", "class"], "motorway"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": C.motorwayCasing, "line-width": width([[5, 0.6], [12, 3], [18, 24]]) },
      },
      {
        id: "road-motorway",
        type: "line",
        source: "omt",
        "source-layer": "transportation",
        minzoom: 5,
        filter: ["==", ["get", "class"], "motorway"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": C.motorway, "line-width": width([[5, 0.4], [12, 2], [18, 20]]) },
      },
      { id: "rail", type: "line", source: "omt", "source-layer": "transportation", minzoom: 11, filter: ["in", ["get", "class"], ["literal", ["rail", "transit"]]], paint: { "line-color": C.rail, "line-width": 1, "line-dasharray": [3, 3] } },
      { id: "border", type: "line", source: "omt", "source-layer": "boundary", filter: ["==", ["get", "admin_level"], 2], paint: { "line-color": C.border, "line-width": 1.2, "line-dasharray": [4, 2] } },
      {
        id: "water-name",
        type: "symbol",
        source: "omt",
        "source-layer": "water_name",
        layout: { "text-field": name, "text-font": ["Noto Sans Italic"], "text-size": 12, "symbol-placement": "point" },
        paint: { "text-color": C.labelWater, "text-halo-color": C.halo, "text-halo-width": 1.2 },
      },
      {
        id: "street-name",
        type: "symbol",
        source: "omt",
        "source-layer": "transportation_name",
        minzoom: 14,
        layout: { "text-field": name, "text-font": ["Noto Sans Regular"], "text-size": 11.5, "symbol-placement": "line", "text-max-angle": 30 },
        paint: { "text-color": C.label, "text-halo-color": C.halo, "text-halo-width": 1.4 },
      },
      {
        id: "place-minor",
        type: "symbol",
        source: "omt",
        "source-layer": "place",
        minzoom: 11,
        filter: ["in", ["get", "class"], ["literal", ["suburb", "quarter", "neighbourhood", "village", "hamlet"]]],
        layout: { "text-field": name, "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 11, 11, 15, 13], "text-max-width": 8, "text-letter-spacing": 0.04 },
        paint: { "text-color": C.label, "text-halo-color": C.halo, "text-halo-width": 1.5 },
      },
      {
        id: "place-town",
        type: "symbol",
        source: "omt",
        "source-layer": "place",
        filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
        layout: { "text-field": name, "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 5, 11, 12, 16], "text-max-width": 8 },
        paint: { "text-color": C.labelStrong, "text-halo-color": C.halo, "text-halo-width": 1.6 },
      },
    ],
  };
}
