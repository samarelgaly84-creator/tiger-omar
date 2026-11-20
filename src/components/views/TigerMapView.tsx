import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  MapPin,
  LocateFixed,
  Search,
  Plus,
  Trash2,
  Share2,
  ExternalLink,
  Loader2,
  ShieldCheck,
  Radio,
  Square,
  Users,
  Lock,
  AlertTriangle,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import {
  acquireCurrentLocationWithAddress,
  buildExternalOsmUrl,
  formatGeolocationError,
  GeoFix,
  reverseGeocodeCoords,
} from '../../lib/geolocation';
import { TigerMapCanvas, TigerMapMarker } from '../TigerMapWidget';

interface SavedPlace {
  id: number;
  userId: number;
  title: string;
  description: string;
  category: string;
  lat: number;
  lng: number;
  address: string;
  visibility: 'private' | 'friends';
  createdAt: string;
  owner?: { id: number; displayName: string; username: string; avatarUrl: string | null } | null;
}

interface LiveShareItem {
  id: number;
  userId: number;
  chatId: number | null;
  shareScope: 'chat' | 'friends';
  lat: number | null;
  lng: number | null;
  label: string;
  durationMinutes: number;
  expiresAt: string;
  isActive: boolean;
  user?: { id: number; displayName: string; username: string; avatarUrl: string | null } | null;
}

