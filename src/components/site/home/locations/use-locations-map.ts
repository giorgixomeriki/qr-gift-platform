"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MlMap, Marker as MlMarker } from "maplibre-gl";
import { loadMapLibre, supportsWebGL } from "@/components/maps/load-maplibre";
import { buildMapStyle } from "@/components/maps/map-style";
import type { PublicLocation } from "@/lib/partner-locations/shared";
import type { LocationsLabels } from "./labels";

export type MapStatus = "idle" | "loading" | "ready" | "error";

/** Tbilisi — the first frame before the pins are fitted. */
const START: [number, number] = [44.793, 41.715];
/** Georgia plus a margin: the map never wanders off to the rest of the world. */
const MAX_BOUNDS: [[number, number], [number, number]] = [
  [38.8, 40.4],
  [47.6, 44.2],
];

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function pinElement(location: PublicLocation, onSelect: (id: string) => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "hm-loc-pin";
  el.dataset.id = location.id;
  el.dataset.testid = "locations-pin";
  el.setAttribute("aria-label", location.branchName ? `${location.partnerName} — ${location.branchName}` : location.partnerName);
  el.setAttribute("aria-pressed", "false");
  el.innerHTML = '<span class="hm-loc-pin__head" aria-hidden="true"><span class="hm-loc-pin__dot"></span></span>';
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onSelect(location.id);
  });
  return el;
}

/**
 * The interactive map behind the location list. MapLibre is fetched only
 * once `enabled` turns true (the section is near the viewport, or the
 * visitor asked for it), so the home page's first load never pays for it.
 * Every pin is a real <button>; the list next to it stays the primary,
 * fully accessible way to browse.
 */
export function useLocationsMap(opts: {
  container: React.RefObject<HTMLDivElement | null>;
  enabled: boolean;
  locale: string;
  locations: PublicLocation[];
  visibleIds: Set<string>;
  selectedId: string | null;
  focusSelected: number;
  onSelect: (id: string) => void;
  user: { lat: number; lng: number } | null;
  labels: LocationsLabels;
}) {
  const { container, enabled, locale, locations, visibleIds, selectedId, focusSelected, onSelect, user, labels } = opts;
  const [status, setStatus] = useState<MapStatus>("idle");
  const mapRef = useRef<MlMap | null>(null);
  const markersRef = useRef<Map<string, { marker: MlMarker; el: HTMLButtonElement }>>(new Map());
  const userMarkerRef = useRef<MlMarker | null>(null);
  const libRef = useRef<typeof import("maplibre-gl") | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Create the map once.
  useEffect(() => {
    if (!enabled || mapRef.current || !container.current) return;
    if (!supportsWebGL()) {
      setStatus("error");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    loadMapLibre()
      .then((lib) => {
        if (cancelled || !container.current) return;
        libRef.current = lib;
        const map = new lib.Map({
          container: container.current,
          style: buildMapStyle(locale),
          center: START,
          zoom: 11,
          minZoom: 6,
          maxZoom: 18,
          maxBounds: MAX_BOUNDS,
          attributionControl: false,
          cooperativeGestures: true,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          renderWorldCopies: false,
          fadeDuration: 150,
          locale: {
            "CooperativeGesturesHandler.MobileHelpText": labels.gestureMobile,
            "CooperativeGesturesHandler.WindowsHelpText": labels.gestureWindows,
            "CooperativeGesturesHandler.MacHelpText": labels.gestureMac,
          },
        });
        map.touchZoomRotate.disableRotation();
        map.keyboard.disableRotation();
        map.getCanvas().setAttribute("aria-label", labels.mapLabel);
        map.getCanvas().setAttribute("role", "img");
        mapRef.current = map;
        for (const location of locations) {
          const el = pinElement(location, (id) => onSelectRef.current(id));
          const marker = new lib.Marker({ element: el, anchor: "bottom" }).setLngLat([location.longitude, location.latitude]).addTo(map);
          markersRef.current.set(location.id, { marker, el });
        }
        map.once("load", () => {
          if (!cancelled) setStatus("ready");
        });
        map.on("error", (e) => {
          // A missing tile is not fatal; a style that never loads is.
          if (!map.isStyleLoaded() && !map.loaded()) console.warn("[partner-map]", e.error?.message);
        });
      })
      .catch((err) => {
        console.warn("[partner-map] could not load", err);
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
    // The map is created once; later prop changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
      markersRef.current.clear();
    },
    [],
  );

  const fitTo = useCallback((ids: Set<string>, animate: boolean) => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib) return;
    const points = locations.filter((l) => ids.has(l.id));
    if (points.length === 0) return;
    const duration = animate && !reducedMotion() ? 700 : 0;
    if (points.length === 1) {
      map.easeTo({ center: [points[0]!.longitude, points[0]!.latitude], zoom: 15, duration });
      return;
    }
    const bounds = new lib.LngLatBounds();
    for (const p of points) bounds.extend([p.longitude, p.latitude]);
    map.fitBounds(bounds, { padding: { top: 56, bottom: 56, left: 48, right: 48 }, maxZoom: 15, duration });
  }, [locations]);

  // Filtered set: hide pins that are filtered out and frame the rest.
  // First frame: the city with the most shops (the list is already ordered
  // that way), so a dense city's pins don't stack at country zoom. Every later
  // search/filter frames exactly what is listed; "show all" frames everything.
  const visibleKey = [...visibleIds].sort().join(",");
  const firstFit = useRef(true);
  useEffect(() => {
    if (status !== "ready") return;
    for (const [id, { el }] of markersRef.current) el.hidden = !visibleIds.has(id);
    if (firstFit.current && visibleIds.size === locations.length && locations.length > 0) {
      firstFit.current = false;
      const topCity = locations[0]!.city;
      fitTo(new Set(locations.filter((l) => l.city === topCity).map((l) => l.id)), false);
      return;
    }
    firstFit.current = false;
    fitTo(visibleIds, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, visibleKey]);

  // Selection: highlight the pin; fly to it when the list asked for it.
  useEffect(() => {
    if (status !== "ready") return;
    for (const [id, { el }] of markersRef.current) {
      const on = id === selectedId;
      el.classList.toggle("is-selected", on);
      el.setAttribute("aria-pressed", String(on));
      el.style.zIndex = on ? "2" : "";
    }
  }, [status, selectedId]);

  useEffect(() => {
    if (status !== "ready" || !selectedId || focusSelected === 0) return;
    const target = locations.find((l) => l.id === selectedId);
    const map = mapRef.current;
    if (!target || !map) return;
    const duration = reducedMotion() ? 0 : 800;
    map.easeTo({ center: [target.longitude, target.latitude], zoom: Math.max(map.getZoom(), 15), duration });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, focusSelected]);

  // The visitor's own position (never sent anywhere).
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (status !== "ready" || !map || !lib) return;
    userMarkerRef.current?.remove();
    userMarkerRef.current = null;
    if (!user) return;
    const el = document.createElement("span");
    el.className = "hm-loc-you";
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", labels.you);
    userMarkerRef.current = new lib.Marker({ element: el }).setLngLat([user.lng, user.lat]).addTo(map);
  }, [status, user, labels.you]);

  const zoomIn = useCallback(() => mapRef.current?.zoomIn({ duration: reducedMotion() ? 0 : 250 }), []);
  const zoomOut = useCallback(() => mapRef.current?.zoomOut({ duration: reducedMotion() ? 0 : 250 }), []);
  const showAll = useCallback(() => fitTo(visibleIds, true), [fitTo, visibleIds]);

  return { status, zoomIn, zoomOut, showAll };
}
