"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { directionsUrl, distanceKm, normalizeSearch, type LocationCategory, type PublicLocation } from "@/lib/partner-locations/shared";
import { MAP_ATTRIBUTION } from "@/components/maps/load-maplibre";
import type { LocationsLabels } from "./labels";
import { useLocationsMap } from "./use-locations-map";

type Props = { locations: PublicLocation[]; labels: LocationsLabels; locale: string };

function haystack(l: PublicLocation, labels: LocationsLabels) {
  return normalizeSearch([l.partnerName, l.branchName, l.city, l.district, l.address, labels.categories[l.category]].filter(Boolean).join(" "));
}

/**
 * "Where to find QR STARR": search, shop-type filters, a list that is always
 * there (server-rendered, keyboard and screen-reader friendly) and a lazily
 * loaded map kept in sync with it. Selecting in either one highlights the
 * other. "Near me" sorts by distance using the browser's location, which is
 * computed on the device and never sent to QR STARR or anyone else.
 */
export function LocationsExplorer({ locations, labels, locale }: Props) {
  const ids = useId();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<LocationCategory | "ALL">("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusSelected, setFocusSelected] = useState(0);
  const [user, setUser] = useState<{ lat: number; lng: number } | null>(null);
  const [geo, setGeo] = useState<"idle" | "locating" | "failed">("idle");
  const [mapWanted, setMapWanted] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const mapBoxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [saveData, setSaveData] = useState(false);

  const categories = useMemo(() => {
    const present = new Set(locations.map((l) => l.category));
    return (Object.keys(labels.categories) as LocationCategory[]).filter((c) => present.has(c));
  }, [locations, labels.categories]);

  const index = useMemo(() => new Map(locations.map((l) => [l.id, haystack(l, labels)])), [locations, labels]);

  const visible = useMemo(() => {
    const terms = normalizeSearch(query).split(" ").filter(Boolean);
    const list = locations.filter((l) => (category === "ALL" || l.category === category) && terms.every((t) => index.get(l.id)!.includes(t)));
    if (!user) return list.map((l) => ({ l, km: null as number | null }));
    return list
      .map((l) => ({ l, km: distanceKm(user, { lat: l.latitude, lng: l.longitude }) }))
      .sort((a, b) => a.km - b.km);
  }, [locations, category, query, index, user]);

  const visibleIds = useMemo(() => new Set(visible.map((v) => v.l.id)), [visible]);

  // Load the map when the section comes near the viewport — unless the
  // visitor asked to save data, in which case it waits for a tap.
  useEffect(() => {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) {
      setSaveData(true);
      return;
    }
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setMapWanted(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setMapWanted(true);
          io.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const select = (id: string, from: "map" | "list") => {
    setSelectedId(id);
    if (from === "list") {
      setFocusSelected((n) => n + 1);
      if (window.matchMedia("(max-width: 55.99rem)").matches) mapBoxRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } else {
      const card = listRef.current?.querySelector<HTMLElement>(`[data-location-id="${id}"]`);
      card?.scrollIntoView({ block: "nearest", inline: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  };

  const map = useLocationsMap({
    container: mapRef,
    enabled: mapWanted,
    locale,
    locations,
    visibleIds,
    selectedId,
    focusSelected,
    onSelect: (id) => select(id, "map"),
    user,
    labels,
  });

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setGeo("failed");
      return;
    }
    setGeo("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUser({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeo("idle");
      },
      () => setGeo("failed"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  };

  const count = visible.length;
  const countLabel = count === 1 ? labels.resultsOne : labels.results.replace("{count}", String(count));
  const filtered = query !== "" || category !== "ALL";

  return (
    <div ref={sectionRef} className="hm-loc" data-testid="locations-explorer">
      <div className="hm-loc__tools">
        <div className="hm-loc__search">
          <label htmlFor={`${ids}-q`} className="hm-loc__label">
            {labels.searchLabel}
          </label>
          <div className="hm-loc__field">
            <svg className="hm-loc__field-icon" viewBox="0 0 20 20" aria-hidden>
              <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="m13.2 13.2 3.6 3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <input
              id={`${ids}-q`}
              type="search"
              inputMode="search"
              autoComplete="off"
              enterKeyHint="search"
              placeholder={labels.searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="locations-search"
            />
          </div>
        </div>
        <div className="hm-loc__row">
          {categories.length > 1 && (
            <div className="hm-loc__chips" role="group" aria-label={labels.filterLabel}>
              {(["ALL", ...categories] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  className="hm-loc__chip"
                  aria-pressed={category === c}
                  onClick={() => setCategory(c)}
                  data-testid={`locations-filter-${c}`}
                >
                  {c === "ALL" ? labels.all : labels.categories[c]}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="hm-loc__near"
            aria-pressed={user !== null}
            onClick={() => (user ? setUser(null) : locate())}
            disabled={geo === "locating"}
            data-testid="locations-near-me"
          >
            <svg viewBox="0 0 20 20" aria-hidden>
              <path d="M17 3 3 9.2l5.8 2 2 5.8z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
            {geo === "locating" ? labels.locating : user ? labels.nearMeActive : labels.nearMe}
          </button>
        </div>
        <p className="hm-loc__status" aria-live="polite" data-testid="locations-count">
          {countLabel}
          {geo === "failed" && <span className="hm-loc__warn"> · {labels.locationFailed}</span>}
          {user && <span className="hm-loc__muted"> · {labels.locationPrivacy}</span>}
        </p>
      </div>

      <div className="hm-loc__body">
        <div ref={mapBoxRef} className="hm-loc__mapbox" data-status={map.status}>
          <div ref={mapRef} className="hm-loc__map" data-testid="locations-map" />
          {map.status !== "ready" && (
            <div className="hm-loc__veil">
              {map.status === "error" ? (
                <p>{labels.mapUnavailable}</p>
              ) : saveData && !mapWanted ? (
                <button type="button" className="hm-btn hm-btn--primary" onClick={() => setMapWanted(true)}>
                  {labels.loadMap}
                </button>
              ) : (
                <p className="hm-loc__loading">{labels.mapLoading}</p>
              )}
            </div>
          )}
          {map.status === "ready" && (
            <div className="hm-loc__controls">
              <button type="button" onClick={map.zoomIn} aria-label={labels.zoomIn} data-testid="locations-zoom-in">
                <svg viewBox="0 0 20 20" aria-hidden>
                  <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              </button>
              <button type="button" onClick={map.zoomOut} aria-label={labels.zoomOut} data-testid="locations-zoom-out">
                <svg viewBox="0 0 20 20" aria-hidden>
                  <path d="M4 10h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              </button>
              <button type="button" onClick={map.showAll} aria-label={labels.showAll} data-testid="locations-show-all">
                <svg viewBox="0 0 20 20" aria-hidden>
                  <path d="M3.5 7.5v-4h4M16.5 7.5v-4h-4M3.5 12.5v4h4M16.5 12.5v4h-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          )}
          <p className="hm-loc__attrib">
            {MAP_ATTRIBUTION.map((a, i) => (
              <span key={a.href}>
                {i > 0 && " · "}
                <a href={a.href} target="_blank" rel="noopener noreferrer">
                  {a.label}
                </a>
              </span>
            ))}
          </p>
        </div>

        <ul ref={listRef} className="hm-loc__list" aria-label={labels.listLabel} data-testid="locations-list">
          {visible.map(({ l, km }) => {
            const selected = l.id === selectedId;
            return (
              <li key={l.id} data-location-id={l.id} className="hm-loc__item" data-selected={selected || undefined} data-testid="locations-item">
                <article className="hm-loc-card" aria-current={selected ? "true" : undefined}>
                  <div className="hm-loc-card__top">
                    <p className="hm-loc-card__cat">{labels.categories[l.category]}</p>
                    {l.isMock && (
                      <span className="hm-loc-card__test" data-testid="locations-test-badge">
                        {labels.testBadge}
                      </span>
                    )}
                  </div>
                  <h3 className="hm-loc-card__name">
                    {l.partnerName}
                    {l.branchName && <span className="hm-loc-card__branch">{l.branchName}</span>}
                  </h3>
                  <p className="hm-loc-card__addr">
                    {l.address}
                    <span className="hm-loc-card__area">{[l.district, l.city].filter(Boolean).join(", ")}</span>
                  </p>
                  {l.hours && (
                    <p className="hm-loc-card__meta">
                      <span className="sr-only">{labels.hours}: </span>
                      {l.hours}
                    </p>
                  )}
                  <div className="hm-loc-card__flags">
                    {(l.availability === "AVAILABLE" || l.availability === "OUT") && (
                      <span className={`hm-loc-card__stock hm-loc-card__stock--${l.availability.toLowerCase()}`} data-testid="locations-availability">
                        {labels.availability[l.availability]}
                      </span>
                    )}
                    {km !== null && <span className="hm-loc-card__km">{labels.distance.replace("{km}", km < 10 ? km.toFixed(1) : String(Math.round(km)))}</span>}
                  </div>
                  <div className="hm-loc-card__actions">
                    <a
                      href={directionsUrl(l.latitude, l.longitude)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hm-loc-card__go"
                      data-testid="locations-directions"
                    >
                      {labels.directions}
                      <span className="sr-only"> {labels.opensInMaps}</span>
                      <svg viewBox="0 0 20 20" aria-hidden>
                        <path d="M7 13 13 7M8 7h5v5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </a>
                    <button type="button" className="hm-loc-card__show" onClick={() => select(l.id, "list")} aria-pressed={selected} data-testid="locations-show-on-map">
                      {labels.showOnMap}
                    </button>
                    {l.phone && (
                      <a href={`tel:${l.phone.replace(/[^\d+]/g, "")}`} className="hm-loc-card__show">
                        {labels.call}
                      </a>
                    )}
                  </div>
                </article>
              </li>
            );
          })}
          {count === 0 && (
            <li className="hm-loc__empty" data-testid="locations-empty">
              <p>{labels.noResults}</p>
              {filtered && (
                <button
                  type="button"
                  className="hm-link"
                  onClick={() => {
                    setQuery("");
                    setCategory("ALL");
                  }}
                >
                  {labels.clear}
                </button>
              )}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