export const TigerMapView: React.FC = () => {
  const { lang, notifyToast, subscribeWs } = useAuth();

  const [center, setCenter] = useState<[number, number]>([30.0444, 31.2357]);
  const [zoom, setZoom] = useState(6);
  const [currentFix, setCurrentFix] = useState<GeoFix | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  // Search places
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<
    Array<{ name: string; displayName: string; lat: number; lng: number; category: string }>
  >([]);

  // Add marker mode & form
  const [addMarkerMode, setAddMarkerMode] = useState(false);
  const [draftPin, setDraftPin] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [pinTitle, setPinTitle] = useState('');
  const [pinDesc, setPinDesc] = useState('');
  const [pinVisibility, setPinVisibility] = useState<'private' | 'friends'>('private');
  const [savingPin, setSavingPin] = useState(false);

  // Places & Live Shares
  const [myPlaces, setMyPlaces] = useState<SavedPlace[]>([]);
  const [friendPlaces, setFriendPlaces] = useState<SavedPlace[]>([]);
  const [myLiveShares, setMyLiveShares] = useState<LiveShareItem[]>([]);
  const [friendLiveShares, setFriendLiveShares] = useState<LiveShareItem[]>([]);
  const [liveDuration, setLiveDuration] = useState<15 | 60 | 480>(15);
  const [startingLive, setStartingLive] = useState(false);
  const [deletingData, setDeletingData] = useState(false);

  const watchIdRef = useRef<number | null>(null);
  const activeFriendShareIdRef = useRef<number | null>(null);

  const loadMapData = useCallback(async () => {
    try {
      const [placesRes, liveRes] = await Promise.all([
        apiFetch<{ myPlaces: SavedPlace[]; friendPlaces: SavedPlace[] }>('/api/location/places'),
        apiFetch<{ myShares: LiveShareItem[]; sharedWithMe: LiveShareItem[] }>('/api/location/live'),
      ]);
      setMyPlaces(placesRes.myPlaces || []);
      setFriendPlaces(placesRes.friendPlaces || []);
      setMyLiveShares(liveRes.myShares || []);
      setFriendLiveShares(liveRes.sharedWithMe || []);

      const activeFriendsShare = (liveRes.myShares || []).find((s) => s.shareScope === 'friends' && s.isActive);
      activeFriendShareIdRef.current = activeFriendsShare?.id ?? null;
    } catch (err: any) {
      notifyToast(err?.message || 'Failed to load map data', 'error');
    }
  }, [notifyToast]);

  useEffect(() => {
    void loadMapData();
    return () => {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [loadMapData]);

  // Listen for real-time live location updates from authorized peers
  useEffect(() => {
    return subscribeWs((event, payload) => {
      if (event === 'location:live-update') {
        setFriendLiveShares((prev) => {
          const exists = prev.some((s) => s.id === payload.id);
          return exists ? prev.map((s) => (s.id === payload.id ? payload : s)) : [payload, ...prev];
        });
      } else if (event === 'location:live-stopped') {
        setFriendLiveShares((prev) => prev.filter((s) => s.id !== payload.id));
      }
    });
  }, [subscribeWs]);

  const handleLocateMe = async () => {
    setLocating(true);
    setGeoError(null);
    try {
      const fix = await acquireCurrentLocationWithAddress(lang);
      setCurrentFix(fix);
      setCenter([fix.lat, fix.lng]);
      setZoom(15);
    } catch (err: any) {
      const msg = err?.message || formatGeolocationError(err, lang);
      setGeoError(msg);
      notifyToast(msg, 'error');
    } finally {
      setLocating(false);
    }
  };

  const handleSearchPlaces = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await apiFetch<{ places: any[] }>(
        `/api/location/search?q=${encodeURIComponent(searchQuery.trim())}&lang=${lang}`
      );
      setSearchResults(res.places || []);
      if ((res.places || []).length === 0) {
        notifyToast(lang === 'ar' ? 'لم يتم العثور على أماكن مطابقة' : 'No matching places found', 'info');
      }
    } catch (err: any) {
      notifyToast(err?.message || 'Search failed', 'error');
    } finally {
      setSearching(false);
    }
  };

  const handleMapClick = async (lat: number, lng: number) => {
    if (!addMarkerMode) return;
    const coordLabel = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    setDraftPin({ lat, lng, address: coordLabel });
    const geo = await reverseGeocodeCoords(lat, lng, lang);
    setDraftPin({ lat, lng, address: geo.label });
  };

  const handleSavePlace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftPin || !pinTitle.trim()) return;
    setSavingPin(true);
    try {
      await apiFetch('/api/location/places', {
        method: 'POST',
        body: JSON.stringify({
          title: pinTitle.trim(),
          description: pinDesc.trim(),
          lat: draftPin.lat,
          lng: draftPin.lng,
          address: draftPin.address,
          visibility: pinVisibility,
        }),
      });
      setDraftPin(null);
      setPinTitle('');
      setPinDesc('');
      setAddMarkerMode(false);
      await loadMapData();
      notifyToast(lang === 'ar' ? 'تم حفظ العلامة بنجاح' : 'Location marker saved', 'success');
    } catch (err: any) {
      notifyToast(err?.message || 'Failed to save place', 'error');
    } finally {
      setSavingPin(false);
    }
  };

  const togglePlaceVisibility = async (place: SavedPlace) => {
    const nextVis = place.visibility === 'friends' ? 'private' : 'friends';
    try {
      await apiFetch(`/api/location/places/${place.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ visibility: nextVis }),
      });
      await loadMapData();
      notifyToast(
        nextVis === 'friends'
          ? lang === 'ar'
            ? 'تمت مشاركة المكان مع الأصدقاء'
            : 'Shared place with friends'
          : lang === 'ar'
          ? 'تم جعل المكان خاصاً بك'
          : 'Place set to private',
        'success'
      );
    } catch (err: any) {
      notifyToast(err?.message || 'Update failed', 'error');
    }
  };

  const deletePlace = async (id: number) => {
    try {
      await apiFetch(`/api/location/places/${id}`, { method: 'DELETE' });
      await loadMapData();
      notifyToast(lang === 'ar' ? 'تم حذف المكان' : 'Place deleted', 'success');
    } catch (err: any) {
      notifyToast(err?.message || 'Delete failed', 'error');
    }
  };

  const startLiveFriendsShare = async () => {
    setStartingLive(true);
    setGeoError(null);
    try {
      const fix = await acquireCurrentLocationWithAddress(lang);
      setCurrentFix(fix);
      setCenter([fix.lat, fix.lng]);
      setZoom(15);

      const res = await apiFetch<{ share: LiveShareItem }>('/api/location/live/start', {
        method: 'POST',
        body: JSON.stringify({
          lat: fix.lat,
          lng: fix.lng,
          accuracy: fix.accuracy,
          label: fix.label,
          durationMinutes: liveDuration,
          scope: 'friends',
        }),
      });

      activeFriendShareIdRef.current = res.share.id;
      if (navigator.geolocation) {
        if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = navigator.geolocation.watchPosition(
          (pos) => {
            if (!activeFriendShareIdRef.current) return;
            void apiFetch(`/api/location/live/${activeFriendShareIdRef.current}`, {
              method: 'PATCH',
              body: JSON.stringify({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
              }),
            }).catch(() => {});
          },
          () => {},
          { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 }
        );
      }

      await loadMapData();
      notifyToast(
        lang === 'ar' ? 'بدأت مشاركة موقعك المباشر مع الأصدقاء' : 'Live location sharing with friends started',
        'success'
      );
    } catch (err: any) {
      const msg = err?.message || 'Failed to start live sharing';
      setGeoError(msg);
      notifyToast(msg, 'error');
    } finally {
      setStartingLive(false);
    }
  };

  const stopAllLiveShares = async () => {
    try {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      activeFriendShareIdRef.current = null;
      await apiFetch('/api/location/live/stop-all', { method: 'POST', body: JSON.stringify({}) });
      await loadMapData();
      notifyToast(
        lang === 'ar' ? 'تم إيقاف مشاركة الموقع وحذف الإحداثيات المباشرة' : 'Live location stopped and coordinates wiped',
        'success'
      );
    } catch (err: any) {
      notifyToast(err?.message || 'Failed to stop live sharing', 'error');
    }
  };

  const deleteAllLocationData = async () => {
    setDeletingData(true);
    try {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      activeFriendShareIdRef.current = null;
      await apiFetch('/api/location/me', { method: 'DELETE' });
      setCurrentFix(null);
      setDraftPin(null);
      await loadMapData();
      notifyToast(
        lang === 'ar' ? 'تم حذف جميع بيانات الموقع الخاصة بك بنجاح' : 'All your stored location data deleted',
        'success'
      );
    } catch (err: any) {
      notifyToast(err?.message || 'Failed to delete location data', 'error');
    } finally {
      setDeletingData(false);
    }
  };

  const markers: TigerMapMarker[] = [
    ...(currentFix
      ? [
          {
            id: 'me',
            lat: currentFix.lat,
            lng: currentFix.lng,
            title: lang === 'ar' ? 'موقعي الحالي' : 'My Current Location',
            subtitle: currentFix.label,
            kind: 'me' as const,
          },
        ]
      : []),
    ...(draftPin
      ? [
          {
            id: 'draft',
            lat: draftPin.lat,
            lng: draftPin.lng,
            title: pinTitle || (lang === 'ar' ? 'علامة جديدة' : 'New Marker'),
            subtitle: draftPin.address,
            kind: 'picked' as const,
          },
        ]
      : []),
    ...myPlaces.map((p) => ({
      id: `my-${p.id}`,
      lat: p.lat,
      lng: p.lng,
      title: p.title,
      subtitle: p.address || `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`,
      kind: 'place' as const,
    })),
    ...friendPlaces.map((p) => ({
      id: `fp-${p.id}`,
      lat: p.lat,
      lng: p.lng,
      title: `${p.title} — ${p.owner?.displayName || ''}`,
      subtitle: p.address,
      kind: 'friend_place' as const,
    })),
    ...friendLiveShares
      .filter((s) => s.lat !== null && s.lng !== null)
      .map((s) => ({
        id: `live-${s.id}`,
        lat: s.lat!,
        lng: s.lng!,
        title: `${s.user?.displayName || 'Friend'} (${lang === 'ar' ? 'مباشر' : 'LIVE'})`,
        subtitle: s.label,
        kind: 'live' as const,
      })),
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header & Controls */}
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-orange-500/15 text-orange-500 flex items-center justify-center">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-display font-bold">
                {lang === 'ar' ? 'TIGER MAP — الخرائط والموقع' : 'TIGER MAP — Location & Places'}
              </h2>
              <p className="text-xs text-zinc-500">
                {lang === 'ar'
                  ? 'خرائط تفاعلية عبر OpenStreetMap مع تحكم كامل في الخصوصية والموقع'
                  : 'Interactive OpenStreetMap with explicit user-consented location & privacy'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleLocateMe()}
              disabled={locating}
              className="px-3.5 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold inline-flex items-center gap-1.5"
            >
              {locating ? <Loader2 className="w-4 h-4 animate-spin" /> : <LocateFixed className="w-4 h-4" />}
              <span>{lang === 'ar' ? 'موقعي الحالي' : 'My Current Location'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setAddMarkerMode((v) => !v);
                if (addMarkerMode) setDraftPin(null);
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 border ${
                addMarkerMode
                  ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 border-orange-500'
                  : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              <Plus className="w-4 h-4" />
              <span>{addMarkerMode ? (lang === 'ar' ? 'انقر على الخريطة...' : 'Click Map...') : lang === 'ar' ? 'إضافة علامة' : 'Add Marker'}</span>
            </button>
          </div>
        </div>

        {/* Search Places */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-zinc-400 absolute start-3 top-2.5" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleSearchPlaces()}
              placeholder={
                lang === 'ar' ? 'ابحث عن مكان، مدينة، شارع، أو معلم...' : 'Search places, cities, landmarks...'
              }
              className="w-full ps-9 pe-3 py-2 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 focus:outline-none focus:border-orange-500"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleSearchPlaces()}
            disabled={searching}
            className="px-4 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-800 hover:bg-zinc-800 text-white text-xs font-semibold inline-flex items-center gap-1.5"
          >
            {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            <span>{lang === 'ar' ? 'بحث' : 'Search'}</span>
          </button>
        </div>

        {searchResults.length > 0 && (
          <div className="max-h-40 overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-800 text-xs">
            {searchResults.map((r, idx) => (
              <div key={idx} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-950">
                <button
                  type="button"
                  onClick={() => {
                    setCenter([r.lat, r.lng]);
                    setZoom(14);
                    setDraftPin({ lat: r.lat, lng: r.lng, address: r.displayName || r.name });
                    setPinTitle(r.name);
                    setAddMarkerMode(true);
                    setSearchResults([]);
                  }}
                  className="text-start flex-1 min-w-0"
                >
                  <div className="font-bold truncate">{r.name}</div>
                  <div className="text-[11px] text-zinc-500 truncate">{r.displayName}</div>
                </button>
                <span className="text-[10px] font-mono text-zinc-500 shrink-0 tabular-nums">
                  {r.lat.toFixed(3)}, {r.lng.toFixed(3)}
                </span>
              </div>
            ))}
          </div>
        )}

        {geoError && (
          <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-xs text-red-500 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{geoError}</span>
          </div>
        )}

        {currentFix && (
          <div className="p-3 rounded-xl bg-orange-500/10 border border-orange-500/30 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="space-y-0.5">
              <div className="font-bold text-orange-500">
                {lang === 'ar' ? 'موقعك الحالي المحدد:' : 'Current Detected Position:'} {currentFix.label}
              </div>
              <div className="text-zinc-600 dark:text-zinc-400 font-mono tabular-nums">
                {currentFix.lat.toFixed(6)}, {currentFix.lng.toFixed(6)}
                {currentFix.city ? ` · ${currentFix.city}` : ''}
                {currentFix.region ? ` · ${currentFix.region}` : ''}
                {currentFix.accuracy ? ` (±${currentFix.accuracy}m)` : ''}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setDraftPin({ lat: currentFix.lat, lng: currentFix.lng, address: currentFix.label });
                  setPinTitle(currentFix.city || (lang === 'ar' ? 'موقعي' : 'My Spot'));
                  setAddMarkerMode(true);
                }}
                className="px-3 py-1.5 rounded-lg bg-orange-500 text-white font-semibold"
              >
                {lang === 'ar' ? 'حفظ كعلامة' : 'Save Pin'}
              </button>
              <a
                href={buildExternalOsmUrl(currentFix.lat, currentFix.lng)}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 font-semibold inline-flex items-center gap-1"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>{lang === 'ar' ? 'فتح في الخرائط' : 'Open Maps'}</span>
              </a>
            </div>
          </div>
        )}
      </section>

      {/* Main Map + Draft Pin Form */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-3">
          <TigerMapCanvas
            center={center}
            zoom={zoom}
            markers={markers}
            heightClass="h-[440px]"
            onMapClick={(lat, lng) => void handleMapClick(lat, lng)}
          />

          {/* Draft Marker Save Box */}
          {draftPin && (
            <form
              onSubmit={handleSavePlace}
              className="rounded-2xl border border-orange-500/40 bg-white dark:bg-zinc-900 p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-orange-500">
                  {lang === 'ar' ? 'حفظ علامة جديدة على الخريطة' : 'Save New Map Marker'}
                </h3>
                <span className="text-[11px] font-mono text-zinc-500 tabular-nums">
                  {draftPin.lat.toFixed(5)}, {draftPin.lng.toFixed(5)}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <input
                  required
                  value={pinTitle}
                  onChange={(e) => setPinTitle(e.target.value)}
                  placeholder={lang === 'ar' ? 'اسم المكان...' : 'Place name...'}
                  className="px-3 py-2 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800"
                />
                <select
                  value={pinVisibility}
                  onChange={(e) => setPinVisibility(e.target.value as 'private' | 'friends')}
                  className="px-3 py-2 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800"
                >
                  <option value="private">{lang === 'ar' ? 'خاص بي فقط' : 'Private (Only Me)'}</option>
                  <option value="friends">{lang === 'ar' ? 'مشاركة مع الأصدقاء' : 'Share with Friends'}</option>
                </select>
              </div>
              <input
                value={pinDesc}
                onChange={(e) => setPinDesc(e.target.value)}
                placeholder={lang === 'ar' ? 'ملاحظات أو وصف اختياري...' : 'Optional notes...'}
                className="w-full px-3 py-2 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDraftPin(null);
                    setAddMarkerMode(false);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-800 text-xs font-semibold"
                >
                  {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={savingPin || !pinTitle.trim()}
                  className="px-4 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold"
                >
                  {savingPin ? '...' : lang === 'ar' ? 'حفظ العلامة' : 'Save Marker'}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Side Column: Privacy Controls, Live Sharing, Saved & Friend Places */}
        <div className="space-y-4">
          {/* Privacy & Live Sharing Panel */}
          <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold">
              <ShieldCheck className="w-4 h-4 text-orange-500" />
              <span>{lang === 'ar' ? 'الموقع المباشر والخصوصية' : 'Live Location & Privacy'}</span>
            </div>

            <p className="text-[11px] text-zinc-500 leading-relaxed">
              {lang === 'ar'
                ? 'لا يتم مشاركة موقعك تلقائياً مطلقاً ولا يُحفظ الموقع المباشر بشكل دائم.'
                : 'Your location is never shared automatically and live coordinates are wiped upon stop/expiry.'}
            </p>

            {myLiveShares.length > 0 ? (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-2 text-xs">
                <div className="flex items-center justify-between text-emerald-500 font-bold">
                  <span className="inline-flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 animate-pulse" />
                    {lang === 'ar' ? 'مشاركة مباشرة نشطة' : 'Live Sharing Active'}
                  </span>
                  <span>{myLiveShares.length}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void stopAllLiveShares()}
                  className="w-full py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold inline-flex items-center justify-center gap-1.5"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>{lang === 'ar' ? 'إيقاف مشاركة الموقع الآن' : 'Stop Sharing Location'}</span>
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-1">
                  {([
                    { mins: 15, labelAr: '15 د', labelEn: '15m' },
                    { mins: 60, labelAr: 'ساعة', labelEn: '1h' },
                    { mins: 480, labelAr: '8 ساعات', labelEn: '8h' },
                  ] as const).map((d) => (
                    <button
                      key={d.mins}
                      type="button"
                      onClick={() => setLiveDuration(d.mins)}
                      className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold border ${
                        liveDuration === d.mins
                          ? 'bg-orange-500 text-white border-orange-500'
                          : 'border-zinc-200 dark:border-zinc-800 text-zinc-500'
                      }`}
                    >
                      {lang === 'ar' ? d.labelAr : d.labelEn}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => void startLiveFriendsShare()}
                  disabled={startingLive}
                  className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5"
                >
                  {startingLive ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Radio className="w-3.5 h-3.5" />}
                  <span>{lang === 'ar' ? 'مشاركة موقعي المباشر مع الأصدقاء' : 'Share Live Location with Friends'}</span>
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => void deleteAllLocationData()}
              disabled={deletingData}
              className="w-full py-2 rounded-xl bg-red-600/10 hover:bg-red-600/20 text-red-500 text-xs font-semibold inline-flex items-center justify-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{lang === 'ar' ? 'حذف جميع بيانات الموقع' : 'Delete All Location Data'}</span>
            </button>
          </section>

          {/* My Saved Places */}
          <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-orange-500">
              {lang === 'ar' ? 'الأماكن المحفوظة' : 'Saved Places'} ({myPlaces.length})
            </h3>
            {myPlaces.length === 0 ? (
              <p className="text-xs text-zinc-500">
                {lang === 'ar' ? 'لا توجد علامات محفوظة بعد.' : 'No saved markers yet.'}
              </p>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto">
                {myPlaces.map((p) => (
                  <div
                    key={p.id}
                    className="p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setCenter([p.lat, p.lng]);
                          setZoom(15);
                        }}
                        className="font-bold text-start truncate hover:text-orange-500"
                      >
                        {p.title}
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => void togglePlaceVisibility(p)}
                          className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
                          title={
                            p.visibility === 'friends'
                              ? lang === 'ar'
                                ? 'مشارك مع الأصدقاء'
                                : 'Shared with friends'
                              : lang === 'ar'
                              ? 'خاص'
                              : 'Private'
                          }
                        >
                          {p.visibility === 'friends' ? (
                            <Users className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <Lock className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deletePlace(p.id)}
                          className="p-1 rounded hover:bg-red-500/10 text-zinc-400 hover:text-red-500"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="text-[11px] text-zinc-500 truncate">{p.address}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Friends Shared Places & Live Locations */}
          <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-blue-500 flex items-center gap-1.5">
              <Share2 className="w-3.5 h-3.5" />
              <span>
                {lang === 'ar' ? 'مواقع مشاركة من الأصدقاء' : 'Shared by Friends'} (
                {friendPlaces.length + friendLiveShares.length})
              </span>
            </h3>
            {friendPlaces.length === 0 && friendLiveShares.length === 0 ? (
              <p className="text-xs text-zinc-500">
                {lang === 'ar'
                  ? 'لا توجد مواقع مشاركة من الأصدقاء حالياً.'
                  : 'No friend-shared locations right now.'}
              </p>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto text-xs">
                {friendLiveShares
                  .filter((s) => s.lat !== null && s.lng !== null)
                  .map((s) => (
                    <button
                      key={`fl-${s.id}`}
                      type="button"
                      onClick={() => {
                        setCenter([s.lat!, s.lng!]);
                        setZoom(15);
                      }}
                      className="w-full text-start p-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/10"
                    >
                      <div className="font-bold text-emerald-500 flex items-center justify-between">
                        <span>{s.user?.displayName || 'Friend'}</span>
                        <span className="text-[10px]">{lang === 'ar' ? 'مباشر' : 'LIVE'}</span>
                      </div>
                      <div className="text-[11px] text-zinc-500 truncate">{s.label}</div>
                    </button>
                  ))}
                {friendPlaces.map((p) => (
                  <button
                    key={`fp-${p.id}`}
                    type="button"
                    onClick={() => {
                      setCenter([p.lat, p.lng]);
                      setZoom(15);
                    }}
                    className="w-full text-start p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:border-blue-500/50"
                  >
                    <div className="font-bold truncate">
                      {p.title} · <span className="text-blue-500">{p.owner?.displayName}</span>
                    </div>
                    <div className="text-[11px] text-zinc-500 truncate">{p.address}</div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
