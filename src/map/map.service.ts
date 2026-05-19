import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis.service.js';
import { OverpassService } from './overpass.service.js';
import { OsmDatabaseService } from './osm-database.service.js';
import osmtogeojson from 'osmtogeojson';
import type {
  LocalMapBounds,
  LocalMapResponse,
  LocalMapDiagnostics,
  LocalPoi,
  LocalContext,
} from './types/local-map.types.js';
import type {
  RouteContextResponse,
  RouteContextPlace,
} from './types/route-context.types.js';
import type { RouteContextQueryDto } from './dto/route-context-query.dto.js';
import {
  parseOverpassPois,
  deduplicatePois,
  scoreAndLimitPois,
  extractLocalContext,
} from './utils/poi-utils.js';

const DEBUG_MAP_LOCAL = process.env.DEBUG_MAP_LOCAL === 'true';
const DEBUG_OSM_QUERIES = process.env.DEBUG_OSM_QUERIES === 'true';
const DEBUG_ROUTE_CONTEXT = process.env.DEBUG_ROUTE_CONTEXT === 'true';

const GRID_SIZE_METERS = 1500;

function createBoundsFromCenter(
  lat: number,
  lng: number,
  radiusMeters: number,
): LocalMapBounds {
  const metersPerDegLat = 111320;
  const latRad = (lat * Math.PI) / 180;
  const metersPerDegLng = metersPerDegLat * Math.cos(latRad);
  return {
    north: lat + radiusMeters / metersPerDegLat,
    south: lat - radiusMeters / metersPerDegLat,
    east: lng + radiusMeters / metersPerDegLng,
    west: lng - radiusMeters / metersPerDegLng,
  };
}

function normalizeRadius(radiusMeters: number): number {
  const clamped = Math.max(500, Math.min(1500, radiusMeters));
  return Math.round(clamped / 500) * 500;
}

function getGridCell(
  lat: number,
  lng: number,
  gridSizeMeters = GRID_SIZE_METERS,
) {
  const metersPerDegLat = 111320;
  const latRad = (lat * Math.PI) / 180;
  const metersPerDegLng = metersPerDegLat * Math.cos(latRad);

  const xMeters = lng * metersPerDegLng;
  const zMeters = lat * metersPerDegLat;

  const cellX = Math.floor(xMeters / gridSizeMeters);
  const cellZ = Math.floor(zMeters / gridSizeMeters);

  const centerLng = ((cellX + 0.5) * gridSizeMeters) / metersPerDegLng;
  const centerLat = ((cellZ + 0.5) * gridSizeMeters) / metersPerDegLat;

  return {
    cellX,
    cellZ,
    centerLat,
    centerLng,
    gridSizeMeters,
  };
}

function slimBuildings(geoJson: any): any {
  const maxFeatures = 1500;
  const features = (geoJson.features ?? []).slice(0, maxFeatures);
  return { type: 'FeatureCollection', features };
}

function slimRoads(geoJson: any): any {
  const skipTypes = new Set([
    'footway',
    'path',
    'steps',
    'cycleway',
    'track',
    'corridor',
  ]);
  const maxFeatures = 2000;
  const features: any[] = [];
  for (const f of geoJson.features ?? []) {
    const highway = f.properties?.highway;
    if (skipTypes.has(highway)) continue;
    features.push(f);
    if (features.length >= maxFeatures) break;
  }
  return { type: 'FeatureCollection', features };
}

@Injectable()
export class MapService {
  private readonly logger = new Logger(MapService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly overpassService: OverpassService,
    private readonly osmDb: OsmDatabaseService,
  ) {}

