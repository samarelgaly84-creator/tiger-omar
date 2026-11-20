import { apiFetch } from './api';
import type { Lang } from './i18n';

export interface GeoFix {
  lat: number;
  lng: number;
  accuracy: number | null;
  city: string;
  region: string;
  country: string;
  displayName: string;
  label: string;
}

export function formatGeolocationError(err: GeolocationPositionError | Error | unknown, lang: Lang): string {
  const code = (err as GeolocationPositionError)?.code;
  if (code === 1) {
    return lang === 'ar'
      ? 'تم رفض إذن الوصول للموقع الجغرافي. يمكنك تفعيل الصلاحية من إعدادات المتصفح أو اختيار الموقع من الخريطة.'
      : 'Location permission was denied. Enable location access in browser settings or pick a point on the map.';
  }
  if (code === 2) {
    return lang === 'ar'
      ? 'تعذر تحديد الموقع الجغرافي حالياً (إشارة GPS غير متاحة). تأكد من تفعيل خدمات الموقع في جهازك.'
      : 'Current position is unavailable right now. Please ensure GPS/location services are enabled.';
  }
  if (code === 3) {
    return lang === 'ar'
      ? 'انتهت مهلة تحديد الموقع الجغرافي. يرجى المحاولة مرة أخرى.'
      : 'Location request timed out. Please try again.';
  }
  return lang === 'ar'
    ? 'تعذر الحصول على الموقع الجغرافي في هذا المتصفح.'
    : 'Unable to retrieve geolocation on this device.';
}

export function requestBrowserPosition(lang: Lang): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(
        new Error(
          lang === 'ar'
            ? 'المتصفح الحالي لا يدعم خدمة تحديد الموقع الجغرافي (Geolocation).'
            : 'Geolocation is not supported by this browser.'
        )
      );
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      (err) => reject(new Error(formatGeolocationError(err, lang))),
      {
        enableHighAccuracy: true,
        timeout: 12_000,
        maximumAge: 15_000,
      }
    );
  });
}

export async function reverseGeocodeCoords(
  lat: number,
  lng: number,
  lang: Lang
): Promise<{
  city: string;
  region: string;
  country: string;
  displayName: string;
  label: string;
}> {
  try {
    const res = await apiFetch<{
      city: string;
      region: string;
      country: string;
      displayName: string;
      label: string;
    }>(`/api/location/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&lang=${lang}`);
    return res;
  } catch {
    const fallback = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    return { city: '', region: '', country: '', displayName: fallback, label: fallback };
  }
}

export async function acquireCurrentLocationWithAddress(lang: Lang): Promise<GeoFix> {
  const pos = await requestBrowserPosition(lang);
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  const accuracy = Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null;
  const geo = await reverseGeocodeCoords(lat, lng, lang);
  return {
    lat,
    lng,
    accuracy,
    ...geo,
  };
}

export function buildExternalOsmUrl(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(
    lng
  )}#map=16/${encodeURIComponent(lat)}/${encodeURIComponent(lng)}`;
}
