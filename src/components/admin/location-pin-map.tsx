"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MlMap, Marker as MlMarker } from "maplibre-gl";
import { loadMapLibre, MAP_ATTRIBUTION, supportsWebGL } from "@/components/maps/load-maplibre";
import { buildMapStyle } from "@/components/maps/map-style";
// Admin-only page: the full MapLibre stylesheet (draggable default marker) is fine here.
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * Admin pin preview: shows the coordinates being edited on the same basemap
 * the public page uses, with a draggable pin. Dragging writes the new
 * coordinates back through onMove (the form then requires re-verification,
 * enforced by the database trigger on save).
 */
export function LocationPinMap({
  latitude,
  longitude,
  onMove,
  label,
  unavailable,
  locale,
}: {
  latitude: number | null;
  longitude: number | null;
  onMove: (lat: number, lng: number) => void;
  label: string;
  unavailable: string;
  locale: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerRef = useRef<MlMarker | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!box.current) return;
    if (!supportsWebGL()) {
      setFailed(true);
      return;
    }
    let cancelled = false;
    loadMapLibre()
      .then((lib) => {
        if (cancelled || !box.current) return;
        const center: [number, number] = latitude !== null && longitude !== null ? [longitude, latitude] : [44.793, 41.715];
        const map = new lib.Map({
          container: box.current,
          style: buildMapStyle(locale),
          center,
          zoom: latitude !== null ? 16 : 11,
          attributionControl: false,
          dragRotate: false,
          touchPitch: false,
        });
        map.touchZoomRotate.disableRotation();
        map.getCanvas().setAttribute("aria-label", label);
        mapRef.current = map;
        const marker = new lib.Marker({ draggable: true, color: "#5e1f33" }).setLngLat(center).addTo(map);
        marker.on("dragend", () => {
          const p = marker.getLngLat();
          onMoveRef.current(Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6)));
        });
        markerRef.current = marker;
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Created once per mount; coordinate changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (latitude === null || longitude === null) return;
    markerRef.current?.setLngLat([longitude, latitude]);
    mapRef.current?.easeTo({ center: [longitude, latitude], duration: 300 });
  }, [latitude, longitude]);

  if (failed) return <p className="text-caption text-ink-3">{unavailable}</p>;
  return (
    <div className="flex flex-col gap-1">
      <div ref={box} className="relative h-64 overflow-hidden rounded-md bg-sunken ring-1 ring-line ring-inset" data-testid="location-pin-map" />
      <p className="text-[0.6875rem] text-ink-3">
        {MAP_ATTRIBUTION.map((a, i) => (
          <span key={a.href}>
            {i > 0 && " · "}
            <a href={a.href} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {a.label}
            </a>
          </span>
        ))}
      </p>
    </div>
  );
}
