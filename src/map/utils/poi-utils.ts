import type {
  LocalPoi,
  PoiCategory,
  LocalContext,
  OverpassElement,
} from '../types/local-map.types.js';

const CATEGORY_WEIGHTS: Record<PoiCategory, number> = {
  landmark: 10,
  transport: 8,
  fuel: 7,
  hospital: 7,
  police: 6,
  market: 6,
  locality: 5,
  education: 4,
  food: 3,
  bank: 3,
  junction: 2,
  other: 1,
};

const CATEGORY_CAPS: Record<PoiCategory, number> = {
  landmark: 2,
  transport: 2,
  fuel: 1,
  hospital: 1,
  police: 1,
  market: 1,
  locality: 1,
  education: 1,
  food: 1,
  bank: 1,
  junction: 1,
  other: 0,
};

export function categorizePoi(tags: Record<string, string>): PoiCategory {
  const amenity = tags.amenity ?? '';
  const shop = tags.shop ?? '';
  const tourism = tags.tourism ?? '';
  const railway = tags.railway ?? '';
  const highway = tags.highway ?? '';
  const place = tags.place ?? '';
  const leisure = tags.leisure ?? '';
  const historic = tags.historic ?? '';
  const building = tags.building ?? '';

  if (
    historic ||
    tourism === 'attraction' ||
    tourism === 'museum' ||
    tourism === 'viewpoint' ||
    building === 'cathedral' ||
    building === 'church' ||
    building === 'mosque' ||
    building === 'temple'
  ) {
    return 'landmark';
  }
  if (
    railway === 'station' ||
    railway === 'subway_entrance' ||
    railway === 'tram_stop' ||
    amenity === 'bus_station' ||
    highway === 'bus_stop'
  ) {
    return 'transport';
  }
  if (amenity === 'fuel') {
    return 'fuel';
  }
  if (amenity === 'hospital' || amenity === 'clinic') {
    return 'hospital';
  }
  if (amenity === 'police') {
    return 'police';
  }
  if (
    shop === 'mall' ||
    shop === 'supermarket' ||
    shop === 'department_store' ||
    shop === 'marketplace' ||
    amenity === 'marketplace'
  ) {
    return 'market';
  }
  if (
    place === 'suburb' ||
    place === 'neighbourhood' ||
    place === 'quarter' ||
    place === 'locality'
  ) {
    return 'locality';
  }
  if (
    amenity === 'school' ||
    amenity === 'college' ||
    amenity === 'university'
  ) {
    return 'education';
  }
  if (
    amenity === 'restaurant' ||
    amenity === 'cafe' ||
    amenity === 'fast_food'
  ) {
    return 'food';
  }
  if (shop === 'convenience' || amenity === 'bank' || amenity === 'atm') {
    return 'bank';
  }
  if (highway === 'traffic_signals') {
    return 'junction';
  }

  return 'other';
}

export function parseOverpassPois(overpassResult: any): LocalPoi[] {
  const pois: LocalPoi[] = [];
  const elements: OverpassElement[] = overpassResult?.elements ?? [];

  for (const el of elements) {
    let lat = el.lat;
    let lng = el.lon;

    if (el.type === 'way' || el.type === 'relation') {
      const center = el.center;
      if (center) {
        lat = center.lat;
        lng = center.lon;
      } else {
        continue;
      }
    }

    if (lat === undefined || lng === undefined) continue;

    const tags = el.tags ?? {};
    const name = tags.name;
    if (!name) continue;

    const category = categorizePoi(tags);
    const importance = CATEGORY_WEIGHTS[category] ?? 1;

    pois.push({
      id: `${el.type}_${el.id}`,
      name,
      category,
      type: getPrimaryTag(tags),
      lat,
      lng,
      tags,
      importance,
    });
  }

  return pois;
}

function getPrimaryTag(tags: Record<string, string>): string {
  return (
    tags.amenity ??
    tags.shop ??
    tags.tourism ??
    tags.railway ??
    tags.highway ??
    tags.place ??
    tags.leisure ??
    tags.historic ??
    tags.building ??
    'unknown'
  );
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
}

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function deduplicatePois(pois: LocalPoi[]): LocalPoi[] {
  const seen = new Map<string, LocalPoi>();

  for (const poi of pois) {
    const key = normalizeName(poi.name);
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, poi);
    } else if (poi.importance > existing.importance) {
      seen.set(key, poi);
    }
  }

  return Array.from(seen.values());
}

export function scoreAndLimitPois(
  pois: LocalPoi[],
  centerLat: number,
  centerLng: number,
  maxTotal = 8,
): LocalPoi[] {
  const withDistance = pois.map((p) => ({
    ...p,
    distanceFromCenterKm: haversineKm(p.lat, p.lng, centerLat, centerLng),
  }));

  withDistance.sort((a, b) => a.distanceFromCenterKm - b.distanceFromCenterKm);

  const selected: LocalPoi[] = [];
  const categoryCount = new Map<PoiCategory, number>();

  for (const poi of withDistance) {
    if (selected.length >= maxTotal) break;

    const cap = CATEGORY_CAPS[poi.category] ?? 1;
    const currentCount = categoryCount.get(poi.category) ?? 0;
    if (currentCount >= cap) continue;

    selected.push(poi);
    categoryCount.set(poi.category, currentCount + 1);
  }

  selected.sort((a, b) => (b.importance ?? 1) - (a.importance ?? 1));

  return selected;
}

export function extractLocalContext(pois: LocalPoi[]): LocalContext {
  const localities = pois.filter((p) => p.category === 'locality');
  localities.sort((a, b) => (b.importance ?? 1) - (a.importance ?? 1));

  const landmarks = pois.filter((p) => p.category === 'landmark');
  landmarks.sort((a, b) => (b.importance ?? 1) - (a.importance ?? 1));

  const transport = pois.filter((p) => p.category === 'transport');
  transport.sort((a, b) => (b.importance ?? 1) - (a.importance ?? 1));

  return {
    primaryLocality: localities[0] ?? null,
    nearbyLandmarks: landmarks.slice(0, 3),
    nearbyTransport: transport.slice(0, 3),
    nearestRoadName: null,
  };
}
