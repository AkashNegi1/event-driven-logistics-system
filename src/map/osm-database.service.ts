import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, QueryResult } from 'pg';

interface RoutePoint {
  lat: number;
  lng: number;
}

interface LocalMapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

interface RoadFeature {
  osm_id: string;
  name: string | null;
  highway: string | null;
  surface: string | null;
  oneway: boolean | null;
  bridge: string | null;
  tunnel: string | null;
  geometry: Record<string, unknown>;
}

interface PoiRow {
  osm_id: string;
  osm_type: string;
  name: string;
  poi_category: string;
  poi_type: string;
  tags: Record<string, unknown> | null;
  lat: number;
  lng: number;
  distance_from_center_km: number | null;
}

interface BuildingRow {
  osm_id: string;
  name: string | null;
  building: string | null;
  height_meters: number | null;
  levels: number | null;
  geometry: Record<string, unknown>;
}

interface OverviewPlaceRow {
  name: string;
  place_type: string;
  state: string | null;
  lat: number;
  lng: number;
}

interface PlaceAlongRoute {
  id: string;
  osm_id: string;
  osm_type: string;
  name: string;
  place_type: string;
  state: string | null;
  lat: number;
  lng: number;
  distance_to_route_km: number;
  route_progress: number;
}

@Injectable()
export class OsmDatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(OsmDatabaseService.name);
  private pool: Pool;

  constructor(private readonly configService: ConfigService) {
    const url = this.configService.get<string>('OSM_DATABASE_URL');
    if (!url) {
      this.logger.warn('OSM_DATABASE_URL not set — OSM queries will fail');
      this.pool = new Pool();
      return;
    }
    this.pool = new Pool({ connectionString: url });
    this.logger.log('Connected OSM database pool');
  }

  async query(text: string, params?: any[]): Promise<QueryResult> {
    return this.pool.query(text, params);
  }

  async findRoadsInBounds(bounds: LocalMapBounds): Promise<RoadFeature[]> {
    const { north, south, east, west } = bounds;

    const sql = `
      SELECT
        osm_id,
        name,
        highway,
        surface,
        oneway,
        bridge,
        tunnel,
        ST_AsGeoJSON(geom)::jsonb AS geometry
      FROM osm_roads
      WHERE ST_Intersects(
        geom,
        ST_MakeEnvelope($1, $2, $3, $4, 4326)
      )
      ORDER BY
        CASE highway
          WHEN 'motorway' THEN 1
          WHEN 'trunk' THEN 2
          WHEN 'primary' THEN 3
          WHEN 'secondary' THEN 4
          WHEN 'tertiary' THEN 5
          WHEN 'residential' THEN 6
          WHEN 'unclassified' THEN 7
          WHEN 'service' THEN 8
          ELSE 9
        END
      LIMIT 2000
    `;

    const result = await this.pool.query(sql, [west, south, east, north]);
    return result.rows.map((r: Record<string, unknown>) => ({
      osm_id: r.osm_id as string,
      name: r.name as string | null,
      highway: r.highway as string | null,
      surface: r.surface as string | null,
      oneway: r.oneway as boolean | null,
      bridge: r.bridge as string | null,
      tunnel: r.tunnel as string | null,
      geometry: r.geometry as Record<string, unknown>,
    }));
  }

  async findPoisInBounds(
    bounds: LocalMapBounds,
    center?: { lat: number; lng: number },
  ): Promise<PoiRow[]> {
    const { north, south, east, west } = bounds;

    const distanceSelect = center
      ? `ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(${center.lng}, ${center.lat}), 4326)::geography) / 1000 AS distance_from_center_km`
      : `NULL AS distance_from_center_km`;

    const sql = `
      SELECT
        osm_id,
        osm_type,
        name,
        poi_category,
        poi_type,
        tags,
        ST_Y(geom) AS lat,
        ST_X(geom) AS lng,
        ${distanceSelect}
      FROM osm_pois
      WHERE ST_Intersects(
        geom,
        ST_MakeEnvelope($1, $2, $3, $4, 4326)
      )
      ORDER BY
        CASE poi_category
          WHEN 'locality' THEN 1
          WHEN 'landmark' THEN 2
          WHEN 'transport' THEN 3
          WHEN 'hospital' THEN 4
          WHEN 'fuel' THEN 5
          WHEN 'market' THEN 6
          WHEN 'police' THEN 7
          WHEN 'education' THEN 8
          WHEN 'bank' THEN 9
          WHEN 'food' THEN 10
          ELSE 11
        END,
        distance_from_center_km ASC
      LIMIT 300
    `;

    const result = await this.pool.query(sql, [west, south, east, north]);
    return result.rows.map((r: Record<string, unknown>) => ({
      osm_id: r.osm_id as string,
      osm_type: r.osm_type as string,
      name: r.name as string,
      poi_category: r.poi_category as string,
      poi_type: r.poi_type as string,
      tags: r.tags as Record<string, unknown> | null,
      lat: Number(r.lat),
      lng: Number(r.lng),
      distance_from_center_km:
        r.distance_from_center_km != null
          ? Number(r.distance_from_center_km)
          : null,
    }));
  }

  async findBuildingsInBounds(bounds: LocalMapBounds): Promise<BuildingRow[]> {
    const { north, south, east, west } = bounds;

    const sql = `
      SELECT
        osm_id,
        name,
        building,
        height_meters,
        levels,
        ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.0001))::jsonb AS geometry
      FROM osm_buildings
      WHERE ST_Intersects(
        geom,
        ST_MakeEnvelope($1, $2, $3, $4, 4326)
      )
      ORDER BY height_meters DESC NULLS LAST
      LIMIT 1500
    `;

    const result = await this.pool.query(sql, [west, south, east, north]);
    return result.rows.map((r: Record<string, unknown>) => ({
      osm_id: r.osm_id as string,
      name: r.name as string | null,
      building: r.building as string | null,
      height_meters: r.height_meters != null ? Number(r.height_meters) : null,
      levels: r.levels != null ? Number(r.levels) : null,
      geometry: r.geometry as Record<string, unknown>,
    }));
  }

  async findOverviewRoadsInBounds(
    bounds: LocalMapBounds,
    options?: { limit?: number; simplify?: boolean; mode?: 'local' | 'regional' },
  ): Promise<RoadFeature[]> {
    const { north, south, east, west } = bounds;
    const limit = options?.limit ?? 2000;
    const simplify = options?.simplify !== false;
    const mode = options?.mode ?? 'local';

    const geomExpr = simplify
      ? `ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.0001))::jsonb AS geometry`
      : `ST_AsGeoJSON(geom)::jsonb AS geometry`;

    const highwayFilter = mode === 'regional'
      ? `AND highway IN ('motorway', 'trunk', 'primary', 'secondary', 'tertiary')`
      : '';

    const orderExpr = mode === 'regional'
      ? `CASE highway
          WHEN 'motorway' THEN 1
          WHEN 'trunk' THEN 2
          WHEN 'primary' THEN 3
          WHEN 'secondary' THEN 4
          WHEN 'tertiary' THEN 5
          ELSE 6
        END`
      : `CASE highway
          WHEN 'motorway' THEN 1
          WHEN 'trunk' THEN 2
          WHEN 'primary' THEN 3
          WHEN 'secondary' THEN 4
          WHEN 'tertiary' THEN 5
          WHEN 'residential' THEN 6
          WHEN 'unclassified' THEN 7
          WHEN 'service' THEN 8
          ELSE 9
        END`;

    const sql = `
      SELECT
        osm_id,
        name,
        highway,
        surface,
        oneway,
        bridge,
        tunnel,
        ${geomExpr}
      FROM osm_roads
      WHERE ST_Intersects(
        geom,
        ST_MakeEnvelope($1, $2, $3, $4, 4326)
      )
      ${highwayFilter}
      ORDER BY ${orderExpr}
      LIMIT ${limit}
    `;

    const result = await this.pool.query(sql, [west, south, east, north]);
    return result.rows.map((r: Record<string, unknown>) => ({
      osm_id: r.osm_id as string,
      name: r.name as string | null,
      highway: r.highway as string | null,
      surface: r.surface as string | null,
      oneway: r.oneway as boolean | null,
      bridge: r.bridge as string | null,
      tunnel: r.tunnel as string | null,
      geometry: r.geometry as Record<string, unknown>,
    }));
  }

  async findOverviewPlacesInBounds(
    bounds: LocalMapBounds,
    options?: { limit?: number; mode?: 'local' | 'regional' },
  ): Promise<OverviewPlaceRow[]> {
    const { north, south, east, west } = bounds;
    const limit = options?.limit ?? 20;
    const mode = options?.mode ?? 'local';

    const preferredTypes = mode === 'regional'
      ? ['city', 'town', 'city_district', 'district']
      : ['city', 'town', 'suburb', 'locality', 'neighbourhood',
         'neighborhood', 'quarter', 'city_district', 'district',
         'village'];

    const orderExpr = mode === 'regional'
      ? `CASE place_type
          WHEN 'city' THEN 1
          WHEN 'town' THEN 2
          WHEN 'city_district' THEN 3
          WHEN 'district' THEN 4
          ELSE 5
        END`
      : `CASE place_type
          WHEN 'city' THEN 1
          WHEN 'town' THEN 2
          WHEN 'suburb' THEN 3
          WHEN 'locality' THEN 4
          WHEN 'neighbourhood' THEN 5
          WHEN 'quarter' THEN 6
          WHEN 'city_district' THEN 7
          WHEN 'district' THEN 8
          WHEN 'village' THEN 9
          ELSE 10
        END`;

    const sql = `
      SELECT
        name,
        place_type,
        state,
        ST_Y(geom) AS lat,
        ST_X(geom) AS lng
      FROM osm_places
      WHERE name IS NOT NULL
      AND name != ''
      AND ST_Intersects(
        geom,
        ST_MakeEnvelope($1, $2, $3, $4, 4326)
      )
      AND place_type = ANY($5::text[])
      ORDER BY ${orderExpr}, name ASC
      LIMIT ${limit}
    `;

    const result = await this.pool.query(sql, [
      west, south, east, north, preferredTypes,
    ]);

    return result.rows.map((r: Record<string, unknown>) => ({
      name: r.name as string,
      place_type: r.place_type as string,
      state: r.state as string | null,
      lat: Number(r.lat),
      lng: Number(r.lng),
    }));
  }

  async findPlacesAlongRoute(params: {
    routePoints: RoutePoint[];
    routeDistanceKm: number;
    corridorKm: number;
    placeTypes: string[];
    limit?: number;
  }): Promise<PlaceAlongRoute[]> {
    const { routePoints, corridorKm, placeTypes, limit = 5000 } = params;

    if (routePoints.length < 2) return [];

    const pointsSql = routePoints
      .map((p) => `ST_MakePoint(${p.lng}, ${p.lat})`)
      .join(',\n');

    const sql = `
      WITH route AS (
        SELECT ST_SetSRID(ST_MakeLine(ARRAY[${pointsSql}]), 4326) AS geom
      )
      SELECT
        p.id,
        p.osm_id,
        p.osm_type,
        p.name,
        p.place_type,
        p.state,
        ST_Y(p.geom) AS lat,
        ST_X(p.geom) AS lng,
        ST_Distance(p.geom::geography, route.geom::geography) / 1000 AS distance_to_route_km,
        GREATEST(0, LEAST(1, ST_LineLocatePoint(route.geom, p.geom))) AS route_progress
      FROM osm_places p, route
      WHERE p.name IS NOT NULL
      AND p.place_type = ANY($1::text[])
      AND ST_DWithin(
        p.geom::geography,
        route.geom::geography,
        $2
      )
      ORDER BY distance_to_route_km ASC
      LIMIT $3
    `;

    const result = await this.pool.query(sql, [
      placeTypes,
      corridorKm * 1000,
      limit,
    ]);

    return result.rows.map((r: Record<string, unknown>) => ({
      id: String(r.id),
      osm_id: r.osm_id as string,
      osm_type: r.osm_type as string,
      name: r.name as string,
      place_type: r.place_type as string,
      state: r.state as string | null,
      lat: Number(r.lat),
      lng: Number(r.lng),
      distance_to_route_km: Number(r.distance_to_route_km),
      route_progress: Number(r.route_progress),
    }));
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  async getHealth(): Promise<{
    connected: boolean;
    counts: { places: number; roads: number; pois: number; buildings: number };
    error?: string;
  }> {
    try {
      const result = await this.pool.query(`
        SELECT
          (SELECT COUNT(*) FROM osm_places) AS places,
          (SELECT COUNT(*) FROM osm_roads) AS roads,
          (SELECT COUNT(*) FROM osm_pois) AS pois,
          (SELECT COUNT(*) FROM osm_buildings) AS buildings
      `);
      const row = result.rows[0];
      return {
        connected: true,
        counts: {
          places: Number(row.places),
          roads: Number(row.roads),
          pois: Number(row.pois),
          buildings: Number(row.buildings),
        },
      };
    } catch (err: any) {
      return {
        connected: false,
        counts: { places: 0, roads: 0, pois: 0, buildings: 0 },
        error: err.message,
      };
    }
  }
}
