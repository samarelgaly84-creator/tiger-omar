import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ExternalLink, LocateFixed, Loader2, MapPin, Search, X } from 'lucide-react';
import {
  acquireCurrentLocationWithAddress,
  buildExternalOsmUrl,
  reverseGeocodeCoords,
} from '../lib/geolocation';
import { apiFetch } from '../lib/api';

export interface TigerMapMarker {
  id: string;
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;
  kind?: 'me' | 'place' | 'friend_place' | 'live' | 'picked';
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createTigerDivIcon(kind: TigerMapMarker['kind']) {
  const bg =
    kind === 'live'
      ? '#10b981'
      : kind === 'friend_place'
      ? '#3b82f6'
      : kind === 'me'
      ? '#09090b'
      : '#f97316';
  const ring = kind === 'me' ? '#f97316' : '#ffffff';
  const pulse =
    kind === 'live' || kind === 'me'
      ? '<span style="position:absolute;inset:-4px;border-radius:9999px;border:2px solid ' +
        bg +
        ';opacity:0.45;"></span>'
      : '';

  return L.divIcon({
    className: 'tiger-leaflet-marker',
    html: `<div style="position:relative;width:24px;height:24px;border-radius:9999px;background:${bg};border:3px solid ${ring};box-shadow:0 4px 12px rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;">${pulse}<span style="width:6px;height:6px;border-radius:9999px;background:#fff;"></span></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -14],
  });
}

export const TigerMapCanvas: React.FC<{
  center: [number, number];
  zoom?: number;
  markers?: TigerMapMarker[];
  interactive?: boolean;
  heightClass?: string;
  onMapClick?: (lat: number, lng: number) => void;
  onMarkerClick?: (marker: TigerMapMarker) => void;
}> = ({
  center,
  zoom = 13,
  markers = [],
  interactive = true,
  heightClass = 'h-64',
  onMapClick,
  onMarkerClick,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const onMapClickRef = useRef(onMapClick);
  const onMarkerClickRef = useRef(onMarkerClick);

  onMapClickRef.current = onMapClick;
  onMarkerClickRef.current = onMarkerClick;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, {
      center,
      zoom,
      zoomControl: interactive,
      dragging: interactive,
      scrollWheelZoom: interactive,
      doubleClickZoom: interactive,
      boxZoom: interactive,
      touchZoom: interactive,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerGroupRef.current = group;

    map.on('click', (e: L.LeafletMouseEvent) => {
      onMapClickRef.current?.(e.latlng.lat, e.latlng.lng);
    });

    // Ensure proper layout sizing inside modals or dynamic containers
    const timer = window.setTimeout(() => map.invalidateSize(), 120);

    return () => {
      window.clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setView(center, zoom, { animate: true });
    window.setTimeout(() => map.invalidateSize(), 80);
  }, [center[0], center[1], zoom]);

  useEffect(() => {
    const group = layerGroupRef.current;
    if (!group) return;
    group.clearLayers();

    for (const m of markers) {
      if (!Number.isFinite(m.lat) || !Number.isFinite(m.lng)) continue;
      const marker = L.marker([m.lat, m.lng], {
        icon: createTigerDivIcon(m.kind),
      });
      const popupHtml = `<div style="font-family:sans-serif;min-width:120px"><strong style="color:#09090b;font-size:12px">${escapeHtml(
        m.title
      )}</strong>${
        m.subtitle
          ? `<div style="color:#52525b;font-size:11px;margin-top:2px">${escapeHtml(m.subtitle)}</div>`
          : ''
      }</div>`;
      marker.bindPopup(popupHtml);
      marker.on('click', () => {
        onMarkerClickRef.current?.(m);
      });
      marker.addTo(group);
    }
  }, [markers]);

  return (
    <div
      ref={containerRef}
      className={`w-full ${heightClass} rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800 z-0`}
    />
  );
};

export const LocationPreviewModal: React.FC<{
  lat: number;
  lng: number;
  label: string;
  isLive?: boolean;
  stopped?: boolean;
  lang: 'ar' | 'en';
  onClose: () => void;
}> = ({ lat, lng, label, isLive, stopped, lang, onClose }) => {
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="max-w-lg w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 p-5 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <MapPin className="w-4 h-4 text-orange-500 shrink-0" />
            <h3 className="text-sm font-bold truncate">{label}</h3>
            {isLive && !stopped && (
              <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-500 text-[10px] font-bold">
                {lang === 'ar' ? 'مباشر' : 'LIVE'}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <TigerMapCanvas
          center={[lat, lng]}
          zoom={15}
          heightClass="h-72"
          markers={[
            {
              id: 'preview',
              lat,
              lng,
              title: label,
              subtitle: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
              kind: isLive && !stopped ? 'live' : 'picked',
            },
          ]}
        />

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-mono text-zinc-500 tabular-nums">
            {lat.toFixed(5)}, {lng.toFixed(5)}
          </span>
          <a
            href={buildExternalOsmUrl(lat, lng)}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold inline-flex items-center gap-1.5"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>{lang === 'ar' ? 'فتح في تطبيق الخرائط' : 'Open in Maps'}</span>
          </a>
        </div>
      </div>
    </div>
  );
};

export const LocationPickerModal: React.FC<{
  lang: 'ar' | 'en';
  initialLocation?: { lat: number; lng: number; label: string } | null;
  onSelect: (picked: { lat: number; lng: number; label: string }) => void;
  onClose: () => void;
}> = ({ lang, initialLocation, onSelect, onClose }) => {
  const [center, setCenter] = useState<[number, number]>(
    initialLocation ? [initialLocation.lat, initialLocation.lng] : [30.0444, 31.2357]
  );
  const [picked, setPicked] = useState<{ lat: number; lng: number; label: string } | null>(
    initialLocation || null
  );
  const [searchQ, setSearchQ] = useState('');
  const [results, setResults] = useState<Array<{ name: string; displayName: string; lat: number; lng: number }>>([]);
  const [locating, setLocating] = useState(false);
  const [searching, setSearching] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const handleUseMyLocation = async () => {
    setLocating(true);
    setErrMsg(null);
    try {
      const fix = await acquireCurrentLocationWithAddress(lang);
      setCenter([fix.lat, fix.lng]);
      setPicked({ lat: fix.lat, lng: fix.lng, label: fix.label });
    } catch (err: any) {
      setErrMsg(err?.message || 'Location error');
    } finally {
      setLocating(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQ.trim()) return;
    setSearching(true);
    setErrMsg(null);
    try {
      const res = await apiFetch<{ places: any[] }>(
        `/api/location/search?q=${encodeURIComponent(searchQ.trim())}&lang=${lang}`
      );
      setResults(res.places || []);
      if ((res.places || []).length === 0) {
        setErrMsg(lang === 'ar' ? 'لم يتم العثور على أماكن مطابقة.' : 'No matching places found.');
      }
    } catch (err: any) {
      setErrMsg(err?.message || 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const handleMapClick = async (lat: number, lng: number) => {
    const coordLabel = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    setPicked({ lat, lng, label: coordLabel });
    const geo = await reverseGeocodeCoords(lat, lng, lang);
    setPicked({ lat, lng, label: geo.label });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="max-w-xl w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 p-5 space-y-3 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <MapPin className="w-4 h-4 text-orange-500" />
            <span>{lang === 'ar' ? 'اختر موقعاً من الخريطة' : 'Pick Location from Map'}</span>
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="flex-1 min-w-[200px] flex gap-1.5">
            <input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleSearch()}
              placeholder={lang === 'ar' ? 'ابحث عن مدينة أو مكان...' : 'Search city or place...'}
              className="flex-1 px-3 py-2 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 focus:outline-none focus:border-orange-500"
            />
            <button
              type="button"
              onClick={() => void handleSearch()}
              disabled={searching}
              className="px-3 py-2 rounded-xl bg-zinc-200 dark:bg-zinc-800 text-xs font-semibold inline-flex items-center gap-1"
            >
              {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            </button>
          </div>
          <button
            type="button"
            onClick={() => void handleUseMyLocation()}
            disabled={locating}
            className="px-3 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold inline-flex items-center gap-1.5"
          >
            {locating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LocateFixed className="w-3.5 h-3.5" />}
            <span>{lang === 'ar' ? 'موقعي الحالي' : 'My Location'}</span>
          </button>
        </div>

        {results.length > 0 && (
          <div className="max-h-28 overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-800 text-xs">
            {results.map((r, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setCenter([r.lat, r.lng]);
                  setPicked({ lat: r.lat, lng: r.lng, label: r.displayName || r.name });
                  setResults([]);
                }}
                className="w-full text-start px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 truncate"
              >
                {r.displayName || r.name}
              </button>
            ))}
          </div>
        )}

        {errMsg && <p className="text-xs text-red-500">{errMsg}</p>}

        <TigerMapCanvas
          center={center}
          zoom={picked ? 14 : 6}
          heightClass="h-64"
          markers={
            picked
              ? [{ id: 'picked', lat: picked.lat, lng: picked.lng, title: picked.label, kind: 'picked' }]
              : []
          }
          onMapClick={(lat, lng) => void handleMapClick(lat, lng)}
        />

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="text-xs text-zinc-500 truncate max-w-xs">
            {picked
              ? `${picked.label} (${picked.lat.toFixed(4)}, ${picked.lng.toFixed(4)})`
              : lang === 'ar'
              ? 'اضغط على الخريطة لتحديد الموقع'
              : 'Click anywhere on the map to pick'}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-800 text-xs font-semibold"
            >
              {lang === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              type="button"
              disabled={!picked}
              onClick={() => {
                if (picked) onSelect(picked);
              }}
              className="px-4 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-semibold"
            >
              {lang === 'ar' ? 'تأكيد الموقع' : 'Confirm Location'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