  async getLocalMap(
    lat: number,
    lng: number,
    radiusMeters: number,
  ): Promise<LocalMapResponse> {
    const start = Date.now();

    const normalizedRadius = normalizeRadius(radiusMeters);
    const { cellX, cellZ, centerLat, centerLng, gridSizeMeters } = getGridCell(
      lat,
      lng,
    );
    const regionId = `grid_${cellZ}_${cellX}_${normalizedRadius}`;
    const bounds = createBoundsFromCenter(
      centerLat,
      centerLng,
      normalizedRadius,
    );
    const cacheKey = `local-map:v2:${cellZ}:${cellX}:${normalizedRadius}`;

    if (DEBUG_MAP_LOCAL) {
      this.logger.log(`[map/local] diagnostics`, {
        rawLat: lat,
        rawLng: lng,
        normalizedRadius,
        gridSizeMeters,
        cellX,
        cellZ,
        centerLat,
        centerLng,
        cacheKey,
        cacheHit: false,
      });
    }

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as LocalMapResponse;
        this.logger.log(
          `[map/local] returning cached response cacheKey=${cacheKey} buildings=${parsed.diagnostics.buildingFeatures} roads=${parsed.diagnostics.roadFeatures} pois=${parsed.diagnostics.poiFeatures ?? 0}`,
        );
        if (!parsed.pois) parsed.pois = [];
        if (!parsed.localContext)
          parsed.localContext = {
            primaryLocality: null,
            nearbyLandmarks: [],
            nearbyTransport: [],
            nearestRoadName: null,
          };
        parsed.cached = true;
        return parsed;
      } catch {}
    }

    let buildings: any = { type: 'FeatureCollection', features: [] };
    let roads: any = { type: 'FeatureCollection', features: [] };
    let pois: LocalPoi[] = [];
    let source: 'local-osm' | 'overpass' | 'mixed' | 'fallback' = 'overpass';
    let fallbackError: string | undefined;
    let buildingSource: 'local-osm' | 'overpass' | 'fallback' | 'stale-cache' = 'overpass';
    let roadSource: 'local-osm' | 'overpass' | 'fallback' | 'stale-cache' = 'overpass';
    let poiSource: 'local-osm' | 'overpass' | 'fallback' | 'stale-cache' = 'overpass';
    let buildingError: string | undefined;
    let roadError: string | undefined;
    let poiError: string | undefined;

    const [buildingResult, roadResult, poiResult] = await Promise.allSettled([
      this.fetchBuildingsLocalFirst(bounds),
      this.fetchRoadsLocalFirst(bounds),
      this.fetchPoisLocalFirst(centerLat, centerLng),
    ]);

    if (buildingResult.status === 'fulfilled') {
      const buildingData = buildingResult.value;
      buildings = buildingData.geoJson;
      buildingSource = buildingData.source as 'local-osm' | 'overpass' | 'fallback';
      buildingError = buildingData.error;

      if (DEBUG_MAP_LOCAL) {
        this.logger.log(`[local-osm-buildings]`, {
          bounds,
          count: buildings.features?.length ?? 0,
          durationMs: Date.now() - start,
          source: buildingData.source,
        });
      }
    } else {
      buildingSource = 'fallback';
      buildingError = buildingResult.reason?.message ?? 'Unknown error';
      this.logger.error(
        `[map/local] buildings fallback reason: ${buildingError}`,
      );
    }

    if (roadResult.status === 'fulfilled') {
      const roadData = roadResult.value;
      roads = roadData.geoJson;
      roadSource = roadData.source as 'local-osm' | 'overpass' | 'fallback';
      roadError = roadData.error;

      if (DEBUG_MAP_LOCAL) {
        this.logger.log(
          `[map/local] roads ${roadData.source} success features=${roads.features?.length ?? 0}`,
        );
      }
    } else {
      roadSource = 'fallback';
      roadError =
        (roadResult.reason as Error)?.message ?? 'Unknown error';
      this.logger.error(`[map/local] roads fallback reason: ${roadError}`);
    }

    if (poiResult.status === 'fulfilled') {
      const poiData = poiResult.value;
      pois = poiData.pois;
      poiSource = poiData.source as 'local-osm' | 'overpass' | 'fallback';
      poiError = poiData.error;

      if (DEBUG_MAP_LOCAL) {
        this.logger.log(
          `[map/local] pois ${poiData.source} success count=${pois.length}`,
        );
      }
    } else {
      poiSource = 'fallback';
      poiError = poiResult.reason?.message ?? 'Unknown error';
      this.logger.log(`[map/local] pois fallback (non-critical): ${poiError}`);
    }

    if (buildingSource === 'fallback' && roadSource === 'fallback') {
      source = 'fallback';
      fallbackError = `buildings: ${buildingError}, roads: ${roadError}`;
      this.logger.error(
        `[map/local] both overpass failed, reason: ${fallbackError}`,
      );

      const staleCache = await this.redis.get(cacheKey);
      if (staleCache) {
        try {
          const parsed = JSON.parse(staleCache) as LocalMapResponse;
          this.logger.log(
            `[map/local] returning stale cache cacheKey=${cacheKey}`,
          );
          return {
            ...parsed,
            pois: parsed.pois ?? [],
            localContext: parsed.localContext ?? {
              primaryLocality: null,
              nearbyLandmarks: [],
              nearbyTransport: [],
              nearestRoadName: null,
            },
            cached: true,
            diagnostics: {
              ...parsed.diagnostics,
              source: 'stale-cache',
              buildingSource: 'stale-cache',
              roadSource: 'stale-cache',
              poiSource: 'stale-cache',
              buildingError,
              roadError,
              poiError,
              durationMs: Date.now() - start,
            },
          };
        } catch {}
      }
    } else {
      const uniqueSources = new Set([buildingSource, roadSource, poiSource]);
      if (uniqueSources.size > 1) {
        source = 'mixed';
      } else if (uniqueSources.has('local-osm')) {
        source = 'local-osm';
      }
    }

    const localContext: LocalContext = extractLocalContext(pois);

    const diagnostics: LocalMapDiagnostics = {
      buildingFeatures: buildings.features?.length ?? 0,
      roadFeatures: roads.features?.length ?? 0,
      poiFeatures: pois.length,
      source,
      buildingSource,
      roadSource,
      poiSource,
      buildingError,
      roadError,
      poiError,
      durationMs: Date.now() - start,
      error: fallbackError,
    };

    const response: LocalMapResponse = {
      regionId,
      center: { lat: centerLat, lng: centerLng },
      radiusMeters: normalizedRadius,
      bounds,
      buildings,
      roads,
      pois,
      localContext,
      cached: false,
      diagnostics,
    };

    const hasData =
      (buildings.features?.length ?? 0) > 0 ||
      (roads.features?.length ?? 0) > 0;
    if (hasData) {
      try {
        await this.redis.set(cacheKey, JSON.stringify(response));
        if (DEBUG_MAP_LOCAL) {
          this.logger.log(
            `[map/local] cached cacheKey=${cacheKey} buildings=${diagnostics.buildingFeatures} roads=${diagnostics.roadFeatures} pois=${diagnostics.poiFeatures}`,
          );
        }
      } catch {}
    } else if (DEBUG_MAP_LOCAL) {
      this.logger.log(
        `[map/local] not caching fallback response cacheKey=${cacheKey}`,
      );
    }

    if (DEBUG_MAP_LOCAL) {
      this.logger.log(
        `[map/local] done cacheKey=${cacheKey} source=${source} buildings=${diagnostics.buildingFeatures} roads=${diagnostics.roadFeatures} pois=${diagnostics.poiFeatures} duration=${diagnostics.durationMs}ms`,
      );
    }

    return response;
  }

  private async fetchBuildingsLocalFirst(
    bounds: LocalMapBounds,
  ): Promise<{ geoJson: any; source: string; error?: string }> {
    const start = Date.now();
    try {
      const rows = await this.osmDb.findBuildingsInBounds(bounds);
      if (rows.length > 0) {
        const features = rows.map((r) => ({
          type: 'Feature',
          geometry: r.geometry,
          properties: {
            id: r.osm_id,
            name: r.name,
            building: r.building,
            height: r.height_meters,
            levels: r.levels,
          },
        }));
        const geoJson = { type: 'FeatureCollection', features };

        if (DEBUG_MAP_LOCAL) {
          this.logger.log(`[local-osm-buildings]`, {
            bounds,
            count: features.length,
            durationMs: Date.now() - start,
            source: 'local-osm',
          });
        }

        return { geoJson, source: 'local-osm' };
      }
    } catch (err: any) {
      this.logger.warn(
        `[local-osm-buildings] query failed: ${err.message}, falling back to Overpass`,
      );
    }

    // Fallback to Overpass
    try {
      const overpassResult = await this.fetchAndProcessBuildings(bounds);
      return { geoJson: overpassResult, source: 'overpass' };
    } catch (err: any) {
      return {
        geoJson: { type: 'FeatureCollection', features: [] },
        source: 'fallback',
        error: (err as Error).message,
      };
    }
  }

  private async fetchAndProcessBuildings(bounds: LocalMapBounds): Promise<any> {
    const buildingRaw = await this.overpassService.fetchBuildings(bounds);
    const elemCount = buildingRaw.elements?.length ?? 0;
    if (DEBUG_OSM_QUERIES) {
      this.logger.log(`[overpass] buildings raw elements count: ${elemCount}`);
    }
    const geoJson = osmtogeojson(buildingRaw);
    if (DEBUG_OSM_QUERIES) {
      this.logger.log(
        `[overpass] building GeoJSON features: ${geoJson.features?.length ?? 0}`,
      );
    }
    const slimmed = slimBuildings(geoJson);
    if (DEBUG_OSM_QUERIES) {
      this.logger.log(
        `[overpass] after slimming: buildings=${slimmed.features?.length ?? 0}`,
      );
    }
    return slimmed;
  }

  private async fetchPoisLocalFirst(
    centerLat: number,
    centerLng: number,
  ): Promise<{ pois: LocalPoi[]; source: string; error?: string }> {
    const start = Date.now();
    const bounds = createBoundsFromCenter(centerLat, centerLng, 1500);

    const CATEGORY_WEIGHTS: Record<string, number> = {
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

    try {
      const rows = await this.osmDb.findPoisInBounds(bounds, {
        lat: centerLat,
        lng: centerLng,
      });
      if (rows.length > 0) {
        const pois: LocalPoi[] = rows.map((r) => ({
          id: r.osm_id,
          name: r.name,
          category: r.poi_category as any,
          type: r.poi_type,
          lat: r.lat,
          lng: r.lng,
          tags: (r.tags ?? {}) as Record<string, string>,
          importance: CATEGORY_WEIGHTS[r.poi_category] ?? 1,
          distanceFromCenterKm:
            r.distance_from_center_km ?? undefined,
        }));

        const deduped = deduplicatePois(pois);
        const limited = scoreAndLimitPois(deduped, centerLat, centerLng, 8);

        if (DEBUG_MAP_LOCAL) {
          this.logger.log(`[local-osm-pois]`, {
            bounds,
            rawCount: rows.length,
            returnedCount: limited.length,
            durationMs: Date.now() - start,
            source: 'local-osm',
          });
        }

        return { pois: limited, source: 'local-osm' };
      }
    } catch (err: any) {
      this.logger.warn(
        `[local-osm-pois] query failed: ${err.message}, falling back to Overpass`,
      );
    }

    // Fallback to Overpass
    try {
      const rawOverpass = await this.overpassService.fetchPois(bounds);
      const parsed = parseOverpassPois(rawOverpass);
      const deduped = deduplicatePois(parsed);
      const limited = scoreAndLimitPois(deduped, centerLat, centerLng, 8);
      return { pois: limited, source: 'overpass' };
    } catch (err: any) {
      return {
        pois: [],
        source: 'fallback',
        error: err.message,
      };
    }
  }

  private async fetchAndProcessRoads(bounds: LocalMapBounds): Promise<any> {
    const roadRaw = await this.overpassService.fetchRoads(bounds);
    const elemCount = roadRaw.elements?.length ?? 0;
    if (DEBUG_OSM_QUERIES) {
      this.logger.log(`[overpass] roads raw elements count: ${elemCount}`);
    }
    const geoJson = osmtogeojson(roadRaw);
    if (DEBUG_OSM_QUERIES) {
      this.logger.log(
        `[overpass] road GeoJSON features: ${geoJson.features?.length ?? 0}`,
      );
    }
    const slimmed = slimRoads(geoJson);
    if (DEBUG_OSM_QUERIES) {
      this.logger.log(
        `[overpass] after slimming: roads=${slimmed.features?.length ?? 0}`,
      );
    }
    return slimmed;
  }

  private async fetchRoadsLocalFirst(
    bounds: LocalMapBounds,
  ): Promise<{ geoJson: any; source: string; error?: string }> {
    const start = Date.now();
    try {
      const roadRows = await this.osmDb.findRoadsInBounds(bounds);
      if (roadRows.length > 0) {
        const features = roadRows.map((r) => ({
          type: 'Feature',
          geometry: r.geometry,
          properties: {
            id: r.osm_id,
            name: r.name,
            highway: r.highway,
            surface: r.surface,
            oneway: r.oneway,
            bridge: r.bridge,
            tunnel: r.tunnel,
          },
        }));
        const geoJson = { type: 'FeatureCollection', features };

        if (DEBUG_MAP_LOCAL) {
          this.logger.log(`[local-osm-roads]`, {
            bounds,
            count: features.length,
            durationMs: Date.now() - start,
            source: 'local-osm',
          });
        }

        return { geoJson, source: 'local-osm' };
      }
    } catch (err: any) {
      this.logger.warn(
        `[local-osm-roads] query failed: ${err.message}, falling back to Overpass`,
      );
    }

    // Fallback to Overpass
    try {
      const overpassResult = await this.fetchAndProcessRoads(bounds);
      return { geoJson: overpassResult, source: 'overpass' };
    } catch (err: any) {
      return {
        geoJson: { type: 'FeatureCollection', features: [] },
        source: 'fallback',
        error: err.message,
      };
    }
  }

  async getOverviewRoadsByBbox(params: {
    minLng: number;
    minLat: number;
    maxLng: number;
    maxLat: number;
    limit?: number;
    simplify?: boolean;
    mode?: 'local' | 'regional';
  }): Promise<{
    source: string;
    mode: string;
    roads: { type: 'FeatureCollection'; features: any[] };
    diagnostics: {
      bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number };
      featureCount: number;
      limit: number;
      simplified: boolean;
      mode: string;
      queryMs: number;
    };
  }> {
    const start = Date.now();
    const { minLng, minLat, maxLng, maxLat, limit = 2000, simplify = true, mode = 'local' } = params;

    const bounds: LocalMapBounds = {
      north: maxLat,
      south: minLat,
      east: maxLng,
      west: minLng,
    };

    const roadRows = await this.osmDb.findOverviewRoadsInBounds(bounds, { limit, simplify, mode });

    const features = roadRows.map((r) => ({
      type: 'Feature',
      geometry: r.geometry,
      properties: {
        id: r.osm_id,
        name: r.name,
        highway: r.highway,
        surface: r.surface,
        oneway: r.oneway,
        bridge: r.bridge,
        tunnel: r.tunnel,
      },
    }));

    const roads: { type: 'FeatureCollection'; features: any[] } = {
      type: 'FeatureCollection',
      features,
    };

    return {
      source: 'local-osm',
      mode,
      roads,
      diagnostics: {
        bbox: { minLng, minLat, maxLng, maxLat },
        featureCount: features.length,
        limit,
        simplified: simplify,
        mode,
        queryMs: Date.now() - start,
      },
    };
  }

  async getOverviewPlacesByBbox(params: {
    minLng: number;
    minLat: number;
    maxLng: number;
    maxLat: number;
    limit?: number;
    mode?: 'local' | 'regional';
  }): Promise<{
    source: string;
    mode: string;
    places: { name: string; type: string; lat: number; lng: number; importance: number }[];
    diagnostics: {
      bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number };
      placeCount: number;
      limit: number;
      mode: string;
      queryMs: number;
    };
  }> {
    const start = Date.now();
    const { minLng, minLat, maxLng, maxLat, limit = 20, mode = 'local' } = params;

    const bounds: LocalMapBounds = {
      north: maxLat,
      south: minLat,
      east: maxLng,
      west: minLng,
    };

    const rows = await this.osmDb.findOverviewPlacesInBounds(bounds, { limit, mode });

    const typeImportance: Record<string, number> = {
      city: 10,
      town: 8,
      suburb: 6,
      locality: 5,
      neighbourhood: 4,
      neighborhood: 4,
      quarter: 4,
      city_district: 3,
      district: 3,
      village: 2,
    };

    const seen = new Set<string>();
    const places: { name: string; type: string; lat: number; lng: number; importance: number }[] = [];

    for (const row of rows) {
      const key = row.name.toLowerCase().trim().replace(/\s+/g, ' ');
      if (seen.has(key)) continue;
      seen.add(key);
      places.push({
        name: row.name,
        type: row.place_type,
        lat: row.lat,
        lng: row.lng,
        importance: typeImportance[row.place_type] ?? 1,
      });
    }

    return {
      source: 'local-osm',
      mode,
      places,
      diagnostics: {
        bbox: { minLng, minLat, maxLng, maxLat },
        placeCount: places.length,
        limit,
        mode,
        queryMs: Date.now() - start,
      },
    };
  }

  async clearLocalMapCache(): Promise<number> {
    const pattern = 'local-map:*';
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
    this.logger.log(
      `[map/cache] cleared ${keys.length} keys matching ${pattern}`,
    );
    return keys.length;
  }

  async clearRouteContextCache(): Promise<number> {
    const pattern = 'route-context:*';
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
    this.logger.log(
      `[map/cache] cleared ${keys.length} keys matching ${pattern}`,
    );
    return keys.length;
  }

  async debugOverpass(
    lat: number,
    lng: number,
    radiusMeters: number,
  ): Promise<any> {
    const bounds = createBoundsFromCenter(lat, lng, radiusMeters);

    const buildingQuery = `[out:json][timeout:15];
(
  way["building"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
);
out body;
>;
out body;`;

    const roadQuery = `[out:json][timeout:15];
(
  way["highway"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
);
out body;
>;
out body;`;

    let buildingRaw: any = null;
    let roadRaw: any = null;
    let error: string | undefined;

    try {
      [buildingRaw, roadRaw] = await Promise.all([
        this.overpassService.fetchRaw(buildingQuery),
        this.overpassService.fetchRaw(roadQuery),
      ]);
    } catch (err: any) {
      error = err.message;
    }

    return {
      bounds,
      buildingRawElements: buildingRaw?.elements?.length ?? 0,
      roadRawElements: roadRaw?.elements?.length ?? 0,
      buildingGeoJsonFeatures: buildingRaw
        ? (osmtogeojson(buildingRaw).features?.length ?? 0)
        : 0,
      roadGeoJsonFeatures: roadRaw
        ? (osmtogeojson(roadRaw).features?.length ?? 0)
        : 0,
      buildingQuery,
      roadQuery,
      error,
    };
  }

  async getRouteContext(
    dto: RouteContextQueryDto,
  ): Promise<RouteContextResponse> {
    const routePoints = dto.routePoints;
    const routeDistanceKm = dto.routeDistanceKm ?? 0;

    if (routePoints.length < 2) {
      return {
        places: [],
        diagnostics: {
          routeDistanceKm,
          rawPlaces: 0,
          filteredPlaces: 0,
          beforeDedup: 0,
          afterDedup: 0,
        },
      };
    }

    const bounds = this.computeRouteBounds(routePoints);
    const cacheKey = `route-context:v2-local-osm:${bounds.north.toFixed(3)},${bounds.south.toFixed(3)},${bounds.east.toFixed(3)},${bounds.west.toFixed(3)}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.logger.log(`[route-context] cache hit: ${cacheKey}`);
      return JSON.parse(cached);
    }

    this.logger.log(
      `[route-context] fetching for route distance ${routeDistanceKm}km`,
    );

    if (routePoints.length <= 2) {
      this.logger.warn(
        `[route-context] only ${routePoints.length} route points received; routeProgress may be approximate`,
      );
    }

    // --- Try local OSM first ---
    const corridorKm = this.getCorridorKm(routeDistanceKm);
    const placeTypes = this.getPlaceTypesForDistance(routeDistanceKm);
    let selected: RouteContextPlace[] = [];
    let source: 'local-osm' | 'overpass' | 'fallback' = 'fallback';
    let rawCount = 0;
    let filteredCount = 0;
    let dedupBefore = 0;
    let dedupAfter = 0;

    if (DEBUG_ROUTE_CONTEXT) {
      this.logger.log(`[local-osm-route-context-input]`, {
        routePointsLength: routePoints.length,
        routeDistanceKm,
        corridorKm,
      });
    }

    // --- Local OSM query, with optional broader type fallback ---
    let usedPlaceTypes = placeTypes;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const candidates = await this.osmDb.findPlacesAlongRoute({
          routePoints,
          routeDistanceKm,
          corridorKm,
          placeTypes: usedPlaceTypes,
        });

        rawCount = candidates.length;

        const minP = candidates.reduce(
          (m, c) => Math.min(m, c.route_progress),
          1,
        );
        const maxP = candidates.reduce(
          (m, c) => Math.max(m, c.route_progress),
          0,
        );

        if (DEBUG_ROUTE_CONTEXT) {
          this.logger.log(`[local-osm-route-context-route]`, {
            routePointsLength: routePoints.length,
            firstPoint: routePoints[0],
            lastPoint: routePoints[routePoints.length - 1],
            minProgress: minP,
            maxProgress: maxP,
          });

          this.logger.log(`[local-osm-route-context-candidates]`, {
            rawCandidates: rawCount,
            sample: candidates.slice(0, 20).map((c) => ({
              name: c.name,
              type: c.place_type,
              routeProgress: c.route_progress,
              distanceToRouteKm: c.distance_to_route_km,
            })),
          });
        }

        if (candidates.length > 0) {
          const hist = this.computeProgressHistogram(candidates);
          if (DEBUG_ROUTE_CONTEXT) {
            this.logger.log(`[local-osm-route-context-progress-histogram]`, hist);
          }

          const places = candidates.map((c) => ({
            id: c.osm_id || String(c.id),
            name: c.name,
            type: c.place_type,
            lat: c.lat,
            lng: c.lng,
            state: c.state || undefined,
            distanceToRouteKm: c.distance_to_route_km,
            routeProgress: c.route_progress,
            importance: this.getPlaceImportance(c.place_type),
          }));

          const bucketResult = this.selectPlacesFromBuckets(
            places,
            routeDistanceKm,
          );
          dedupBefore = bucketResult.beforeDedup;
          dedupAfter = bucketResult.afterDedup;
          filteredCount = bucketResult.filteredCount;
          selected = bucketResult.places;
          source = 'local-osm';

          // If long route and too few buckets filled, retry with broader types
          if (routeDistanceKm > 100 && selected.length < 3 && attempt === 0) {
            if (DEBUG_ROUTE_CONTEXT) {
              this.logger.log(
                `[route-context] only ${selected.length} selected with narrow types, retrying with broader types`,
              );
            }
            selected = [];
            source = 'fallback';
            usedPlaceTypes = [
              'city',
              'town',
              'suburb',
              'locality',
              'neighbourhood',
              'quarter',
            ];
            continue;
          }

          if (DEBUG_ROUTE_CONTEXT) {
            this.logger.log(`[local-osm-route-context-selected]`, {
              selected: selected.map((p) => ({
                name: p.name,
                type: p.type,
                routeProgress: p.routeProgress,
                distanceToRouteKm: p.distanceToRouteKm,
                lat: p.lat,
                lng: p.lng,
              })),
            });
          }
        }
        break;
      } catch (err: any) {
        if (attempt === 1) {
          this.logger.warn(
            `[route-context] local OSM query failed: ${err.message}`,
          );
        } else {
          usedPlaceTypes = [
            'city',
            'town',
            'suburb',
            'locality',
            'neighbourhood',
            'quarter',
          ];
        }
      }
    }

    // --- Fallback to Overpass if OSM returned nothing ---
    const localOsmFailed = selected.length === 0 && rawCount > 0;
    if (localOsmFailed) {
      this.logger.log(
        `[route-context] local OSM returned ${rawCount} candidates but none selected — reason: no_bucket_candidates`,
      );
    }

    if (selected.length === 0) {
      this.logger.log(
        `[route-context] local OSM returned nothing — falling back to Overpass`,
      );
      try {
        const isLocalRoute = routeDistanceKm <= 30;
        const rawOverpass = await this.overpassService.fetchPlaces(
          bounds,
          isLocalRoute,
        );
        const rawPlaces = this.parseOverpassPlaces(rawOverpass);
        rawCount = rawPlaces.length;
        if (DEBUG_OSM_QUERIES) {
          this.logger.log(
            `[route-context] raw overpass places: ${rawPlaces.length}`,
          );
        }

        const maxDistanceKm = this.getMaxDistanceForRoute(routeDistanceKm);
        const projected = this.computePlaceProjections(
          rawPlaces,
          routePoints,
          maxDistanceKm,
        );
        filteredCount = projected.length;
        if (DEBUG_OSM_QUERIES) {
          this.logger.log(
            `[route-context] after distance filter (<=${maxDistanceKm}km): ${projected.length}`,
          );
        }

        const localFiltered = this.applyLocalRouteFilter(
          projected,
          routePoints,
          isLocalRoute,
          routeDistanceKm,
        );
        dedupBefore = localFiltered.length;

        const deduped = this.deduplicatePlaces(localFiltered);
        dedupAfter = deduped.length;
        if (DEBUG_OSM_QUERIES) {
          this.logger.log(`[route-context] after dedup: ${deduped.length}`);
        }

        const sorted = this.sortByRouteProgress(deduped);
        selected = dto.maxLabels ? sorted.slice(0, dto.maxLabels) : sorted;
        source = 'overpass';
      } catch (err: any) {
        this.logger.error(
          `[route-context] Overpass fallback also failed: ${err.message}`,
        );
      }
    }

    // Only cache if we have selected places or didn't even get candidates
    const shouldCache = selected.length > 0 || rawCount === 0;

    if (shouldCache) {
      const result: RouteContextResponse = {
        places: selected,
        diagnostics: {
          routeDistanceKm,
          rawPlaces: rawCount,
          filteredPlaces: filteredCount,
          beforeDedup: dedupBefore,
          afterDedup: dedupAfter,
        },
      };

      await this.redis.setex(
        cacheKey,
        3600,
        JSON.stringify({ ...result, source }),
      );
      this.logger.log(`[route-context] cached (source=${source}): ${cacheKey}`);
    } else {
      this.logger.log(
        `[route-context] NOT caching — local OSM had ${rawCount} candidates but 0 selected`,
      );
    }

    return {
      places: selected,
      diagnostics: {
        routeDistanceKm,
        rawPlaces: rawCount,
        filteredPlaces: filteredCount,
        beforeDedup: dedupBefore,
        afterDedup: dedupAfter,
      },
    };
  }

  private computeRouteBounds(
    points: { lat: number; lng: number }[],
  ): LocalMapBounds {
    let minLat = Infinity,
      maxLat = -Infinity,
      minLng = Infinity,
      maxLng = -Infinity;
    for (const p of points) {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLng = Math.min(minLng, p.lng);
      maxLng = Math.max(maxLng, p.lng);
    }
    const padding = 0.05;
    return {
      north: maxLat + padding,
      south: minLat - padding,
      east: maxLng + padding,
      west: minLng - padding,
    };
  }

  private getMaxDistanceForRoute(routeDistanceKm: number): number {
    return Math.min(5 + routeDistanceKm * 0.25, 60);
  }

  private parseOverpassPlaces(overpassResult: any): RouteContextPlace[] {
    const places: RouteContextPlace[] = [];
    const elements = overpassResult?.elements ?? [];

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

      const tags = el.tags ?? {};
      const name = tags.name;
      if (!name) continue;

      const placeType = tags.place ?? tags.boundary ?? 'unknown';

      places.push({
        id: String(el.id),
        name,
        type: placeType,
        lat,
        lng,
        distanceToRouteKm: 0,
        routeProgress: 0,
        importance: this.getPlaceImportance(placeType),
      });
    }

    return places;
  }

  private getPlaceImportance(type: string): number {
    const weights: Record<string, number> = {
      city: 10,
      town: 8,
      suburb: 6,
      locality: 5,
      neighbourhood: 4,
      quarter: 4,
      village: 2,
    };
    return weights[type] ?? 1;
  }

  private getCorridorKm(routeDistanceKm: number): number {
    if (routeDistanceKm <= 20) return 5;
    if (routeDistanceKm <= 100) return 15;
    return 35;
  }

  private getPlaceTypesForDistance(routeDistanceKm: number): string[] {
    if (routeDistanceKm <= 20) {
      return ['city', 'town', 'suburb', 'neighbourhood', 'quarter', 'locality'];
    }
    if (routeDistanceKm <= 100) {
      return ['city', 'town', 'suburb', 'locality'];
    }
    return ['city', 'town', 'suburb', 'locality'];
  }

  private selectPlacesFromBuckets(
    places: RouteContextPlace[],
    routeDistanceKm: number,
  ): {
    places: RouteContextPlace[];
    beforeDedup: number;
    afterDedup: number;
    filteredCount: number;
  } {
    const deduped = this.deduplicatePlaces(places);
    const filteredCount = places.length;

    if (routeDistanceKm <= 20) {
      const sorted = this.sortByRouteProgress(deduped);
      const result: RouteContextPlace[] = [];
      let lastProgress = -Infinity;
      const minSep = 0.12;
      const maxPlaces = 5;
      for (const place of sorted) {
        if (place.routeProgress - lastProgress >= minSep) {
          result.push(place);
          lastProgress = place.routeProgress;
          if (result.length >= maxPlaces) break;
        }
      }
      return {
        places: result,
        beforeDedup: places.length,
        afterDedup: deduped.length,
        filteredCount,
      };
    }

    const buckets = [
      { min: 0.05, max: 0.2 },
      { min: 0.2, max: 0.4 },
      { min: 0.4, max: 0.6 },
      { min: 0.6, max: 0.8 },
      { min: 0.8, max: 0.95 },
    ];

    const nameSeen = new Set<string>();
    const selected: RouteContextPlace[] = [];

    for (const bucket of buckets) {
      const candidates = deduped.filter(
        (p) => p.routeProgress >= bucket.min && p.routeProgress < bucket.max,
      );
      if (candidates.length === 0) continue;

      candidates.sort((a, b) => {
        const impA = a.importance ?? 0;
        const impB = b.importance ?? 0;
        if (impB !== impA) return impB - impA;
        if (a.distanceToRouteKm !== b.distanceToRouteKm) {
          return a.distanceToRouteKm - b.distanceToRouteKm;
        }
        return (a.name || '').localeCompare(b.name || '');
      });

      for (const candidate of candidates) {
        const key = candidate.name?.toLowerCase().trim();
        if (key && nameSeen.has(key)) continue;
        if (key) nameSeen.add(key);
        selected.push(candidate);
        break;
      }
    }

    selected.sort((a, b) => a.routeProgress - b.routeProgress);

    return {
      places: selected,
      beforeDedup: places.length,
      afterDedup: deduped.length,
      filteredCount,
    };
  }

  private computeProgressHistogram(candidates: { route_progress: number }[]): {
    total: number;
    buckets: { range: string; count: number }[];
  } {
    const ranges = [
      { label: '0.00-0.05', min: 0, max: 0.05 },
      { label: '0.05-0.20', min: 0.05, max: 0.2 },
      { label: '0.20-0.40', min: 0.2, max: 0.4 },
      { label: '0.40-0.60', min: 0.4, max: 0.6 },
      { label: '0.60-0.80', min: 0.6, max: 0.8 },
      { label: '0.80-0.95', min: 0.8, max: 0.95 },
      { label: '0.95-1.00', min: 0.95, max: 1 },
    ];
    const buckets = ranges.map((r) => ({
      range: r.label,
      count: candidates.filter(
        (c) => c.route_progress >= r.min && c.route_progress < r.max,
      ).length,
    }));
    return { total: candidates.length, buckets };
  }

  private computePlaceProjections(
    places: RouteContextPlace[],
    routePoints: { lat: number; lng: number }[],
    maxDistanceKm: number,
  ): RouteContextPlace[] {
    if (routePoints.length < 2) return [];

    const origin = routePoints[0];
    const originLatRad = (origin.lat * Math.PI) / 180;
    const latKmPerDeg = 111.32;
    const lngKmPerDeg = 111.32 * Math.cos(originLatRad);

    const toKm = (p: { lat: number; lng: number }) => ({
      x: (p.lng - origin.lng) * lngKmPerDeg,
      y: (p.lat - origin.lat) * latKmPerDeg,
    });

    // Precompute segment endpoints in km and cumulative segment lengths
    const segs: {
      ax: number;
      ay: number;
      bx: number;
      by: number;
      length: number;
    }[] = [];
    let totalRouteKm = 0;
    for (let i = 0; i < routePoints.length - 1; i++) {
      const a = toKm(routePoints[i]);
      const b = toKm(routePoints[i + 1]);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, length: len });
      totalRouteKm += len;
    }

    if (totalRouteKm === 0) return [];

    const result: RouteContextPlace[] = [];

    for (const place of places) {
      const p = toKm(place);
      let bestDist = Infinity;
      let bestIdx = -1;
      let bestT = 0;
      let cumDistBefore = 0;
      let bestDistAlongRoute = 0;

      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        const abx = seg.bx - seg.ax;
        const aby = seg.by - seg.ay;
        const lenSq = abx * abx + aby * aby;

        let t =
          lenSq === 0
            ? 0
            : ((p.x - seg.ax) * abx + (p.y - seg.ay) * aby) / lenSq;
        t = Math.max(0, Math.min(1, t));

        const projX = seg.ax + t * abx;
        const projY = seg.ay + t * aby;
        const dx = p.x - projX;
        const dy = p.y - projY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
          bestT = t;
          bestDistAlongRoute = cumDistBefore + t * seg.length;
        }

        cumDistBefore += seg.length;
      }

      if (bestDist <= maxDistanceKm) {
        place.distanceToRouteKm = bestDist;
        place.routeProgress = Math.max(
          0,
          Math.min(1, bestDistAlongRoute / totalRouteKm),
        );
        result.push(place);
      }
    }

    return result;
  }

  private applyLocalRouteFilter(
    places: RouteContextPlace[],
    routePoints: { lat: number; lng: number }[],
    isLocalRoute: boolean,
    routeDistanceKm: number,
  ): RouteContextPlace[] {
    if (!isLocalRoute || routeDistanceKm > 20) return [...places];
    if (places.length === 0) return [];

    const pickup = routePoints[0];
    const destination = routePoints[routePoints.length - 1];

    const cleaned = places.filter((p) => {
      if (p.routeProgress < 0.02) {
        const distToPickup = this.haversineKm(
          p.lat,
          p.lng,
          pickup.lat,
          pickup.lng,
        );
        if (distToPickup > 1.5) return false;
      }
      if (p.routeProgress > 0.98) {
        const distToDest = this.haversineKm(
          p.lat,
          p.lng,
          destination.lat,
          destination.lng,
        );
        if (distToDest > 1.5) return false;
      }
      return true;
    });

    if (cleaned.length === 0) return [];

    const sorted = [...cleaned].sort(
      (a, b) => a.routeProgress - b.routeProgress,
    );
    const result: RouteContextPlace[] = [];
    let lastProgress = -Infinity;
    const minSep = 0.15;
    const maxPlaces = 5;

    for (const place of sorted) {
      if (place.routeProgress - lastProgress >= minSep) {
        result.push(place);
        lastProgress = place.routeProgress;
        if (result.length >= maxPlaces) break;
      }
    }

    return result;
  }

  private haversineKm(
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

  private deduplicatePlaces(places: RouteContextPlace[]): RouteContextPlace[] {
    const normalized = new Map<string, RouteContextPlace>();

    for (const place of places) {
      const key = this.normalizeName(place.name);
      const existing = normalized.get(key);

      if (!existing) {
        normalized.set(key, place);
      } else {
        const keep = this.chooseBetterPlace(place, existing);
        normalized.set(key, keep);
      }
    }

    return Array.from(normalized.values());
  }

  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ');
  }

  private chooseBetterPlace(
    a: RouteContextPlace,
    b: RouteContextPlace,
  ): RouteContextPlace {
    if (a.distanceToRouteKm < b.distanceToRouteKm - 0.5) return a;
    if (b.distanceToRouteKm < a.distanceToRouteKm - 0.5) return b;
    if ((a.importance ?? 0) > (b.importance ?? 0)) return a;
    return b;
  }

  private sortByRouteProgress(
    places: RouteContextPlace[],
  ): RouteContextPlace[] {
    return [...places].sort((a, b) => a.routeProgress - b.routeProgress);
  }
}
