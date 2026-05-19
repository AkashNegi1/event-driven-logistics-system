export interface LocalMapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface LocalMapDiagnostics {
  buildingFeatures: number;
  roadFeatures: number;
  poiFeatures: number;
  source: 'cache' | 'local-osm' | 'mixed' | 'overpass' | 'fallback' | 'stale-cache';
  buildingSource: 'cache' | 'local-osm' | 'overpass' | 'fallback' | 'stale-cache';
  roadSource: 'cache' | 'local-osm' | 'overpass' | 'fallback' | 'stale-cache';
  poiSource: 'cache' | 'local-osm' | 'overpass' | 'fallback' | 'stale-cache';
  buildingError?: string;
  roadError?: string;
  poiError?: string;
  durationMs: number;
  error?: string;
}

export type PoiCategory =
  | 'landmark'
  | 'transport'
  | 'food'
  | 'fuel'
  | 'hospital'
  | 'education'
  | 'bank'
  | 'police'
  | 'market'
  | 'junction'
  | 'locality'
  | 'other';

export interface LocalPoi {
  id: string;
  name: string;
  category: PoiCategory;
  type: string;
  lat: number;
  lng: number;
  tags?: Record<string, string>;
  importance: number;
  distanceFromCenterKm?: number;
}

export interface LocalContext {
  primaryLocality: LocalPoi | null;
  nearbyLandmarks: LocalPoi[];
  nearbyTransport: LocalPoi[];
  nearestRoadName: string | null;
}

export interface LocalMapResponse {
  regionId: string;
  center: { lat: number; lng: number };
  radiusMeters: number;
  bounds: LocalMapBounds;
  buildings: any;
  roads: any;
  pois: LocalPoi[];
  localContext: LocalContext;
  cached: boolean;
  diagnostics: LocalMapDiagnostics;
}

export interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  members?: any[];
  center?: { lat: number; lon: number };
}
